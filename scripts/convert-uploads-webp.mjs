#!/usr/bin/env node

/**
 * Convert a photo library of PNG uploads to WebP and generate thumbnails.
 *
 * - Converts every PNG under <uploadsDir> to WebP (max 1920px, q82).
 * - Deletes the original PNG after a successful conversion.
 * - Generates a `*_thumb.webp` (max 480px, q70) next to each image for
 *   list/grid covers; the full image is only loaded on detail views.
 * - Rewrites `/uploads/*.png` references to the converted extension in every
 *   text file under <contentRoot> (only when the converted file exists).
 *
 * Idempotent: already-converted sources are skipped.
 *
 * Usage: node convert-uploads-webp.mjs [uploadsDir] [contentRoot]
 *   uploadsDir  default: public/uploads
 *   contentRoot default: public
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const MAX_DIMENSION = 1920;
const WEBP_QUALITY = 82;
const THUMB_DIMENSION = 480;
const THUMB_QUALITY = 70;

const uploadsDir = path.resolve(process.argv[2] ?? path.join('public', 'uploads'));
const contentRoot = path.resolve(process.argv[3] ?? 'public');

if (!existsSync(uploadsDir)) {
  console.error(`uploads dir not found: ${uploadsDir}`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

async function convert() {
  const pngs = walk(uploadsDir).filter((f) => f.toLowerCase().endsWith('.png'));
  let converted = 0;
  let savedBytes = 0;

  for (const png of pngs) {
    const webp = png.replace(/\.png$/i, '.webp');
    if (existsSync(webp)) continue;

    const before = statSync(png).size;
    const image = sharp(png, { failOn: 'none' }).rotate();
    const meta = await image.metadata();
    if (Math.max(meta.width ?? 0, meta.height ?? 0) > MAX_DIMENSION) {
      image.resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside' });
    }
    await image.webp({ quality: WEBP_QUALITY }).toFile(webp);

    const after = statSync(webp).size;
    if (after <= 0) {
      console.error(`empty output, keeping original: ${png}`);
      continue;
    }
    unlinkSync(png);
    converted += 1;
    savedBytes += before - after;
    if (converted % 50 === 0) {
      console.log(`  converted ${converted}/${pngs.length}...`);
    }
  }

  console.log(`converted ${converted} PNG(s), saved ${(savedBytes / 1024 / 1024).toFixed(1)} MB`);
}

async function generateThumbs() {
  const webps = walk(uploadsDir).filter(
    (f) => f.toLowerCase().endsWith('.webp') && !f.toLowerCase().endsWith('_thumb.webp'),
  );
  let created = 0;
  for (const webp of webps) {
    const thumb = webp.replace(/\.webp$/i, '_thumb.webp');
    if (existsSync(thumb)) continue;
    await sharp(webp, { failOn: 'none' })
      .rotate()
      .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: 'inside' })
      .webp({ quality: THUMB_QUALITY })
      .toFile(thumb);
    created += 1;
    if (created % 100 === 0) console.log(`  thumbs ${created}/${webps.length}...`);
  }
  console.log(`generated ${created} thumbnail(s)`);
}

function rewriteReferences() {
  const textExt = new Set(['.php', '.json', '.js', '.css', '.html', '.txt', '.xml', '.yaml', '.yml', '.md']);
  if (!existsSync(contentRoot)) {
    console.log(`content root not found, skipping reference rewrite: ${contentRoot}`);
    return;
  }
  const files = walk(contentRoot).filter((f) => {
    if (!textExt.has(path.extname(f).toLowerCase())) return false;
    const content = readFileSync(f, 'utf8');
    return /\/uploads\/[^"')\s,]+\.png/gi.test(content);
  });

  let changed = 0;
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const next = content.replace(/(\/uploads\/[^"')\s,]+)\.png/gi, (match, base) => {
      const webp = path.join(uploadsDir, base.replace(/^\//, '').split('/').slice(2).join('/') + '.webp');
      return existsSync(webp) ? `${base}.webp` : match;
    });
    if (next !== content) {
      writeFileSync(file, next);
      changed += 1;
      console.log(`  rewrote references in ${path.relative(process.cwd(), file)}`);
    }
  }
  console.log(`updated ${changed} data file(s)`);
}

await convert();
await generateThumbs();
rewriteReferences();
