#!/usr/bin/env node

/**
 * Post-build image optimizer for the clone-driven static frontsite.
 *
 * The `clone/assets/images` tree ships original JPEG/PNG files that are much
 * larger than the rendered layout needs (several are 8–15 MB). This script
 * converts every image to a resized WebP, rewrites all `dist` references to
 * point at the WebP, and removes the oversized originals so only optimised
 * bytes are uploaded to Cloudflare Pages.
 *
 * Run after `pnpm run build` and before `wrangler pages deploy dist`.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const MAX_DIMENSION = 1920;
const WEBP_QUALITY = 82;
const IMAGES_SUBDIR = path.join('assets', 'images');
const textExtensions = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.txt', '.xml', '.svg']);

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function toRootUrl(distRoot, file) {
  return '/' + path.relative(distRoot, file).split(path.sep).join('/');
}

const distRoot = path.resolve('dist');
const imagesDir = path.join(distRoot, IMAGES_SUBDIR);

if (!existsSync(imagesDir)) {
  console.log('No image directory found under dist; skip image optimization.');
  process.exit(0);
}

const imageFiles = walk(imagesDir).filter((file) => /\.(jpe?g|png)$/i.test(file));
if (imageFiles.length === 0) {
  console.log('No JPEG/PNG images found; skip image optimization.');
  process.exit(0);
}

const replacements = new Map(); // original root URL -> webp root URL

for (const file of imageFiles) {
  const originalUrl = toRootUrl(distRoot, file);
  const webpUrl = originalUrl.replace(/\.(jpe?g|png)$/i, '.webp');
  const webpFile = path.join(distRoot, webpUrl.replace(/^\//, ''));

  mkdirSync(path.dirname(webpFile), { recursive: true });

  const inputSize = statSync(file).size;
  try {
    await sharp(file)
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toFile(webpFile);
  } catch (error) {
    console.warn(`Skipping ${originalUrl}: ${error.message}`);
    continue;
  }

  const outputSize = statSync(webpFile).size;
  replacements.set(originalUrl, webpUrl);
  console.log(`  ${originalUrl}  ${(inputSize / 1024).toFixed(0)}KB -> ${(outputSize / 1024).toFixed(0)}KB webp`);
}

if (replacements.size === 0) {
  console.log('No images could be converted; leaving references unchanged.');
  process.exit(0);
}

// Rewrite every text file in dist that references an original image URL.
let rewrittenFiles = 0;
for (const file of walk(distRoot)) {
  const ext = path.extname(file).toLowerCase();
  if (!textExtensions.has(ext) || statSync(file).size > 8 * 1024 * 1024) continue;

  let content = readFileSync(file, 'utf8');
  let changed = false;
  for (const [originalUrl, webpUrl] of replacements) {
    if (content.includes(originalUrl)) {
      content = content.split(originalUrl).join(webpUrl);
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(file, content);
    rewrittenFiles += 1;
  }
}

// Drop the oversized originals so they are never uploaded.
for (const originalUrl of replacements.keys()) {
  const originalFile = path.join(distRoot, originalUrl.replace(/^\//, ''));
  if (existsSync(originalFile)) unlinkSync(originalFile);
}

console.log(`Image optimization complete: ${replacements.size} images -> webp, ${rewrittenFiles} file(s) rewritten.`);
