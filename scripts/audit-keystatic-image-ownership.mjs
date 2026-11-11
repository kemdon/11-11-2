#!/usr/bin/env node
/**
 * Audit Keystatic image fields against the image values stored in content.
 *
 * In local storage mode Keystatic owns one folder per image field: an upload is
 * written to <field.directory>/<...>/<filename> and the value stored in the
 * content file is the public URL of that file. Two consequences are checked
 * here, because both of them delete a file the site still links to:
 *
 *   1. a stored value that points outside its own field's directory
 *      -> the next save rewrites the path and removes the file it used to point at
 *   2. one file referenced by more than one field (or by two entries)
 *      -> saving either one moves the file and breaks the other reference
 *
 * Filename normalisation inside the field's own directory is out of scope: it
 * renames a file but only one the same field already owns.
 *
 * Usage: node ./scripts/audit-keystatic-image-ownership.mjs [projectRoot]
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  contentFilesForEntry,
  listEntries,
  loadKeystaticConfig,
  readYamlFile,
  toPosix,
} from './lib/keystatic-config.mjs';

const repoRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(repoRoot, 'public');
const issues = [];
const occurrences = new Map();
let imageFieldCount = 0;
let imageValueCount = 0;

function isRemote(value) {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || value.startsWith('data:');
}

/**
 * Walk the schema once and record every image field: its dotted content path,
 * its write directory / public root, and the shape object itself so the same
 * traversal can be reused while reading the content files.
 */
function indexImageFields(schema, prefix, index, into) {
  if (!schema || schema.type !== 'object') return;
  for (const [key, child] of Object.entries(schema.children)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (child.type === 'image') {
      index.set(child, { fieldPath, directory: toPosix(child.directory ?? '') });
      into.push(index.get(child));
      continue;
    }
    if (child.type === 'object') {
      indexImageFields(child, fieldPath, index, into);
      continue;
    }
    if (child.type === 'array') {
      indexImageFields(child.element, `${fieldPath}[]`, index, into);
    }
  }
}

function collectImageValues(fieldIndex, shape, data, file, trail, into) {
  if (!shape) return;
  if (shape.type === 'object') {
    const record = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    for (const [key, child] of Object.entries(shape.children)) {
      collectImageValues(fieldIndex, child, record[key], file, [...trail, key], into);
    }
    return;
  }
  if (shape.type === 'array') {
    if (!Array.isArray(data)) return;
    data.forEach((item, itemIndex) => {
      collectImageValues(fieldIndex, shape.element, item, file, [...trail, String(itemIndex)], into);
    });
    return;
  }
  if (shape.type !== 'image') return;

  const value = typeof data === 'string' ? data.trim() : '';
  if (!value || isRemote(value)) return;
  const field = fieldIndex.get(shape) ?? {};
  imageValueCount += 1;
  into.push({
    file: toPosix(path.relative(repoRoot, file)),
    path: trail.join('.'),
    fieldPath: field.fieldPath,
    value,
    directory: field.directory,
  });
}

async function main() {
  const config = await loadKeystaticConfig(repoRoot);
  const entries = listEntries(config);

  for (const entry of entries) {
    const index = new Map();
    const imageFields = [];
    indexImageFields(entry.schema, '', index, imageFields);
    imageFieldCount += imageFields.length;
    if (imageFields.length === 0) continue;

    const files = await contentFilesForEntry(repoRoot, entry.path);
    for (const file of files) {
      const found = [];
      collectImageValues(index, entry.schema, await readYamlFile(file), file, [], found);
      for (const item of found) {
        if (!occurrences.has(item.value)) occurrences.set(item.value, []);
        occurrences.get(item.value).push(item);

        const stored = toPosix(path.posix.normalize(item.value.replace(/^\/+/, '')));
        const publicFile = `public/${stored}`;
        const directory = item.directory ?? '';
        if (directory && !publicFile.startsWith(`${directory}/`)) {
          issues.push({
            level: 'error',
            where: `${item.file} :: ${item.path}`,
            message:
              `value "${item.value}" lives outside the field's directory "${directory}": ` +
              'the next save rewrites the path and deletes the file it points at',
          });
        }
        if (!existsSync(path.join(publicRoot, stored))) {
          issues.push({
            level: 'error',
            where: `${item.file} :: ${item.path}`,
            message: `referenced file is missing: ${publicFile}`,
          });
        }
      }
    }
  }

  for (const [value, list] of occurrences) {
    if (list.length < 2) continue;
    issues.push({
      level: 'error',
      where: list.map((item) => `${item.file} :: ${item.path}`).join(' | '),
      message:
        `"${value}" is referenced by ${list.length} image fields: saving one of them moves the file ` +
        'and breaks the other references (give each field its own copy)',
    });
  }

  console.log(`image fields: ${imageFieldCount}`);
  console.log(`image values checked: ${imageValueCount}`);
  if (issues.length === 0) {
    console.log('\nOK: every image value matches its field and no file is shared between fields.');
    return;
  }
  console.log('');
  for (const issue of issues) {
    console.log(`ERROR ${issue.where}`);
    console.log(`      ${issue.message}`);
  }
  console.log(`\ntotal: ${issues.length} error(s)`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
