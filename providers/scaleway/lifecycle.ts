import type { ClusterLifecycle } from "@gezelligate/core/providers/lifecycle";
import { fetchWithTimeout } from "../_shared/fetchWithTimeout.js";

const VALIDATE_URL = (projectId: string) =>
  `https://api.scaleway.com/account/v3/projects?project_ids=${encodeURIComponent(projectId)}`;

export const lifecycle: ClusterLifecycle = {
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
      if (res.status === 200) return { ok: true };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Invalid or unauthorized Scaleway credentials." };
      }
      return { ok: false, error: `Scaleway API returned ${res.status}.` };
    } catch (err) {
      return { ok: false, error: `Network error: ${(err as Error).message}` };
    }
  }
};
