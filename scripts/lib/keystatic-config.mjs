/**
 * Introspect the Keystatic content model from tooling.
 *
 * Audits need the real schema (field kinds, image directories, nested object
 * and array shapes), not a regex over keystatic.config.ts. The config is
 * TypeScript, so it is transpiled and imported from a throwaway file inside the
 * repo: bare `@keystatic/core` imports have to resolve against the project's
 * node_modules, which a `data:` URL cannot do.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';

export async function loadKeystaticConfig(repoRoot) {
  const source = await readFile(path.join(repoRoot, 'keystatic.config.ts'), 'utf8');
  const output = ts
    .transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText
    .replaceAll('import.meta.env.PUBLIC_KEYSTATIC_PREVIEW_ORIGIN', 'undefined');

  // `.astro/` is git-ignored and inside the project, so bare imports resolve.
  const scratchDir = path.join(repoRoot, '.astro');
  await mkdir(scratchDir, { recursive: true });
  const scratchFile = path.join(scratchDir, `keystatic-config-audit-${process.pid}.mjs`);
  await writeFile(scratchFile, output, 'utf8');
  try {
    const module = await import(pathToFileURL(scratchFile).href);
    return module.default;
  } finally {
    await rm(scratchFile, { force: true });
  }
}

/** Keystatic field -> serialisable shape (object / array / image / scalar). */
export function fieldShape(field) {
  if (!field || typeof field !== 'object') return { type: 'scalar' };
  if (field.kind === 'object') {
    return { type: 'object', children: fieldTree(field.fields) };
  }
  if (field.kind === 'array') {
    return { type: 'array', element: fieldShape(field.element) };
  }
  // Keystatic exposes image fields as `form` fields with formKind `asset`
  // (`fields.image`). The write directory is the only root the runtime keeps.
  if (field.kind === 'image' || (field.kind === 'form' && field.formKind === 'asset')) {
    return { type: 'image', directory: field.directory };
  }
  return { type: 'scalar' };
}

export function fieldTree(fields) {
  const children = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    children[key] = fieldShape(value);
  }
  return children;
}

/** @returns {{name: string, kind: 'singleton'|'collection', path: string, label?: string, schema: object}[]} */
export function listEntries(config) {
  return [
    ...Object.entries(config.singletons ?? {}).map(([name, value]) => ({
      name,
      kind: 'singleton',
      path: value.path,
      label: value.label,
      schema: { type: 'object', children: fieldTree(value.schema) },
    })),
    ...Object.entries(config.collections ?? {}).map(([name, value]) => ({
      name,
      kind: 'collection',
      path: value.path,
      label: value.label,
      schema: { type: 'object', children: fieldTree(value.schema) },
    })),
  ];
}

export function toPosix(value) {
  return value.replace(/\\/g, '/');
}

/** Content files behind a Keystatic `path` ('src/x/y' or 'src/x/*'). */
export async function contentFilesForEntry(repoRoot, entryPath) {
  const normalized = toPosix(entryPath);
  if (normalized.endsWith('/*')) {
    const directory = path.join(repoRoot, normalized.slice(0, -2));
    const names = await readdir(directory).catch(() => []);
    return names
      .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
      .sort()
      .map((name) => path.join(directory, name));
  }
  const files = [];
  for (const extension of ['.yaml', '.yml']) {
    const candidate = path.join(repoRoot, `${normalized}${extension}`);
    const exists = await readFile(candidate, 'utf8').catch(() => null);
    if (exists !== null) files.push(candidate);
  }
  return files;
}

export async function readYamlFile(file) {
  return parseYaml(await readFile(file, 'utf8')) ?? {};
}

/** Read every entry through Keystatic's own reader (the admin's validation). */
export async function readEntriesWithKeystatic(repoRoot, config, entries) {
  const { createReader } = await import('@keystatic/core/reader');
  const reader = createReader(repoRoot, config);
  const results = [];
  for (const entry of entries) {
    try {
      if (entry.kind === 'singleton') {
        await reader.singletons[entry.name].read();
      } else {
        const slugs = await reader.collections[entry.name].list();
        for (const slug of slugs) {
          await reader.collections[entry.name].read(slug);
        }
      }
      results.push({ name: entry.name, ok: true });
    } catch (error) {
      results.push({
        name: entry.name,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
