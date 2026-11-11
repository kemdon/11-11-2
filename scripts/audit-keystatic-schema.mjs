#!/usr/bin/env node
/**
 * Audit the Keystatic content model against the Astro content schema and the
 * content files themselves.
 *
 * Failure modes covered:
 *   1. a key stored in a content file that the Keystatic schema does not define
 *      -> the admin refuses to open that entry ("Key ... is not allowed") and
 *         saving it drops the key
 *   2. a Keystatic field the Astro (zod) schema does not define
 *      -> editable in the admin, silently stripped when the site is built
 *   3. a field the front site reads but the Keystatic schema does not define
 *      -> impossible to maintain from the admin
 *   4. an Astro collection with no Keystatic counterpart
 *      -> the content exists but cannot be edited from the admin
 *
 * Every entry is also read through Keystatic's own reader, which is the same
 * validation the admin runs, so a broken admin entry fails this audit.
 *
 * Usage: node ./scripts/audit-keystatic-schema.mjs [projectRoot] [--verbose]
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  contentFilesForEntry,
  listEntries,
  loadKeystaticConfig,
  readEntriesWithKeystatic,
  readYamlFile,
  toPosix,
} from './lib/keystatic-config.mjs';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const rootArgument = args.find((argument) => !argument.startsWith('--'));
const repoRoot = rootArgument
  ? path.resolve(rootArgument)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const issues = [];
let frontendSource = '';
let contentGetters = new Map();

function addIssue(level, file, field, message) {
  issues.push({ level, file: toPosix(file), field, message });
}

/* ------------------------------------------------------------------ *
 * Astro content schema (zod) shape
 * ------------------------------------------------------------------ */
function propertyName(name, sourceFile) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return name.getText(sourceFile);
}

function calleeName(expression, sourceFile) {
  if (ts.isPropertyAccessExpression(expression)) {
    return `${expression.expression.getText(sourceFile)}.${expression.name.getText(sourceFile)}`;
  }
  return expression.getText(sourceFile);
}

function zodShape(expression, sourceFile) {
  if (!ts.isCallExpression(expression)) return { type: 'scalar' };
  const callee = calleeName(expression.expression, sourceFile);
  if (callee === 'z.object') {
    const argument = expression.arguments[0];
    const children = {};
    if (argument && ts.isObjectLiteralExpression(argument)) {
      for (const property of argument.properties) {
        if (ts.isPropertyAssignment(property)) {
          children[propertyName(property.name, sourceFile)] = zodShape(
            property.initializer,
            sourceFile,
          );
        }
      }
    }
    return { type: 'object', children };
  }
  if (callee === 'z.array') {
    const argument = expression.arguments[0];
    return {
      type: 'array',
      element: argument ? zodShape(argument, sourceFile) : { type: 'scalar' },
    };
  }
  // textSafe(z.object({...})) only normalises empty CMS values before parsing;
  // the structure still comes from the wrapped z.object, so unwrap it here or
  // the whole collection would be treated as a scalar and skipped.
  if (callee === 'textSafe') {
    const argument = expression.arguments[0];
    return argument ? zodShape(argument, sourceFile) : { type: 'scalar' };
  }
  // Unwrap .optional() / .default() / .nullable() / ...
  if (
    ts.isPropertyAccessExpression(expression.expression) &&
    ['optional', 'default', 'nullable', 'catch', 'transform'].includes(
      expression.expression.name.getText(sourceFile),
    )
  ) {
    return zodShape(expression.expression.expression, sourceFile);
  }
  return { type: 'scalar' };
}

function loadAstroSchemas(sourceText) {
  const sourceFile = ts.createSourceFile(
    'content.config.ts',
    sourceText,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const schemas = new Map();
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (!initializer || !ts.isCallExpression(initializer)) continue;
      if (!initializer.expression.getText(sourceFile).endsWith('defineCollection')) continue;
      const argument = initializer.arguments[0];
      if (!argument || !ts.isObjectLiteralExpression(argument)) continue;
      const schemaProperty = argument.properties.find(
        (property) =>
          ts.isPropertyAssignment(property) &&
          propertyName(property.name, sourceFile) === 'schema',
      );
      if (!schemaProperty) continue;
      schemas.set(
        declaration.name.getText(sourceFile),
        zodShape(schemaProperty.initializer, sourceFile),
      );
    }
  });
  return schemas;
}

/* ------------------------------------------------------------------ *
 * Which content entries does the front site actually read?
 * ------------------------------------------------------------------ */
async function loadFrontendSource() {
  const sourceRoot = path.join(repoRoot, 'src');
  const chunks = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'content') continue;
        await walk(full);
        continue;
      }
      if (!/\.(astro|ts|tsx|js|jsx|mjs)$/.test(entry.name)) continue;
      const relative = toPosix(path.relative(repoRoot, full));
      if (relative === 'src/content.config.ts' || relative === 'src/lib/site-content.ts') continue;
      chunks.push(await readFile(full, 'utf8'));
    }
  };
  await walk(sourceRoot);
  return chunks.join('\n');
}

