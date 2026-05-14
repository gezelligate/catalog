# Drive — La Suite Drive

File storage, sharing, and organization with team workspaces. Built on Django + Next.js. Maintained by France's DINUM.

Upstream: https://github.com/suitenumerique/drive

## What's included

- **drive-backend** — Django REST API + admin (`lasuite/drive-backend:v0.10.0`).
- **drive-celery** — async task worker (background email, thumbnail/preview generation, etc.).
- **drive-celery-beat** — singleton scheduler for daily housekeeping (`clean_pending_items`, `purge_deleted_items`).
- **drive** — public-facing nginx ingress on port 8084, also serves the Next.js static export on 8080 internally.
- **drive-minio** — bundled S3-compatible object store for uploaded files (private bucket `drive-media-storage`, served through `drive` with auth proxied to the backend's `/api/v1.0/items/media-auth/`).
- **postgres** (shared) — Drive uses logical DB `drive` on the shared instance.
- **redis** (shared) — namespaced via Redis logical DB 4.

## Form fields

- `subdomain` — public hostname under your base domain (default: `drive`).

## OIDC

Drive uses OIDC against Keycloak's `gezelligate` realm. The OIDC client `drive` is auto-registered at first Keycloak start with redirect URIs:

- `https://<subdomain>.<your-domain>/*` (public mode)
- `http://localhost:8084/*` (local mode)

Browser-facing endpoints (`/auth`, `/logout`) point at the public Keycloak URL; server-side calls (`/token`, `/userinfo`, `/certs`) hit the in-cluster `keycloak` Service. The client requests scopes `openid` and `email` only — the standard mozilla_django_oidc shape Drive expects.

## Object storage

The bundled Minio is **only reachable inside the compose network / cluster** — it is not exposed externally. The drive ingress proxies signed-URL media requests through it via nginx `auth_request`, so end-users never talk to Minio directly. Downloads (`/media/`) are served as attachments; previews (`/media/preview/`) are served inline.

If you already have an S3 endpoint (Hetzner Object Storage, Scaleway Object Storage, AWS S3, …), edit the rendered manifests to point `AWS_S3_*` and `MEDIA_BASE_URL` at it and remove the `drive-minio` and `drive-createbuckets` services.

## Post-install

Drive needs an initial Django superuser before `/admin` is reachable. After `docker compose up -d`:

```bash
docker compose run --rm drive-backend python manage.py createsuperuser \
  --email <admin email>
```

For Kubernetes:

```bash
kubectl -n gezelligate exec -it deploy/drive-backend -- python manage.py createsuperuser --email <admin email>
```

The first user signing in via Keycloak SSO is provisioned as a regular user; the Django superuser is only needed for the admin UI.

## What's NOT included (yet)

- **WOPI (Collabora / OnlyOffice).** Drive can hand off `.docx`, `.xlsx`, `.pptx` editing to a WOPI host, but neither Collabora nor OnlyOffice is bundled. Files of those types are still uploadable and downloadable; in-browser editing is disabled. To enable, set `WOPI_CLIENTS` and the matching `WOPI_<CLIENT>_DISCOVERY_URL` env vars on `drive-backend` and bundle the chosen WOPI host.
- **End-to-end encryption (ds-proxy).** Drive ships a Rust-based "ds-proxy" sidecar that wraps S3 with client-side encryption. Not bundled — requires generating a keyring and tuning ingress carefully. Vanilla server-side Minio encryption is in use instead.
- **Indexed search (Find app).** Drive can integrate with an external indexer; `FEATURES_INDEXED_SEARCH` is `False`. Backend search via `/api/v1.0/items/?q=…` still works against Postgres.
- **External SMTP.** Email notifications require `DJANGO_EMAIL_HOST*` env vars on `drive-backend`. Without them, emails are logged but not delivered.
