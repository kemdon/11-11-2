#!/usr/bin/env node

/**
 * validate-locale-keys.mjs
 *
 * Scans i18n-output locale YAML files for structural key corruption.
 * Reports any keys that should remain English but got translated.
 *
 * Usage:
 *   node validate-locale-keys.mjs --root i18n-output
 *   node validate-locale-keys.mjs --root i18n-output --locale ja
 *
 * Exit code: 0 if all valid, 1 if violations found.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const ENGLISH_NAV_KEYS = new Set(['home', 'about', 'products', 'news', 'contact']);
const ENGLISH_CONTACT_TYPES = new Set(['phone', 'email', 'whatsapp', 'inquiry']);
const ENGLISH_PLATFORMS = new Set(['facebook', 'youtube', 'pinterest', 'instagram', 'whatsapp', 'linkedin', 'tiktok', 'twitter', 'x']);
const ENGLISH_CATEGORY_SLUGS = new Set([
  'folding-storage-box', 'camping-folding-box', 'divided-serving-tray',
  'pet-storage-organizer', 'medicine-box', 'storage-box', 'storage-cabinet',
]);
const SUPPORTED_LOCALE_CODES = new Set([
  'en', 'zh-cn', 'zh-tw', 'es', 'pt-br', 'fr', 'de', 'it', 'nl', 'pl',
  'ru', 'tr', 'ar', 'hi', 'id', 'vi', 'th', 'ja', 'ko', 'ms',
]);

function parseArgs(argv) {
  const options = { root: 'i18n-output', locale: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--root':
        options.root = argv[++i] || 'i18n-output';
        break;
      case '--locale':
        options.locale = argv[++i] || null;
        break;
      case '--verbose':
        options.verbose = true;
        break;
    }
  }
  return options;
}

const violations = [];

function report(filePath, keyPath, value, expected) {
  violations.push({ file: filePath.replace(/\\/g, '/'), keyPath, value, expected });
}

function inferExpected(key) {
  if (key === 'key' || key === 'type') return 'English enum value';
  if (key === 'platform') return 'English platform name';
  if (key === 'categorySlug') return 'English category slug';
  if (key === 'code') return 'locale code';
  return 'untranslated English value';
}

function isEnglish(value) {
  return /^[a-zA-Z0-9_-]+$/.test(value) && /[a-zA-Z]/.test(value);
}

function validateStruct(value, filePath, keyPath, parentKey) {
  if (typeof value === 'string') {
    // Check known key positions
    if (parentKey === 'key' && !ENGLISH_NAV_KEYS.has(value) && !isEnglish(value)) {
      report(filePath, keyPath, value, 'navigation key (home/about/products/news/contact)');
    }
    if (parentKey === 'type' && !ENGLISH_CONTACT_TYPES.has(value) && isEnglish(value) === false) {
      report(filePath, keyPath, value, 'contact type (phone/email/whatsapp/inquiry)');
    }
    if (parentKey === 'platform' && !ENGLISH_PLATFORMS.has(value.toLowerCase()) && !isEnglish(value)) {
      report(filePath, keyPath, value, 'platform name (facebook/youtube/pinterest/etc)');
    }
    if (parentKey === 'categorySlug' && !ENGLISH_CATEGORY_SLUGS.has(value) && !isEnglish(value)) {
      report(filePath, keyPath, value, 'category slug');
    }
    if (parentKey === 'code' && !SUPPORTED_LOCALE_CODES.has(value.toLowerCase()) && !isEnglish(value)) {
      // Locale codes are special — they might be valid patterns
      const validPattern = /^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/;
      if (!validPattern.test(value)) {
        report(filePath, keyPath, value, 'locale code (en/zh-CN/es/etc)');
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validateStruct(item, filePath, `${keyPath}[${index}]`, parentKey);
    });
    return;
  }

  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      validateStruct(v, filePath, `${keyPath}.${k}`, k);
    }
  }
}

async function walkYamlFiles(dirPath) {
  const results = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkYamlFiles(fullPath));
    } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
      results.push(fullPath);
    }
  }
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rootPath = path.resolve(options.root);

  if (!await fs.stat(rootPath).catch(() => null)) {
    console.error(`Error: root path not found: ${rootPath}`);
    process.exit(1);
  }

  const dirs = options.locale
    ? [path.join(rootPath, options.locale)]
    : (await fs.readdir(rootPath, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => path.join(rootPath, d.name));

  for (const dir of dirs) {
    const localeName = path.basename(dir);
    const files = await walkYamlFiles(dir);
    for (const filePath of files) {
      if (options.verbose) console.error(`Scanning: ${path.relative(rootPath, filePath)}`);
      const raw = await fs.readFile(filePath, 'utf8');
      try {
        const parsed = parseYaml(raw);
        validateStruct(parsed, path.relative(rootPath, filePath), 'root', '');
      } catch (parseError) {
        console.error(`Parse error in ${filePath}: ${parseError.message}`);
      }
    }
    if (files.length > 0) {
      console.error(`Checked ${files.length} files for locale: ${localeName}`);
    }
  }

  if (violations.length > 0) {
    console.error(`\nFound ${violations.length} structural key violation(s):\n`);
    for (const v of violations) {
      console.error(`  ${v.file}`);
      console.error(`    ${v.keyPath} = "${v.value}"`);
      console.error(`    Expected: ${v.expected}`);
      console.error();
    }
    process.exit(1);
  }

  console.error('All locale keys valid.');
}

main();
