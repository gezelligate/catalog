# Docs — La Suite Docs

Collaborative wiki and documentation platform with real-time editing, built on Django + Next.js + BlockNote/Yjs. Maintained by France's DINUM.

Upstream: https://github.com/suitenumerique/docs

## What's included

- **docs-backend** — Django REST API + admin (`lasuite/impress-backend:v3.7.0`).
- **docs-celery** — async task worker (background email, signed-URL refresh, etc.).
- **docs-y-provider** — Yjs websocket server for real-time collaboration on port 4444.
- **docs** — public-facing nginx ingress on port 8083, also serves the React static bundle on 3000 internally.
- **docs-minio** — bundled S3-compatible object store for uploaded media (private bucket `docs-media-storage`, served through `docs` with auth proxied to the backend's `/api/v1.0/documents/media-auth/`).
- **postgres** (shared) — Docs uses logical DB `docs` on the shared instance.
- **redis** (shared) — namespaced via Redis logical DB 3.

## Form fields

- `subdomain` — public hostname under your base domain (default: `docs`).

## OIDC

Docs uses OIDC against Keycloak's `gezelligate` realm. The OIDC client `docs` is auto-registered at first Keycloak start with redirect URIs:

- `https://<subdomain>.<your-domain>/*` (public mode)
- `http://localhost:8083/*` (local mode)

Browser-facing endpoints (`/auth`, `/logout`) point at the public Keycloak URL; server-side calls (`/token`, `/userinfo`, `/certs`) hit the in-cluster `keycloak` Service. The client requests scopes `openid` and `email` only — the standard mozilla_django_oidc shape Docs expects.

## Object storage

The bundled Minio is **only reachable inside the compose network / cluster** — it is not exposed externally. The docs ingress proxies signed-URL media requests through it via nginx `auth_request`, so end-users never talk to Minio directly.

If you already have an S3 endpoint (Hetzner Object Storage, Scaleway Object Storage, AWS S3, …), edit the rendered manifests to point `AWS_S3_*` and `MEDIA_BASE_URL` at it and remove the `docs-minio` and `docs-createbuckets` services. A first-class wizard option for "external S3" is on the backlog.

## Post-install

Docs needs an initial Django superuser before `/admin` is reachable. After `docker compose up -d`:

```bash
docker compose run --rm docs-backend python manage.py createsuperuser \
  --email <admin email>
```

For Kubernetes:

```bash
kubectl -n gezelligate exec -it deploy/docs-backend -- python manage.py createsuperuser --email <admin email>
```

The first user signing in via Keycloak SSO is provisioned as a regular user; the Django superuser is only needed for the admin UI.

## What's NOT included (yet)

- **AI features.** Docs supports OpenAI-compatible "translate / summarize / correct" actions, but they require an `AI_BASE_URL` and `AI_API_KEY`. Add them to the backend env if you want them on.
- **Search backend.** Search uses Postgres full-text by default; a Meilisearch backend exists upstream but isn't wired up here.
- **Custom theming / footer.** `FRONTEND_THEME` and `FRONTEND_CSS_URL` aren't surfaced in the wizard. Set them in the rendered manifest if you need a custom theme.
- **External SMTP.** Email invitations require `DJANGO_EMAIL_HOST*` env vars on `docs-backend`. Without them, invites are logged but not delivered.
