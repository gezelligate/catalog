# Bridge

The Gezelligate apex launcher. Auto-included whenever a user-facing service declares `provides.bridge`. Source lives in `/bridge/`; this directory is the catalog entry (service definition + deployment templates).

- **Phase 1** (released): launcher tiles, per-service unread badges, recent items, all behind shared SSO.
- **Phase 2** (released): unified search using the opt-in `bridge_reader` postgres grants declared via `provides.bridge.dbRead`.
- **Phase 3** (released): user-initiated "share to Mattermost" action on bridge search results — sends a post via OIDC token-exchange and Mattermost's `/api/v4/posts`. URL allowlist is computed from the manifest's `service.url` origins.

The bridge runtime is generic — it knows nothing about specific services. All per-service knowledge lives in each service's `provides.bridge` declaration, collected by the renderer into a `bridge-manifest.json` mounted into the container at boot.

## Manifest + icons

The renderer emits two ConfigMaps for the k8s target — `bridge-manifest` and `bridge-icons` — under `output/kubernetes/configmaps/`. The bridge Deployment mounts them at `/app/manifest/bridge-manifest.json` and `/app/icons/<svc>.svg`, mirroring the docker volume bindings (`./bridge-manifest.json` and `./bridge-icons/`). Services without an `assets/icon.svg` are silently skipped; their tiles fall back to the manifest's declared `tile.icon` URL.

## Image source

The k8s deployment pulls the bridge image from `ghcr.io/spatialexplorers/bridge:latest`. That image is built and published by `.github/workflows/publish-bridge-image.yml` on every push to `main` that touches `bridge/**`, and on every tag matching `v*`. The package must be set to **public** in the GHCR UI (Packages → bridge → Settings → Change visibility) so end-users' clusters can pull without registry auth. The docker target builds locally from `bridge/Dockerfile` and ignores this image entirely.

## Known limitations

- **`service-token` activity auth path is reserved but unimplemented.** Routes return 501 if a service declares `auth: service-token`. `oidc-passthrough` (via Keycloak token exchange) is the only working path in Phase 1.
