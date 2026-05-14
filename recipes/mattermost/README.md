# Mattermost

Self-hosted team chat. Integrated with Keycloak for single sign-on via the OIDC/GitLab compatibility mode.

## What it provides

- A chat server at your configured subdomain
- SSO via your Keycloak `admin` (or any realm) user — no separate Mattermost account needed
- Postgres database (internal to the compose stack)
- File uploads persisted to a Docker volume

## Form fields

- `subdomain` — the subdomain Mattermost is served on (default: `chat`)
- `enableCalls` — enable voice/video calls via Jitsi (optional)

## SSO

Mattermost uses its GitLab-compatible OIDC flow pointed at Keycloak. On first login you will be taken to Keycloak to authenticate. The OIDC client is auto-provisioned by the Gezelligate renderer; no manual Keycloak configuration is required.

The first user to sign in via SSO becomes the Mattermost system admin.

## Notes

- MVP stores files in a local Docker volume. For production, consider swapping to S3 via `FileSettings.DriverName=amazons3` env vars.
- The Mattermost "Calls" plugin is NOT installed in MVP. Voice/video goes through Jitsi (enabled via the `enableCalls` form field) which opens conference links in a new tab.