/**
 * Map each content entry to the exported reader functions that load it, by
 * looking at which `getEntry('name')` / `getCollection('name')` call each
 * exported function in src/lib/site-content.ts makes. Names are derived instead
 * of hardcoded so the audit keeps working when a project adds an entry.
 */
function deriveContentGetters(sourceText) {
  const getters = new Map();
  const callPattern = /(?:getEntry|getCollection)\s*\(\s*['"]([\w-]+)['"]/g;
  const functionPattern =
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{]*\{/g;
  for (const match of sourceText.matchAll(callPattern)) {
    const entryName = match[1];
    const before = sourceText.slice(0, match.index);
    const functions = [...before.matchAll(functionPattern)];
    if (functions.length === 0) continue;
    const name = functions[functions.length - 1][1];
    if (!getters.has(entryName)) getters.set(entryName, new Set());
    getters.get(entryName).add(name);
  }
  return getters;
}

function collectUsedFields(entryName) {
  const used = new Set();
  const getters = contentGetters.get(entryName);
  if (!getters || !frontendSource) return used;

  const alternation = [...getters].join('|');
  const variables = new Set();
  const assignPattern = new RegExp(
    `const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*await\\s+(?:${alternation})\\s*\\(`,
    'g',
  );
  const destructurePattern = new RegExp(
    `const\\s*\\{([^}]*)\\}\\s*=\\s*await\\s+(?:${alternation})\\s*\\(`,
    'g',
  );
  for (const match of frontendSource.matchAll(assignPattern)) variables.add(match[1]);
  for (const match of frontendSource.matchAll(destructurePattern)) {
    for (const part of match[1].split(',')) {
      const name = part.split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) used.add(name);
    }
  }
  if (variables.size === 0) return used;

  const accessPattern = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;
  for (const match of frontendSource.matchAll(accessPattern)) {
    if (variables.has(match[1])) used.add(match[2]);
  }
  return used;
}

/* ------------------------------------------------------------------ *
 * Comparisons
 * ------------------------------------------------------------------ */
const CONTENT_FILE_HINT = 'content file holds this key but the Keystatic schema does not define it';

function compareYamlAgainstSchema(shape, data, file, prefix) {
  if (!shape || shape.type !== 'object') return;
  const record = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  for (const [key, value] of Object.entries(record)) {
    const child = shape.children[key];
    if (!child) {
      addIssue(
        'error',
        file,
        `${prefix}${key}`,
        `${CONTENT_FILE_HINT}: the admin reports "Key ... is not allowed" and drops the key when saved`,
      );
      continue;
    }
    compareValue(child, value, file, `${prefix}${key}`);
  }
}

function compareValue(shape, value, file, fieldPath) {
  if (shape.type === 'object') {
    compareYamlAgainstSchema(shape, value, file, `${fieldPath}.`);
    return;
  }
  if (shape.type === 'array' && Array.isArray(value)) {
    value.forEach((item, index) => {
      compareValue(shape.element, item, file, `${fieldPath}[${index}]`);
    });
  }
}

function compareSchemaAgainstYaml(shape, data, file, prefix) {
  if (!shape || shape.type !== 'object') return;
  const record = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  for (const key of Object.keys(shape.children)) {
    if (key in record) continue;
    addIssue(
      'info',
      file,
      `${prefix}${key}`,
      'Keystatic defines this field but the content file has no value yet',
    );
  }
}

function compareKeystaticAgainstZod(keystatic, zod, file, prefix) {
  if (keystatic.type === 'object') {
    const zodChildren = zod && zod.type === 'object' ? zod.children : {};
    for (const [key, child] of Object.entries(keystatic.children)) {
      const zodChild = zodChildren[key];
      if (!zodChild) {
        addIssue(
          'warning',
          file,
          `${prefix}${key}`,
          'editable in Keystatic but missing from the Astro content schema: zod strips it at build time',
        );
        continue;
      }
      compareKeystaticAgainstZod(child, zodChild, file, `${prefix}${key}.`);
    }
    return;
  }
  if (keystatic.type === 'array' && zod && zod.type === 'array') {
    compareKeystaticAgainstZod(keystatic.element, zod.element, file, `${prefix}[]`);
  }
}

function compareZodAgainstKeystatic(zod, keystatic, file, prefix, usedFields) {
  if (!zod || zod.type !== 'object') return;
  const keystaticChildren = keystatic && keystatic.type === 'object' ? keystatic.children : {};
  for (const [key, child] of Object.entries(zod.children)) {
    const keystaticChild = keystaticChildren[key];
    if (!keystaticChild) {
      const used = usedFields?.has(key) ?? false;
      addIssue(
        used ? 'warning' : 'info',
        file,
        `${prefix}${key}`,
        used
          ? 'the front site reads this field but the Keystatic schema does not define it: it cannot be maintained from the admin'
          : 'the Astro content schema keeps this field but no front-end code reads it and Keystatic does not define it (legacy)',
      );
      continue;
    }
    if (child.type === 'object') {
      compareZodAgainstKeystatic(child, keystaticChild, file, `${prefix}${key}.`, usedFields);
    } else if (child.type === 'array' && keystaticChild.type === 'array') {
      compareZodAgainstKeystatic(
        child.element,
        keystaticChild.element,
        file,
        `${prefix}${key}[]`,
        usedFields,
      );
    }
  }
}

function compareYamlAgainstZod(shape, data, file, prefix) {
  if (!shape || shape.type !== 'object') return;
  const record = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  for (const [key, value] of Object.entries(record)) {
    const child = shape.children[key];
    if (!child) {
      addIssue(
        'warning',
        file,
        `${prefix}${key}`,
        'stored in the content file but missing from the Astro content schema: zod strips it at build time',
      );
      continue;
    }
    if (child.type === 'object' || child.type === 'array') {
      compareYamlAgainstZod(child, value, file, `${prefix}${key}.`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
async function main() {
  const config = await loadKeystaticConfig(repoRoot);
  const entries = listEntries(config);
  const astroSchemas = loadAstroSchemas(
    await readFile(path.join(repoRoot, 'src', 'content.config.ts'), 'utf8'),
  );
  frontendSource = await loadFrontendSource();
  contentGetters = deriveContentGetters(
    await readFile(path.join(repoRoot, 'src', 'lib', 'site-content.ts'), 'utf8').catch(() => ''),
  );

  const auditedFiles = [];
  for (const entry of entries) {
    const zod = astroSchemas.get(entry.name);
    const files = await contentFilesForEntry(repoRoot, entry.path);
    if (files.length === 0) {
      addIssue('info', entry.path, '(files)', 'no content file found for this entry');
    }
    for (const file of files) {
      const relative = toPosix(path.relative(repoRoot, file));
      const data = await readYamlFile(file);
      auditedFiles.push(relative);
      compareYamlAgainstSchema(entry.schema, data, relative, '');
      compareSchemaAgainstYaml(entry.schema, data, relative, '');
      compareYamlAgainstZod(zod, data, relative, '');
    }

    const schemaFile = `keystatic.config.ts -> ${entry.name}`;
    if (!zod) {
      addIssue(
        'warning',
        schemaFile,
        '(schema)',
        'no matching collection in src/content.config.ts: the Astro site cannot read this content',
      );
      continue;
    }
    compareKeystaticAgainstZod(entry.schema, zod, schemaFile, '');
    compareZodAgainstKeystatic(zod, entry.schema, schemaFile, '', collectUsedFields(entry.name));
  }

  for (const name of astroSchemas.keys()) {
    if (entries.some((entry) => entry.name === name)) continue;
    addIssue(
      'warning',
      'keystatic.config.ts',
      name,
      'src/content.config.ts declares this collection but Keystatic does not: the content cannot be edited from the admin',
    );
  }

  const readerResults = await readEntriesWithKeystatic(repoRoot, config, entries);
  for (const result of readerResults) {
    if (result.ok) continue;
    addIssue(
      'error',
      'keystatic.config.ts',
      result.name,
      `Keystatic reader rejected this entry (the admin shows the same error): ${result.message}`,
    );
  }

  const order = { error: 0, warning: 1, info: 2 };
  issues.sort(
    (a, b) =>
      order[a.level] - order[b.level] ||
      a.file.localeCompare(b.file) ||
      a.field.localeCompare(b.field),
  );

  console.log(`content files audited: ${auditedFiles.length}`);
  console.log('Keystatic reader:');
  for (const result of readerResults) {
    console.log(`  ${result.ok ? 'ok  ' : 'FAIL'} ${result.name}${result.ok ? '' : `: ${result.message}`}`);
  }

  if (issues.length === 0) {
    console.log('\nOK: Keystatic schema, content files and the Astro schema agree.');
    return;
  }

  const titles = { error: 'ERROR', warning: 'WARNING', info: 'NOTE' };
  console.log('');
  for (const level of ['error', 'warning', 'info']) {
    const group = issues.filter((issue) => issue.level === level);
    if (group.length === 0) continue;
    // Notes are mostly "the CMS has this field but the template content is
    // still empty"; they matter while editing, not on every audit run.
    if (level === 'info' && !verbose) {
      console.log(`NOTE (${group.length}): empty or unused fields, hidden by default (--verbose lists them)`);
      console.log('');
      continue;
    }
    console.log(`${titles[level]} (${group.length})`);
    for (const issue of group) {
      console.log(`  ${issue.file} :: ${issue.field || '(root)'}`);
      console.log(`      ${issue.message}`);
    }
    console.log('');
  }

  const errors = issues.filter((issue) => issue.level === 'error').length;
  const warnings = issues.filter((issue) => issue.level === 'warning').length;
  console.log(
    `total: ${errors} error(s), ${warnings} warning(s), ${issues.length - errors - warnings} note(s)`,
  );
  if (errors > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
