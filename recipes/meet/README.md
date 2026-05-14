# Meet — La Suite Meet (video conferencing)

Open-source video conferencing built on LiveKit. Maintained by France's DINUM. Replaces Jitsi as gezelligate's video service.

## What's included

- **meet-backend** — Django REST API (rooms, auth, JWT signing for LiveKit).
- **meet-celery** — async task worker (background email, etc.).
- **meet-frontend** — React app, served by nginx.
- **livekit** (auto-included) — WebRTC SFU. See `repository/livekit/README.md`.
- **postgres** (shared) — Meet's database.
- **redis** (shared) — Meet's cache and Celery broker.

## OIDC

Meet authenticates via Keycloak. The OIDC client `meet` is auto-registered in the realm at first Keycloak start with a wildcard redirect URI matching `https://meet.<your-domain>/*`.

**Assumption:** Keycloak is reachable at `auth.<your-domain>` (the keycloak bundle's default subdomain). If you've changed the keycloak subdomain, edit Meet's docker-compose / k8s manifests by hand to match. Future plans will surface a wizard knob for this.

## What's NOT included (yet)

- **Recordings.** Land in Plan 13 (livekit-egress + Minio).
- **Transcription / Summary.** Land in Plan 14.
- **TURN/TURNS server.** Add only if you have users behind UDP-blocked networks.
- **E2E encryption.** Off by default in LiveKit.

## Migration from Jitsi

If you previously had Jitsi enabled: see `CHANGELOG.md` at the repo root. Existing meeting URLs are not portable.
