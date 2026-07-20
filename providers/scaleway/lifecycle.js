import { fetchWithTimeout } from "../_shared/fetchWithTimeout.js";
const VALIDATE_URL = (projectId) => `https://api.scaleway.com/account/v3/projects?project_ids=${encodeURIComponent(projectId)}`;
const FALLBACK_K8S_VERSION = "1.31";
/**
 * Ask Scaleway for the Kapsule versions currently available in the cluster's
 * region and return the newest. A hardcoded version is eventually rejected when
 * Scaleway rotates it out of support (audit finding 2.4). Any failure falls
 * back to the template default so a transient API hiccup doesn't block deploy.
 */
async function resolveLatestK8sVersion(cluster) {
    const secretKey = cluster.credentials.secretKey;
    const region = cluster.geography;
    if (!secretKey || !region)
        return FALLBACK_K8S_VERSION;
    try {
        const res = await fetchWithTimeout(`https://api.scaleway.com/k8s/v1/regions/${encodeURIComponent(region)}/versions`, { headers: { "X-Auth-Token": secretKey } });
        if (!res.ok)
            return FALLBACK_K8S_VERSION;
        const body = (await res.json());
        const names = (body.versions ?? []).map((v) => v.name).filter(Boolean);
        if (names.length === 0)
            return FALLBACK_K8S_VERSION;
        // Scaleway lists newest first, but sort defensively by numeric minor.
        names.sort((a, b) => compareSemver(b, a));
        return names[0] ?? FALLBACK_K8S_VERSION;
    }
    catch {
        return FALLBACK_K8S_VERSION;
    }
}
function compareSemver(a, b) {
    const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
    const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0)
            return d;
    }
    return 0;
}
export const lifecycle = {
    envMap(cluster) {
        const c = cluster.credentials;
        return {
            SCW_ACCESS_KEY: c.accessKey ?? "",
            SCW_SECRET_KEY: c.secretKey ?? "",
            SCW_DEFAULT_PROJECT_ID: c.projectId ?? "",
            SCW_DEFAULT_REGION: cluster.geography
        };
    },
    locationLabel(cluster) {
        return cluster.geography;
    },
    async beforeTofuInit(ctx) {
        const version = await resolveLatestK8sVersion(ctx.cluster);
        console.log(`==> Scaleway Kapsule version: ${version}`);
        return { extraEnv: { TF_VAR_k8s_version: version } };
    },
    async validate(cluster) {
        const projectId = cluster.credentials.projectId;
        const secretKey = cluster.credentials.secretKey;
        if (!projectId || !secretKey) {
            return { ok: false, error: "Missing Scaleway projectId or secretKey." };
        }
        try {
            const res = await fetchWithTimeout(VALIDATE_URL(projectId), {
                headers: { "X-Auth-Token": secretKey }
            });
            if (res.status === 200)
                return { ok: true };
            if (res.status === 401 || res.status === 403) {
                return { ok: false, error: "Invalid or unauthorized Scaleway credentials." };
            }
            return { ok: false, error: `Scaleway API returned ${res.status}.` };
        }
        catch (err) {
            return { ok: false, error: `Network error: ${err.message}` };
        }
    }
};
