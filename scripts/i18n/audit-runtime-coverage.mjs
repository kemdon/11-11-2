import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const settingsPath = path.join(repoRoot, 'src', 'content', 'siteSettings', 'settings.yaml');
const navbarPath = path.join(repoRoot, 'src', 'components', 'Navbar.astro');
const siteContentPath = path.join(repoRoot, 'src', 'lib', 'site-content.ts');

const dictionaryTargets = [
  { file: path.join(repoRoot, 'src', 'lib', 'i18n.ts'), mapName: 'chromeCopy' },
  { file: path.join(repoRoot, 'src', 'lib', 'frontsite.ts'), mapName: 'uiCopy' },
  { file: path.join(repoRoot, 'src', 'lib', 'frontsite.ts'), mapName: 'categoryGuides' },
];

function normalizeLocale(locale) {
  return String(locale || '').toLowerCase();
}

async function readSupportedLocales() {
  const raw = await fs.readFile(settingsPath, 'utf8');
  const found = [...raw.matchAll(/^\s*-\s*code:\s*(.+)$/gm)].map((match) => normalizeLocale(match[1].trim()));
  if (!found.length) {
    const defaultLocale = raw.match(/^defaultLocale:\s*(.+)$/m)?.[1]?.trim();
    if (defaultLocale) return [normalizeLocale(defaultLocale)];
    throw new Error('No defaultLocale or supportedLocales found in src/content/siteSettings/settings.yaml');
  }
  return [...new Set(found)];
}

async function auditSharedShellFields() {
  const raw = await fs.readFile(settingsPath, 'utf8');
  const parsed = parseYaml(raw) ?? {};

  if (!String(parsed.localeSwitcherLabel || '').trim()) {
    problems.push({
      file: path.relative(repoRoot, settingsPath).replaceAll('\\', '/'),
      mapName: 'siteSettings',
      missingLocales: ['localeSwitcherLabel'],
    });
  }

  const navbarExists = await fs.stat(navbarPath).then(() => true).catch(() => false);
  if (!navbarExists) {
    return;
  }

  const navbarSource = await fs.readFile(navbarPath, 'utf8');
  if (navbarSource.includes('aria-label="Language switcher"')) {
    problems.push({
      file: path.relative(repoRoot, navbarPath).replaceAll('\\', '/'),
      mapName: 'shared-shell',
      missingLocales: ['localeSwitcherLabel binding'],
    });
  }
}

async function auditLocalizedMergePriority() {
  const exists = await fs.stat(siteContentPath).then(() => true).catch(() => false);
  if (!exists) {
    return;
  }

  const source = await fs.readFile(siteContentPath, 'utf8');
  if (!source.includes('i18n-output')) {
    return;
  }

  if (/import\.meta\.env\.DEV[\s\S]{0,500}deepMerge\(\s*translation\s*,\s*source\s*\)/.test(source)) {
    problems.push({
      file: path.relative(repoRoot, siteContentPath).replaceAll('\\', '/'),
      mapName: 'localized-content',
      missingLocales: ['dev-mode merge lets source content override localized output'],
    });
  }
}

async function auditLanguageSwitcherStatePriority() {
  const navbarExists = await fs.stat(navbarPath).then(() => true).catch(() => false);
  if (!navbarExists) {
    return;
  }

  const source = await fs.readFile(navbarPath, 'utf8');
  if (!source.includes('data-language-select')) {
    return;
  }

  const usesStoredState = source.includes('localStorage') || source.includes('getCookie(');
  if (!usesStoredState) {
    return;
  }

  const hasRouteLocale = source.includes('window.location.pathname') && /\brouteLocale\b/.test(source);
  if (!hasRouteLocale) {
    problems.push({
      file: path.relative(repoRoot, navbarPath).replaceAll('\\', '/'),
      mapName: 'language-switcher',
      missingLocales: ['stored locale state is used without explicit route-locale priority'],
    });
    return;
  }

  const storedBranch = source.indexOf('if (storedLocale');
  const routeBranch = source.indexOf('if (routeLocale');
  if (storedBranch !== -1 && routeBranch !== -1 && storedBranch < routeBranch) {
    problems.push({
      file: path.relative(repoRoot, navbarPath).replaceAll('\\', '/'),
      mapName: 'language-switcher',
      missingLocales: ['stored locale branch runs before explicit route-locale branch'],
    });
  }
}

function extractObjectBody(raw, mapName) {
  const marker = `const ${mapName} = {`;
  const start = raw.indexOf(marker);
  if (start < 0) return null;

  const braceStart = raw.indexOf('{', start);
  if (braceStart < 0) return null;

  let depth = 0;
  for (let index = braceStart; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(braceStart + 1, index);
      }
    }
  }

  return null;
}

function extractLocaleKeys(objectBody) {
  const keys = [...objectBody.matchAll(/^\s*['"]?([a-zA-Z0-9-]+)['"]?\s*:/gm)]
    .map((match) => normalizeLocale(match[1]))
    .filter(Boolean);
  return [...new Set(keys)];
}

const supportedLocales = await readSupportedLocales();
const problems = [];
let checkedCount = 0;

if (supportedLocales.length === 1) {
  console.log(`Runtime i18n coverage audit passed: single locale (${supportedLocales[0]}) has no locale switcher requirement.`);
  process.exit(0);
}

for (const target of dictionaryTargets) {
  const exists = await fs.stat(target.file).then(() => true).catch(() => false);
  if (!exists) {
    continue;
  }

  const raw = await fs.readFile(target.file, 'utf8');
  const objectBody = extractObjectBody(raw, target.mapName);
  if (!objectBody) {
    continue;
  }

  checkedCount += 1;
  const keys = extractLocaleKeys(objectBody);
  const missing = supportedLocales.filter((locale) => !keys.includes(locale));
  if (missing.length) {
    problems.push({
      file: path.relative(repoRoot, target.file).replaceAll('\\', '/'),
      mapName: target.mapName,
      missingLocales: missing,
    });
  }
}

await auditSharedShellFields();
await auditLocalizedMergePriority();
await auditLanguageSwitcherStatePriority();

if (!checkedCount) {
  if (!problems.length) {
    console.log('Runtime i18n coverage audit skipped: no known runtime locale dictionaries found.');
    process.exit(0);
  }
}

if (problems.length) {
  console.error(JSON.stringify(problems, null, 2));
  process.exit(1);
}

console.log('Runtime i18n coverage audit passed.');
