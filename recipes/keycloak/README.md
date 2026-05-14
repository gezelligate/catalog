# Keycloak

Identity and SSO provider for the Gezelligate stack.

## What it provides

- A `gezelligate` realm, auto-imported on first boot
- An `admin` user (password in your secrets summary)
- OIDC clients for every other enabled service

## Form fields

- `subdomain` — the subdomain Keycloak is served on (default: `auth`)

## Notes

Keycloak is required and cannot be disabled. The realm is generated from every other enabled service's `provides.oidcClient` declaration.
