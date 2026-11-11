import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(repoRoot, 'keystatic.config.ts');
const scanDirs = ['src', 'i18n-output'];
const textFieldPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:fields\.text|text)\s*\(/g;
const yamlScalarPattern = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^#\n]+?)\s*(?:#.*)?$/;
const coercedScalarPattern = /^(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|true|false|null|Null|NULL|~|\d{4}-\d{2}-\d{2})$/;
const needsQuotePattern = /:\s+\S/;

function toPosix(filePath) {
  return filePath.replace(/\\/g, '/');
}

function isQuoted(value) {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed[0] === trimmed.at(-1) && ['"', "'"].includes(trimmed[0]);
}

async function pathExists(filePath) {
  return Boolean(await fs.stat(filePath).catch(() => null));
}

async function walkYamlFiles(dir) {
  const results = [];
  if (!(await pathExists(dir))) return results;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkYamlFiles(fullPath));
      continue;
    }

    if (/\.(ya?ml)$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

async function extractTextFields() {
  const config = await fs.readFile(configPath, 'utf8');
  return new Set([...config.matchAll(textFieldPattern)].map((match) => match[1]));
}

async function auditYamlFile(filePath, textFields, fix = false) {
  const findings = [];
  const lines = (await fs.readFile(filePath, 'utf8')).split(/\r?\n/);
  let changed = false;

  lines.forEach((line, index) => {
    const match = line.match(yamlScalarPattern);
    if (!match) return;

    const [, indent, key, rawValue] = match;
    const value = rawValue.trim();
    if (!textFields.has(key) || isQuoted(value) || (!coercedScalarPattern.test(value) && !needsQuotePattern.test(value))) return;

    findings.push({
      file: toPosix(filePath),
      line: index + 1,
      key,
      value,
      message: `\`${key}: ${value}\` should be quoted for Keystatic text field`,
    });

    if (fix) {
      lines[index] = `${indent}${key}: ${JSON.stringify(value)}`;
      changed = true;
    }
  });

  if (fix && changed) {
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');
  }

  return findings;
}

const fix = process.argv.includes('--fix');

const textFields = await extractTextFields();
const yamlFiles = [];
for (const dirname of scanDirs) {
  yamlFiles.push(...await walkYamlFiles(path.join(repoRoot, dirname)));
}

const findings = [];
for (const filePath of yamlFiles) {
  findings.push(...await auditYamlFile(filePath, textFields, fix));
}

if (findings.length > 0) {
  console.error(`Keystatic text scalar audit failed (${findings.length} issue${findings.length === 1 ? '' : 's'}):`);
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line}: ${finding.message}`);
  }
  process.exit(1);
}

console.log(`Keystatic text scalar audit passed (${textFields.size} text keys checked across ${yamlFiles.length} YAML files).`);
