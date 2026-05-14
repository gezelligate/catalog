// Catalog validation entry — invoked by CI to fail fast on malformed yaml or
// missing required files in any recipe / provider.
//
// Today this is a minimal structural check (every recipe has a service.yaml
// readable as YAML, every provider has a provider.yaml + lifecycle.ts). The
// full schema check + smoke-render + kubeconform pipeline lands once
// @gezelligate/dev is published to npm — at that point this script becomes
// `gezelligate-dev validate && gezelligate-dev render --all && gezelligate-dev lint`.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

class ValidationError extends Error {
  constructor(public file: string, message: string) {
    super(`${file}: ${message}`);
  }
}

async function readYaml(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return yaml.load(raw);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listDirs(parent: string): Promise<string[]> {
  const entries = await fs.readdir(parent, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
    .map((e) => e.name);
}

async function validateRecipe(name: string): Promise<void> {
  const dir = path.join(root, "recipes", name);
  const yamlPath = path.join(dir, "service.yaml");
  if (!(await exists(yamlPath))) {
    throw new ValidationError(yamlPath, "missing service.yaml");
  }
  const parsed = await readYaml(yamlPath);
  if (typeof parsed !== "object" || parsed === null) {
    throw new ValidationError(yamlPath, `expected object, got ${typeof parsed}`);
  }
  const data = parsed as Record<string, unknown>;
  for (const field of ["name", "displayName", "category"]) {
    if (typeof data[field] !== "string") {
      throw new ValidationError(yamlPath, `missing or non-string field: ${field}`);
    }
  }
  if (data.name !== name) {
    throw new ValidationError(yamlPath, `name "${data.name as string}" does not match directory "${name}"`);
  }
}

async function validateProvider(name: string): Promise<void> {
  const dir = path.join(root, "providers", name);
  const yamlPath = path.join(dir, "provider.yaml");
  const lifecyclePath = path.join(dir, "lifecycle.ts");
  if (!(await exists(yamlPath))) {
    throw new ValidationError(yamlPath, "missing provider.yaml");
  }
  if (!(await exists(lifecyclePath))) {
    throw new ValidationError(lifecyclePath, "missing lifecycle.ts");
  }
  const parsed = await readYaml(yamlPath);
  if (typeof parsed !== "object" || parsed === null) {
    throw new ValidationError(yamlPath, `expected object, got ${typeof parsed}`);
  }
  const data = parsed as Record<string, unknown>;
  // lifecycleModule is optional and defaults to "lifecycle.ts" in the schema —
  // we only assert the file referenced (or the default) actually exists.
  for (const field of ["name", "displayName"]) {
    if (typeof data[field] !== "string") {
      throw new ValidationError(yamlPath, `missing or non-string field: ${field}`);
    }
  }
  const lifecycleModule = typeof data.lifecycleModule === "string" ? data.lifecycleModule : "lifecycle.ts";
  const lifecycleFile = path.join(dir, lifecycleModule);
  if (!(await exists(lifecycleFile))) {
    throw new ValidationError(lifecycleFile, `lifecycleModule "${lifecycleModule}" not found`);
  }
  if (data.name !== name) {
    throw new ValidationError(yamlPath, `name "${data.name as string}" does not match directory "${name}"`);
  }
}

async function main(): Promise<void> {
  const recipes = await listDirs(path.join(root, "recipes"));
  const providers = await listDirs(path.join(root, "providers"));
  const errors: ValidationError[] = [];

  for (const name of recipes) {
    try {
      await validateRecipe(name);
    } catch (err) {
      if (err instanceof ValidationError) errors.push(err);
      else throw err;
    }
  }

  for (const name of providers) {
    try {
      await validateProvider(name);
    } catch (err) {
      if (err instanceof ValidationError) errors.push(err);
      else throw err;
    }
  }

  if (errors.length > 0) {
    for (const e of errors) console.error("✘", e.message);
    console.error(`\n${errors.length} validation error(s) across ${recipes.length} recipes + ${providers.length} providers.`);
    process.exit(1);
  }
  console.log(`✓ ${recipes.length} recipes + ${providers.length} providers validated`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
