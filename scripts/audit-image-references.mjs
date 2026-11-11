#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const sourceRoots = ['src', 'i18n-output'];
const checkBuilt = process.argv.includes('--built');
const imageRefPattern = /\/assets\/images\/[^\s"'`)<>]+|\/images\/[^\s"'`)<>]+/g;
const imageFilePattern = /\.(?:webp|png|jpe?g|gif|svg|avif|ico|bmp)$/i;
const localPathPattern = /(?<![A-Za-z])(?:[A-Za-z]:[\\/](?![\\/])|\\\\[A-Za-z0-9._$-]+[\\/])[^\s"'`)<>]+/g;
const textFilePattern = /\.(astro|css|html|js|jsx|md|mdx|mjs|ts|tsx|yaml|yml)$/i;

async function collectFiles(dir) {
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(entryPath);
    }
    if (entry.isFile() && textFilePattern.test(entry.name)) {
      return [entryPath];
    }
    return [];
  }));

  return nested.flat();
}

function cleanImageRef(ref) {
  return ref.split(/[?#&]/, 1)[0].replace(/[.,;:]+$/g, '');
}

function isDynamicImageRef(ref) {
  return ref.includes('${') || ref.includes('{') || ref.includes('}');
}

function isImageFileRef(ref) {
  return imageFilePattern.test(ref);
}

function recordRef(refs, ref, filePath) {
  if (!refs.has(ref)) refs.set(ref, []);
  refs.get(ref).push(path.relative(projectRoot, filePath));
}

async function exactCasePathExists(root, publicPath) {
  let current = root;
  const segments = publicPath.replace(/^\//, '').split('/').filter(Boolean);

  for (const segment of segments) {
    if (!existsSync(current)) return false;

    const entries = await readdir(current, { withFileTypes: true });
    const matchedEntry = entries.find((entry) => entry.name === segment);
    if (!matchedEntry) return false;

    current = path.join(current, matchedEntry.name);
  }

  return existsSync(current);
}

const sourceFiles = checkBuilt
  ? []
  : (await Promise.all(sourceRoots.map((root) => collectFiles(path.join(projectRoot, root))))).flat();

const refs = new Map();
const dynamicRefs = new Map();
const ignoredRefs = new Map();
const localPathRefs = [];

for (const filePath of sourceFiles) {
  const raw = await readFile(filePath, 'utf8');
  const matches = raw.matchAll(imageRefPattern);

  for (const match of matches) {
    const ref = cleanImageRef(match[0]);
    if (isDynamicImageRef(ref)) recordRef(dynamicRefs, ref, filePath);
    else if (isImageFileRef(ref)) recordRef(refs, ref, filePath);
    else recordRef(ignoredRefs, ref, filePath);
  }

  const localPathMatches = raw.matchAll(localPathPattern);
  for (const match of localPathMatches) {
    localPathRefs.push({
      ref: cleanImageRef(match[0]),
      sourceFile: path.relative(projectRoot, filePath),
    });
  }
}

if (checkBuilt) {
  const builtFiles = await collectFiles(path.join(projectRoot, 'dist'));
  for (const filePath of builtFiles) {
    const raw = await readFile(filePath, 'utf8');
    for (const match of raw.matchAll(imageRefPattern)) {
      const ref = cleanImageRef(match[0]);
      if (isDynamicImageRef(ref)) continue;
      if (isImageFileRef(ref)) recordRef(refs, ref, filePath);
      else recordRef(ignoredRefs, ref, filePath);
    }
  }
}

if (localPathRefs.length > 0) {
  console.error('Local filesystem paths found in web content. Copy assets into public/ and reference them with site-root URLs such as /images/...');
  for (const item of localPathRefs.slice(0, 20)) {
    console.error(`  ${item.ref}`);
    console.error(`    referenced by ${item.sourceFile}`);
  }
  if (localPathRefs.length > 20) {
    console.error(`  ...and ${localPathRefs.length - 20} more local path reference(s)`);
  }
  process.exit(1);
}

if (dynamicRefs.size > 0) {
  const nextStep = checkBuilt
    ? 'Concrete image URLs emitted into dist were audited instead.'
    : 'Use complete /images/... values in data when possible, then run the --built audit after building.';
  console.warn(`Skipped ${dynamicRefs.size} dynamic image template(s) that are not literal asset paths. ${nextStep}`);
}

if (ignoredRefs.size > 0) {
  console.warn(`Skipped ${ignoredRefs.size} non-file image path(s) without a file extension (directory or route references).`);
}

const missing = [];
for (const [ref, sourceFiles] of refs) {
  const existsWithExactCase = await exactCasePathExists(path.join(projectRoot, checkBuilt ? 'dist' : 'public'), ref);
  if (!existsWithExactCase) {
    missing.push({ ref, sourceFiles: [...new Set(sourceFiles)] });
  }
}

if (missing.length > 0) {
  console.error(`Missing ${checkBuilt ? 'built' : 'public'} image assets:`);
  for (const item of missing) {
    console.error(`  ${item.ref}`);
    for (const sourceFile of item.sourceFiles.slice(0, 5)) {
      console.error(`    referenced by ${sourceFile}`);
    }
  }
  process.exit(1);
}

console.log(`Image reference audit passed: ${refs.size} image paths found in ${checkBuilt ? 'dist' : 'public'}.`);
