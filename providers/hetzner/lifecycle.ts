import fs from "node:fs/promises";
import path from "node:path";
import type {
  ClusterLifecycle,
  LifecycleContext
} from "@gezelligate/core/providers/lifecycle";
import type { ClusterYaml } from "@gezelligate/core/schema/clusterYaml";
import { fetchWithTimeout } from "../_shared/fetchWithTimeout.js";

const HETZNER_API = "https://api.hetzner.cloud/v1";

function apiToken(cluster: ClusterYaml): string {
  const t = cluster.credentials.apiToken;
  if (!t) throw new Error("Hetzner cluster config is missing credentials.apiToken");
  return t;
}

async function hcloudGet<T>(token: string, p: string): Promise<T> {
  const res = await fetchWithTimeout(`${HETZNER_API}${p}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Hetzner API ${p} returned ${res.status}`);
  return (await res.json()) as T;
}

async function hcloudJson<T>(
  token: string,
  segment: string,
  init?: RequestInit
): Promise<T | null> {
  const res = await fetchWithTimeout(`${HETZNER_API}${segment}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });
  if (!res.ok) throw new Error(`Hetzner API ${segment} returned ${res.status}`);
  if (res.status === 204) return null;
  return (await res.json()) as T;
}

function lbNameFromBaseDomain(baseDomain: string | undefined): string {
  if (!baseDomain) return "gezelligate-traefik";
  const sanitized = baseDomain
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `gezelligate-${sanitized || "traefik"}`;
}

async function ensureSshKey(rootDir: string, ctx: LifecycleContext): Promise<{
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string;
}> {
  const sshDir = path.join(rootDir, "services", ".ssh");
  const privateKeyPath = path.join(sshDir, "id_ed25519");
  const publicKeyPath = path.join(sshDir, "id_ed25519.pub");
  await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });
  try {
    await fs.access(publicKeyPath);
  } catch {
    console.log("==> generating SSH keypair at services/.ssh/id_ed25519");
    await ctx.run(
      "ssh-keygen",
      ["-t", "ed25519", "-N", "", "-C", "gezelligate", "-f", privateKeyPath],
      rootDir,
      process.env
    );
  }
  await fs.chmod(privateKeyPath, 0o600);
  const publicKey = (await fs.readFile(publicKeyPath, "utf8")).trim();
  return { privateKeyPath, publicKeyPath, publicKey };
}

async function ensureK3sToken(rootDir: string): Promise<string> {
  const secretsDir = path.join(rootDir, "services", ".secrets");
  const tokenPath = path.join(secretsDir, "k3s-token");
  await fs.mkdir(secretsDir, { recursive: true, mode: 0o700 });
  try {
    const existing = (await fs.readFile(tokenPath, "utf8")).trim();
    if (existing.length >= 32) {
      await fs.chmod(tokenPath, 0o600);
      return existing;
    }
  } catch {
    /* fall through to generate */
  }
  const { randomBytes } = await import("node:crypto");
  const token = randomBytes(36).toString("base64url").slice(0, 48);
  console.log("==> generating k3s cluster token at services/.secrets/k3s-token");
  await fs.writeFile(tokenPath, token + "\n", { mode: 0o600 });
  return token;
}

async function validateServerTypes(cluster: ClusterYaml): Promise<void> {
  interface ServerType { id: number; name: string; architecture: string }
  interface Datacenter { location: { name: string }; server_types: { supported: number[] } }
  const token = apiToken(cluster);
  const headers = { Authorization: `Bearer ${token}` };
  const [stRes, dcRes] = await Promise.all([
    fetchWithTimeout(`${HETZNER_API}/server_types?per_page=60`, { headers }),
    fetchWithTimeout(`${HETZNER_API}/datacenters`, { headers })
  ]);
  if (!stRes.ok || !dcRes.ok) {
    throw new Error(
      `Hetzner API rejected the token (server_types=${stRes.status}, datacenters=${dcRes.status}). ` +
      `Re-check your API token in the Cloud Provider step.`
    );
  }
  const { server_types } = (await stRes.json()) as { server_types: ServerType[] };
  const { datacenters } = (await dcRes.json()) as { datacenters: Datacenter[] };
  const locationDc = datacenters.find((d) => d.location.name === cluster.geography);
  if (!locationDc) {
    throw new Error(`Hetzner location "${cluster.geography}" not found via API.`);
  }
  const orderableIds = new Set(locationDc.server_types.supported);
  const orderableNames = new Set(
    server_types.filter((t) => orderableIds.has(t.id)).map((t) => t.name)
  );

  const wanted = [cluster.controlPlaneType, cluster.nodePoolType].filter(
    (n): n is string => typeof n === "string"
  );
  const missing = wanted.filter((n) => !orderableNames.has(n));
  if (missing.length > 0) {
    const sorted = Array.from(orderableNames).sort();
    throw new Error(
      `Server type(s) not orderable in location "${cluster.geography}": ${missing.join(", ")}.\n` +
      `Orderable types in this location: ${sorted.join(", ")}.\n` +
      `Go back to the Cloud Provider step, pick a preset (or a different server type in Advanced), re-Validate, re-Generate, and try again.`
    );
  }
}

async function adoptOrphans(
  tofuDir: string,
  token: string,
  ctx: LifecycleContext
): Promise<void> {
  const env = ctx.env;
  async function stateList(): Promise<string[]> {
    try {
      const out = await ctx.capture("tofu", ["state", "list"], tofuDir, env);
      return out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    } catch {
      return [];
    }
  }

  const tracked = new Set(await stateList());

  if (!tracked.has("hcloud_ssh_key.gezelligate")) {
    const keys = await hcloudGet<{ ssh_keys: Array<{ id: number; name: string }> }>(
      token,
      "/ssh_keys?name=gezelligate"
    );
    if (keys.ssh_keys.length > 0) {
      const id = keys.ssh_keys[0]!.id;
      console.log(`==> adopting orphaned hcloud_ssh_key.gezelligate (id=${id}) into state`);
      await ctx.run("tofu", ["import", "hcloud_ssh_key.gezelligate", String(id)], tofuDir, env);
    }
  }

  if (!tracked.has("hcloud_network.gezelligate")) {
    const nets = await hcloudGet<{ networks: Array<{ id: number; name: string }> }>(
      token,
      "/networks?name=gezelligate"
    );
    if (nets.networks.length > 0) {
      const id = nets.networks[0]!.id;
      console.log(`==> adopting orphaned hcloud_network.gezelligate (id=${id}) into state`);
      await ctx.run("tofu", ["import", "hcloud_network.gezelligate", String(id)], tofuDir, env);
      if (!tracked.has("hcloud_network_subnet.nodes")) {
        const addr = `${id}-10.0.1.0/24`;
        console.log(`==> adopting orphaned hcloud_network_subnet.nodes (${addr}) into state`);
        await ctx
          .run("tofu", ["import", "hcloud_network_subnet.nodes", addr], tofuDir, env)
          .catch(() => {
            console.log(`    subnet adoption skipped (not found at ${addr})`);
          });
      }
    }
  }

  const servers = await hcloudGet<{ servers: Array<{ id: number; name: string }> }>(
    token,
    "/servers?name=gezelligate-cp"
  );
  if (servers.servers.length > 0 && !tracked.has("hcloud_server.control_plane")) {
    const id = servers.servers[0]!.id;
    console.log(`==> adopting orphaned hcloud_server.control_plane (id=${id}) into state`);
    await ctx.run("tofu", ["import", "hcloud_server.control_plane", String(id)], tofuDir, env);
  }
  for (let i = 0; i < 20; i += 1) {
    const name = `gezelligate-worker-${i + 1}`;
    const key = `hcloud_server.worker[${i}]`;
    if (tracked.has(key)) continue;
    const w = await hcloudGet<{ servers: Array<{ id: number; name: string }> }>(
      token,
      `/servers?name=${encodeURIComponent(name)}`
    );
    if (w.servers.length === 0) break;
    const id = w.servers[0]!.id;
    console.log(`==> adopting orphaned ${key} "${name}" (id=${id}) into state`);
    await ctx.run("tofu", ["import", key, String(id)], tofuDir, env);
  }
}

async function installCloudControllerManager(ctx: LifecycleContext): Promise<void> {
  const token = apiToken(ctx.cluster);
  const kenv: NodeJS.ProcessEnv = { ...ctx.env, KUBECONFIG: ctx.kubeconfigPath };
  console.log("==> installing hcloud Cloud Controller Manager");
  const secretYaml = [
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    "  name: hcloud",
    "  namespace: kube-system",
    "type: Opaque",
    "stringData:",
    `  token: ${token}`,
    "  network: gezelligate",
    ""
  ].join("\n");
  const tmpSecret = path.join(ctx.rootDir, "output/kubernetes/hcloud-secret.tmp.yaml");
  await fs.writeFile(tmpSecret, secretYaml, { mode: 0o600 });
  try {
    await ctx.run("kubectl", ["apply", "-f", tmpSecret], ctx.rootDir, kenv);
  } finally {
    await fs.rm(tmpSecret, { force: true });
  }
  await ctx
    .run("helm", ["repo", "add", "hcloud", "https://charts.hetzner.cloud"], ctx.rootDir, kenv)
    .catch(() => undefined);
  await ctx.run("helm", ["repo", "update"], ctx.rootDir, kenv);
  await ctx.run(
    "helm",
    [
      "upgrade",
      "--install",
      "hccm",
      "hcloud/hcloud-cloud-controller-manager",
      "--namespace",
      "kube-system"
    ],
    ctx.rootDir,
    kenv
  );
}

async function ensureNodesInitialized(ctx: LifecycleContext): Promise<void> {
  const kenv: NodeJS.ProcessEnv = { ...ctx.env, KUBECONFIG: ctx.kubeconfigPath };
  const taintKey = "node.cloudprovider.kubernetes.io/uninitialized";
  const deadline = Date.now() + 90_000;
  process.stdout.write("==> waiting for Hetzner CCM to initialize node(s)");
  while (Date.now() < deadline) {
    const raw = (
      await ctx.capture(
        "kubectl",
        [
          "get",
          "nodes",
          "-o",
          `jsonpath={range .items[*]}{.metadata.name}|{range .spec.taints[?(@.key=="${taintKey}")]}${taintKey}{end}{"\\n"}{end}`
        ],
        ctx.rootDir,
        kenv
      )
    ).trim();
    const lines = raw.split("\n").filter((l) => l.length > 0);
    const uninit = lines.filter((l) => l.includes(taintKey)).map((l) => l.split("|")[0]);
    if (uninit.length === 0) {
      process.stdout.write(" done\n");
      return;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 3000));
  }
  process.stdout.write("\n");
  const raw = (
    await ctx.capture(
      "kubectl",
      [
        "get",
        "nodes",
        "-o",
        `jsonpath={range .items[*]}{.metadata.name}|{range .spec.taints[?(@.key=="${taintKey}")]}${taintKey}{end}{"\\n"}{end}`
      ],
      ctx.rootDir,
      kenv
    )
  ).trim();
  const tainted = raw
    .split("\n")
    .filter((l) => l.includes(taintKey))
    .map((l) => l.split("|")[0])
    .filter((n): n is string => n !== undefined);
  for (const node of tainted) {
    console.log(`==> Hetzner CCM never removed uninitialized taint from ${node}; stripping manually`);
    await ctx.run(
      "kubectl",
      ["taint", "nodes", node, `${taintKey}:NoSchedule-`],
      ctx.rootDir,
      kenv
    );
  }
}

async function reconcileLbTargets(ctx: LifecycleContext): Promise<void> {
  const token = apiToken(ctx.cluster);
  interface LbTarget { type: string; server?: { id: number } }
  interface Lb { id: number; name: string; targets: LbTarget[] }

  const { load_balancers } = await hcloudGet<{ load_balancers: Lb[] }>(token, "/load_balancers");
  if (load_balancers.length === 0) return;

  const cpIp = (
    await ctx.capture("tofu", ["output", "-raw", "control_plane_ip"], ctx.tofuDir, ctx.env)
  ).trim();
  const { servers } = await hcloudGet<{
    servers: Array<{ id: number; public_net: { ipv4: { ip: string } } }>;
  }>(token, "/servers?name=gezelligate-cp");
  const cpServer = servers.find((s) => s.public_net.ipv4.ip === cpIp);
  if (!cpServer) return;

  for (const lb of load_balancers) {
    const alreadyAttached = lb.targets.some(
      (t) => t.type === "server" && t.server?.id === cpServer.id
    );
    if (alreadyAttached) continue;
    if (lb.targets.length > 0) continue;
    console.log(
      `==> LB ${lb.name} has 0 targets; attaching control plane (server_id=${cpServer.id}) via API`
    );
    await hcloudJson(token, `/load_balancers/${lb.id}/actions/add_target`, {
      method: "POST",
      body: JSON.stringify({ type: "server", server: { id: cpServer.id }, use_private_ip: false })
    });
  }
}

async function cleanupHccmLoadBalancers(token: string): Promise<void> {
  interface Lb { id: number; name: string; labels?: Record<string, string> }
  const listed = await hcloudJson<{ load_balancers: Lb[] }>(token, "/load_balancers");
  const all = listed?.load_balancers ?? [];
  const orphans = all.filter((lb) =>
    Object.keys(lb.labels ?? {}).some((k) => k.startsWith("hcloud-ccm/"))
  );
  if (orphans.length === 0) return;
  for (const lb of orphans) {
    console.log(`==> Deleting orphan hccm load balancer id=${lb.id} name=${lb.name}`);
    await hcloudJson(token, `/load_balancers/${lb.id}`, { method: "DELETE" });
  }
}

export const lifecycle: ClusterLifecycle = {
  envMap(cluster) {
    return { HCLOUD_TOKEN: apiToken(cluster) };
  },

  locationLabel(cluster) {
    return cluster.geography;
  },

  async validate(cluster) {
    const token = cluster.credentials.apiToken;
    if (!token) {
      return { ok: false, error: "Missing Hetzner apiToken credential." };
    }
    try {
      const res = await fetchWithTimeout(`${HETZNER_API}/locations`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.status === 200) return { ok: true };
      if (res.status === 401) {
        return {
          ok: false,
          error: "Invalid Hetzner API token — make sure it's a Read & Write token for the correct project."
        };
      }
      return { ok: false, error: `Hetzner API returned ${res.status}.` };
    } catch (err) {
      return { ok: false, error: `Network error: ${(err as Error).message}` };
    }
  },

  async listResources(cluster) {
    const token = apiToken(cluster);
    const headers = { Authorization: `Bearer ${token}` };
    const [serversRes, networksRes, lbsRes, keysRes, stRes] = await Promise.all([
      fetchWithTimeout(`${HETZNER_API}/servers?per_page=50`, { headers }),
      fetchWithTimeout(`${HETZNER_API}/networks?per_page=50`, { headers }),
      fetchWithTimeout(`${HETZNER_API}/load_balancers?per_page=50`, { headers }),
      fetchWithTimeout(`${HETZNER_API}/ssh_keys?per_page=50`, { headers }),
      fetchWithTimeout(`${HETZNER_API}/server_types?per_page=60`, { headers })
    ]);
    if (serversRes.status === 401) {
      throw Object.assign(new Error("Invalid Hetzner API token"), { httpStatus: 401 });
    }
    const servers =
      ((await serversRes.json()) as {
        servers: Array<{
          id: number;
          name: string;
          server_type: { name: string };
          datacenter: { location: { name: string } };
          status: string;
        }>;
      }).servers ?? [];
    const networks =
      ((await networksRes.json()) as { networks: Array<{ id: number; name: string }> }).networks ??
      [];
    const lbs =
      ((await lbsRes.json()) as {
        load_balancers: Array<{
          id: number;
          name: string;
          load_balancer_type: {
            name: string;
            prices: Array<{ location: string; price_monthly: { gross: string } }>;
          };
          location: { name: string };
        }>;
      }).load_balancers ?? [];
    const keys =
      ((await keysRes.json()) as { ssh_keys: Array<{ id: number; name: string }> }).ssh_keys ?? [];
    const serverTypes =
      ((await stRes.json()) as {
        server_types: Array<{
          name: string;
          prices: Array<{ location: string; price_monthly: { gross: string } }>;
        }>;
      }).server_types ?? [];

    const stPriceMap = new Map<string, Map<string, number>>();
    for (const st of serverTypes) {
      const inner = new Map<string, number>();
      for (const p of st.prices ?? []) inner.set(p.location, Number(p.price_monthly.gross));
      stPriceMap.set(st.name, inner);
    }

    const resources: Array<{ kind: string; name: string; detail: string; priceMonthly: number | null }> = [];
    for (const s of servers.filter((x) => x.name.startsWith("gezelligate"))) {
      const price = stPriceMap.get(s.server_type.name)?.get(s.datacenter.location.name) ?? null;
      resources.push({
        kind: "server",
        name: s.name,
        detail: `${s.server_type.name} in ${s.datacenter.location.name} (${s.status})`,
        priceMonthly: price
      });
    }
    for (const lb of lbs.filter((x) => x.name.startsWith("gezelligate"))) {
      const price = (lb.load_balancer_type.prices ?? []).find((p) => p.location === lb.location.name);
      resources.push({
        kind: "load_balancer",
        name: lb.name,
        detail: `${lb.load_balancer_type.name} in ${lb.location.name}`,
        priceMonthly: price ? Number(price.price_monthly.gross) : null
      });
    }
    for (const n of networks.filter((x) => x.name.startsWith("gezelligate"))) {
      resources.push({ kind: "network", name: n.name, detail: "private network", priceMonthly: 0 });
    }
    for (const k of keys.filter((x) => x.name.startsWith("gezelligate"))) {
      resources.push({ kind: "ssh_key", name: k.name, detail: "uploaded SSH key", priceMonthly: 0 });
    }
    const estimatedMonthlyCost = resources.reduce((sum, r) => sum + (r.priceMonthly ?? 0), 0);
    return { resources, estimatedMonthlyCost };
  },

  async catalogLookup(_cluster, kind, params) {
    if (kind !== "node-types") {
      throw new Error(`hetzner: unknown catalog kind "${kind}"`);
    }
    const token = params.apiToken;
    const location = params.geography ?? params.location;
    if (!token || !location) {
      throw new Error("hetzner: catalog lookup requires apiToken and geography");
    }
    const headers = { Authorization: `Bearer ${token}` };
    const [stRes, dcRes] = await Promise.all([
      fetchWithTimeout(`${HETZNER_API}/server_types?per_page=60`, { headers }),
      fetchWithTimeout(`${HETZNER_API}/datacenters`, { headers })
    ]);
    if (stRes.status === 401 || dcRes.status === 401) {
      throw Object.assign(new Error("Invalid Hetzner API token"), { httpStatus: 401 });
    }
    if (!stRes.ok) {
      throw Object.assign(new Error(`Hetzner /server_types returned ${stRes.status}`), {
        httpStatus: 502
      });
    }
    if (!dcRes.ok) {
      throw Object.assign(new Error(`Hetzner /datacenters returned ${dcRes.status}`), {
        httpStatus: 502
      });
    }
    const stData = (await stRes.json()) as {
      server_types: Array<{
        id: number;
        name: string;
        architecture: string;
        cores: number;
        memory: number;
        disk: number;
        deprecation?: unknown;
        prices?: Array<{ location: string; price_monthly: { gross: string } }>;
      }>;
    };
    const dcData = (await dcRes.json()) as {
      datacenters: Array<{ location: { name: string }; server_types: { supported: number[] } }>;
    };
    const dc = dcData.datacenters.find((d) => d.location.name === location);
    if (!dc) {
      throw Object.assign(new Error(`Location "${location}" not found`), { httpStatus: 404 });
    }
    const orderableIds = new Set(dc.server_types.supported);
    const types = stData.server_types
      .filter((t) => orderableIds.has(t.id))
      .filter((t) => !t.deprecation)
      .map((t) => {
        const priceRow = (t.prices ?? []).find((p) => p.location === location);
        return {
          name: t.name,
          architecture: t.architecture,
          cores: t.cores,
          memory: t.memory,
          disk: t.disk,
          priceMonthly: priceRow ? Number(priceRow.price_monthly.gross) : null
        };
      });
    types.sort((a, b) => (a.priceMonthly ?? 0) - (b.priceMonthly ?? 0));
    return { types };
  },

  kubernetesLbAnnotations(cluster, baseDomain) {
    return {
      "load-balancer.hetzner.cloud/location": cluster.geography,
      "load-balancer.hetzner.cloud/name": lbNameFromBaseDomain(baseDomain)
    };
  },

  async beforeTofuInit(ctx) {
    const { privateKeyPath, publicKey } = await ensureSshKey(ctx.rootDir, ctx);
    const k3sToken = await ensureK3sToken(ctx.rootDir);
    await validateServerTypes(ctx.cluster);
    return {
      extraEnv: {
        TF_VAR_ssh_public_key: publicKey,
        TF_VAR_ssh_private_key_path: privateKeyPath,
        TF_VAR_k3s_token: k3sToken
      }
    };
  },

  async beforeTofuOperation(ctx) {
    await adoptOrphans(ctx.tofuDir, apiToken(ctx.cluster), ctx);
  },

  async captureKubeconfig(ctx) {
    const localKc = path.join(ctx.tofuDir, "kubeconfig.yaml");
    try {
      return await fs.readFile(localKc, "utf8");
    } catch {
      console.log("==> kubeconfig.yaml missing — fetching from control plane via SCP");
    }
    const cpIp = (
      await ctx.capture("tofu", ["output", "-raw", "control_plane_ip"], ctx.tofuDir, ctx.env)
    ).trim();
    const sshKey = ctx.env.TF_VAR_ssh_private_key_path as string;
    const rawLocal = path.join(ctx.tofuDir, "kubeconfig.raw");
    await ctx.run(
      "scp",
      [
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-i", sshKey,
        `root@${cpIp}:/etc/rancher/k3s/k3s.yaml`,
        rawLocal
      ],
      ctx.rootDir,
      ctx.env
    );
    const raw = await fs.readFile(rawLocal, "utf8");
    const contents = raw.replace("https://127.0.0.1:6443", `https://${cpIp}:6443`);
    await fs.writeFile(localKc, contents, { mode: 0o600 });
    await fs.rm(rawLocal, { force: true });
    return contents;
  },

  async afterKubeconfig(ctx) {
    await installCloudControllerManager(ctx);
    await ensureNodesInitialized(ctx);
  },

  async afterInstall(ctx) {
    await reconcileLbTargets(ctx);
  },

  async afterTofuDestroy(ctx) {
    console.log("==> Sweeping any orphan hccm-managed load balancers");
    try {
      await cleanupHccmLoadBalancers(apiToken(ctx.cluster));
    } catch (err) {
      console.error(
        `warning: hccm LB cleanup failed: ${err instanceof Error ? err.message : err}`
      );
      console.error("Check your Hetzner dashboard and delete any remaining LBs manually.");
    }
  },

  async collectMetadata(ctx) {
    try {
      const controlPlaneIp = (
        await ctx.capture("tofu", ["output", "-raw", "control_plane_ip"], ctx.tofuDir, ctx.env)
      ).trim();
      return { controlPlaneIp };
    } catch {
      return {};
    }
  }
};
