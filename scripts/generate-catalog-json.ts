// Generates catalog.json at the repo root: a flat index of every recipe and
// provider with metadata only (no templates). This is the manifest the
// Studio fetches before any per-recipe content, so it's the lightest possible
// surface for "what does this catalog contain?".
//
// Run via `pnpm generate-catalog-json` (or `npm run` / `tsx scripts/...`).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

interface RecipeMeta {
  name: string;
  displayName: string;
  category: string;
  description: string;
  required: boolean;
  hidden?: boolean;
}

interface ProviderMeta {
  name: string;
  displayName: string;
}

interface CatalogIndex {
  recipes: RecipeMeta[];
  providers: ProviderMeta[];
  ref: string;
  generatedAt: string;
}

async function readYaml(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = yaml.load(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${filePath}: expected an object, got ${typeof parsed}`);
  }
  return parsed as Record<string, unknown>;
}

async function listDirs(parent: string): Promise<string[]> {
  const entries = await fs.readdir(parent, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
    .map((e) => e.name);
}

async function collectRecipes(): Promise<RecipeMeta[]> {
  const recipesDir = path.join(root, "recipes");
  const names = await listDirs(recipesDir);
  const out: RecipeMeta[] = [];
  for (const name of names) {
    const yamlPath = path.join(recipesDir, name, "service.yaml");
    try {
      await fs.access(yamlPath);
    } catch {
      console.warn(`skipping ${name}: no service.yaml`);
      continue;
    }
    const data = await readYaml(yamlPath);
    out.push({
      name: String(data.name ?? name),
      displayName: String(data.displayName ?? name),
      category: String(data.category ?? "other"),
      description: String(data.description ?? ""),
      required: Boolean(data.required ?? false),
      ...(data.hidden ? { hidden: true } : {})
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function collectProviders(): Promise<ProviderMeta[]> {
  const providersDir = path.join(root, "providers");
  const names = await listDirs(providersDir);
  const out: ProviderMeta[] = [];
  for (const name of names) {
    const yamlPath = path.join(providersDir, name, "provider.yaml");
    try {
      await fs.access(yamlPath);
    } catch {
      console.warn(`skipping provider ${name}: no provider.yaml`);
      continue;
    }
    const data = await readYaml(yamlPath);
    out.push({
      name: String(data.name ?? name),
      displayName: String(data.displayName ?? name)
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function readGitRef(): string {
  // GitHub Actions sets GITHUB_REF (refs/tags/v0.1.0) and GITHUB_SHA.
  // Locally, the generated catalog.json embeds whatever's in the env or "local".
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  return "local";
}

async function main(): Promise<void> {
  const recipes = await collectRecipes();
  const providers = await collectProviders();
  const index: CatalogIndex = {
    recipes,
    providers,
    ref: readGitRef(),
    generatedAt: new Date().toISOString()
  };
  const out = JSON.stringify(index, null, 2) + "\n";
  await fs.writeFile(path.join(root, "catalog.json"), out, "utf8");
  console.log(`wrote catalog.json: ${recipes.length} recipes, ${providers.length} providers`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
