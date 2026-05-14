# Shared PostgreSQL

Single Postgres instance shared by services that opt in with `database.shared: true`.

Auto-included — you will never see it in the wizard, and you cannot disable it. The renderer pulls it in whenever at least one service needs a shared database. Disable it by setting every service's database block to the sidecar form (not recommended — wastes ~200 MB of RAM per service).

## How it works

At render time, the renderer walks every enabled service with `database.shared: true` and builds an `init.sql` that runs `CREATE USER` + `CREATE DATABASE` for each one. That SQL is mounted into `/docker-entrypoint-initdb.d/` (Docker) or emitted as a ConfigMap (k8s). Postgres only runs init scripts on **first boot against an empty data volume**.

## Adding a new consumer service later

Because init scripts don't re-run, enabling a new consumer after the Postgres volume already exists means the new service's user + database won't be created automatically. Options:

1. **Nuclear (safe for dev):** `docker compose down -v` — wipes the volume, everything re-inits.
2. **Surgical (prod):** `docker compose exec postgres psql -U postgres -f /docker-entrypoint-initdb.d/init.sql` — idempotent CREATE USER / CREATE DATABASE will succeed for new entries and silently fail for existing ones (see init.sql for the `DO` block wrapping).

## Security

- Traffic is unencrypted (in-compose network / in-cluster). Public exposure via the Caddyfile/ingress is not configured.
- The superuser password is generated once into `services/postgres/.env` (Docker) or a Secret (k8s). Never commit that file.
