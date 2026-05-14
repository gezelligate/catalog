# Shared Redis

Single Redis instance shared by services that opt in with `redis.shared: true`.

Auto-included — you will never see it in the wizard, and you cannot disable it. The renderer pulls it in whenever at least one service declares `redis.shared: true`.

## How it works

All consumers connect to `redis://redis:6379/0`. Isolation between consumers is by **key prefix** — Django's cache framework and LiveKit both prefix every key by default, so two consumers using the same logical DB do not collide.

## What it persists

AOF persistence is on. Restart-safe for cache-like workloads (session storage, Celery results). Not a database.

## Security

- No AUTH password. Traffic is unencrypted on the in-compose / in-cluster network. Public exposure (Caddyfile / Ingress) is not configured.
- If you need AUTH later, add it in a self-contained plan: a `REDIS_PASSWORD` generated secret on this bundle, plus a `--requirepass` arg, plus an updated connection string in every consumer.

## Adding a new consumer service later

Set `redis: { shared: true }` in the consumer's `service.yaml`. Re-render. The dependency resolver auto-includes this bundle.
