#!/usr/bin/env node

// Audit content YAML image references.
//
// Catches the "silent placeholder" failure mode where a product entry omits
// `mainImage` and no slug-named fallback image exists under
// public/images/products/ (or an explicit mainImage points at a missing file).
//
// Usage:
//   node scripts/audit-content-images.mjs           # fail on any problem
//   node scripts/audit-content-images.mjs --warn-only

import { existsSync, readdirSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const contentRoot = path.join(projectRoot, 'src', 'content');
const publicRoot = path.join(projectRoot, 'public');
const warnOnly = process.argv.includes('--warn-only');

const imageFieldPattern = /^(?:mainImage|image|heroImage|logoPath|defaultOgImage|storyImage)$/;
const siteRootRefPattern = /^\/(?:images|assets\/images)\/[^\s"']+$/;
const productImageExtensions = ['.webp', '.png', '.jpg', '.jpeg', '.svg'];

async function collectYamlFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectYamlFiles(entryPath);
      if (entry.isFile() && /\.(yaml|yml)$/i.test(entry.name)) return [entryPath];
      return [];
    }),
  );
  return nested.flat();
}

function siteRootPathToFilesystem(ref) {
  return path.join(publicRoot, ref.replace(/^\//, '').split('/').join(path.sep));
}

function exactCasePathExists(ref) {
  let current = publicRoot;
  const segments = ref.replace(/^\//, '').split('/').filter(Boolean);
  for (const segment of segments) {
    if (!existsSync(current)) return false;
    let entries = [];
    try {
      entries = readdirSync(current);
    } catch {
      return false;
    }
    const matched = entries.find((entry) => entry === segment);
    if (!matched) return false;
    current = path.join(current, matched);
  }
  return existsSync(current);
}

function slugProductImageExists(slug) {
  const imageDir = path.join(publicRoot, 'images', 'products');
  if (!existsSync(imageDir)) return false;
  let entries = [];
  try {
    entries = readdirSync(imageDir);
  } catch {
    return false;
  }
  return productImageExtensions.some((extension) => entries.includes(`${slug}${extension}`));
}

const problems = [];
const productsDir = path.join(contentRoot, 'products');
const productFiles = await collectYamlFiles(productsDir);

for (const file of productFiles) {
  const raw = await readFile(file, 'utf8');
  // The Keystatic products schema may use the generic `image` field; only fall
  // back to the legacy slug-named check when no image field is present.
  const hasImageField = /^\s*(?:mainImage|image|heroImage)\s*:\s*\S/m.test(raw);
  if (!hasImageField) {
    const slug = path.basename(file).replace(/\.(yaml|yml)$/i, '');
    if (!slugProductImageExists(slug)) {
      problems.push({
        file,
        message: `products entry is missing an image field and no slug-named image exists in public/images/products/ (card would silently show a placeholder)`,
      });
    }
  }
}

const yamlFiles = await collectYamlFiles(contentRoot);
for (const file of yamlFiles) {
  const raw = await readFile(file, 'utf8');
  for (const rawLine of raw.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    const [, field, rawValue] = match;
    if (!imageFieldPattern.test(field)) continue;
    const value = rawValue.replace(/^["']|["']$/g, '');
    if (value === '' || value.includes('${') || value.includes('{')) continue;
    if (!siteRootRefPattern.test(value)) {
      problems.push({ file, message: `${field} is not a site-root /images/... URL: ${value}` });
      continue;
    }
    if (!exactCasePathExists(value)) {
      problems.push({ file, message: `${field} points to a missing file: ${value}` });
    }
  }
}

if (problems.length > 0) {
  const label = warnOnly ? 'WARNING' : 'ERROR';
  console.error(`Content image audit: ${problems.length} problem(s) found.`);
  for (const problem of problems) {
    console.error(`  ${label}: ${path.relative(projectRoot, problem.file)}`);
    console.error(`    ${problem.message}`);
  }
  if (!warnOnly) process.exit(1);
  process.exit(0);
}

console.log(`Content image audit passed: ${productFiles.length} product(s), all image references resolve.`);
