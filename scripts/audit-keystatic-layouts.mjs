#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = await readFile(path.join(process.cwd(), 'keystatic.config.ts'), 'utf8');

function findMatching(text, start, opening, closing) {
  let depth = 0;
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (char === '\\') { index += 1; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (['"', "'", '`'].includes(char)) { quote = char; continue; }
    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelProperties(objectBody) {
  const segments = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let curly = 0;
  let quote = '';
  for (let index = 0; index < objectBody.length; index += 1) {
    const char = objectBody[index];
    if (quote) {
      if (char === '\\') { index += 1; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (['"', "'", '`'].includes(char)) { quote = char; continue; }
    if (char === '(') round += 1;
    else if (char === ')') round -= 1;
    else if (char === '[') square += 1;
    else if (char === ']') square -= 1;
    else if (char === '{') curly += 1;
    else if (char === '}') curly -= 1;
    else if (char === ',' && round === 0 && square === 0 && curly === 0) {
      segments.push(objectBody.slice(start, index));
      start = index + 1;
    }
  }
  segments.push(objectBody.slice(start));
  return segments.filter((segment) => /^\s*(?:[A-Za-z_$][\w$]*|['"][^'"]+['"])\s*:/.test(segment));
}

const failures = [];
let objectCount = 0;
let layoutCount = 0;
let cursor = 0;

while ((cursor = source.indexOf('fields.object', cursor)) !== -1) {
  objectCount += 1;
  const callStart = source.indexOf('(', cursor);
  const callEnd = findMatching(source, callStart, '(', ')');
  const objectStart = source.indexOf('{', callStart);
  if (callStart === -1 || callEnd === -1 || objectStart === -1 || objectStart > callEnd) {
    failures.push(`Line ${source.slice(0, cursor).split(/\r?\n/).length}: could not parse fields.object call.`);
    cursor += 'fields.object'.length;
    continue;
  }
  const objectEnd = findMatching(source, objectStart, '{', '}');
  const options = source.slice(objectEnd + 1, callEnd);
  const layoutMatch = options.match(/layout\s*:\s*\[([^\]]*)\]/);
  if (!layoutMatch) { cursor = callEnd + 1; continue; }

  layoutCount += 1;
  const line = source.slice(0, cursor).split(/\r?\n/).length;
  const fieldCount = splitTopLevelProperties(source.slice(objectStart + 1, objectEnd)).length;
  const values = layoutMatch[1].split(',').map((value) => value.trim()).filter(Boolean);
  const numbers = values.map(Number);

  if (values.length !== fieldCount) {
    failures.push(`Line ${line}: layout has ${values.length} widths for ${fieldCount} object fields.`);
  }
  if (numbers.some((number) => !Number.isInteger(number) || number < 1 || number > 12)) {
    failures.push(`Line ${line}: layout entries must be integers from 1 to 12.`);
    cursor = callEnd + 1;
    continue;
  }
  let rowTotal = 0;
  for (const number of numbers) {
    rowTotal += number;
    if (rowTotal === 12) rowTotal = 0;
    else if (rowTotal > 12) {
      failures.push(`Line ${line}: layout row exceeds 12 columns.`);
      rowTotal = 0;
      break;
    }
  }
  if (rowTotal !== 0) failures.push(`Line ${line}: final layout row totals ${rowTotal}, expected 12.`);
  cursor = callEnd + 1;
}

if (failures.length) {
  console.error(`Keystatic layout audit failed (${failures.length} issues):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Keystatic layout audit passed (${layoutCount} layouts across ${objectCount} object fields checked).`);
