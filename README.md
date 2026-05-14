# gezelligate-catalog

Versioned catalog of **recipes** (service definitions) and **providers** (Kubernetes cluster providers) consumed by [`@gezelligate/studio`](https://github.com/spatialexplorers/gezelligate) and `@gezelligate/cli`.

This repo is the source of truth for what services and cloud providers Gezelligate knows about. Users never clone this repo directly — the Studio fetches it on first run as a versioned HTTPS tarball and caches it inside their project at `.gezelligate/catalog/<ref>/`.

## Layout

```
recipes/        # service definitions: <name>/service.yaml + templates/ + README.md (+ assets/icon.svg)
providers/      # cluster providers: <name>/provider.yaml + templates/ + lifecycle.ts
catalog.json    # generated index — every recipe + provider, metadata only, no templates
```

## Adding a recipe

```sh
npx @gezelligate/dev new recipe <name>
```

…or copy an existing recipe in `recipes/` as a starting point. Each recipe is a self-contained bundle:

- `service.yaml` — recipe manifest (schema in `@gezelligate/core/schema/serviceYaml`)
- `templates/` — Handlebars templates that the renderer fills in
- `README.md` — what the service is, why you'd enable it
- `assets/icon.svg` — optional, shown by the bridge launcher

## Adding a provider

```sh
npx @gezelligate/dev new provider <name>
```

Providers ship a typed `provider.yaml`, OpenTofu templates, and a `lifecycle.ts` plugin module that handles credential validation + deploy-time hooks.

## Local development

Point the Studio at this checkout instead of fetching a tarball:

```sh
cd <your-project-dir>
npx @gezelligate/studio --catalog-dir /path/to/this/checkout
```

The Studio reads recipes/providers directly off disk — edit a template, refresh the wizard, see the change.

## Releases

Releases are auto-tagged on green main. User projects pin a release tag in `services/.gezelligate.json`; bumping the pin is opt-in via `gezelligate catalog update`.

## Validation (planned)

CI runs:
1. Schema validation on every recipe + provider yaml.
2. Smoke render of every recipe against every provider, with synthetic inputs.
3. `kubeconform` on the rendered Kubernetes manifests.
4. `docker compose config` on the rendered compose files.
5. Recipe-level `vitest` tests under each recipe's `tests/` dir.

The validation script lives at `scripts/validate.ts` and the workflow at `.github/workflows/validate.yml`.
