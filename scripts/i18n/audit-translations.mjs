import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { parse as parseYaml } from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceRoot = path.join(repoRoot, 'src', 'content');
const outputRoot = path.join(repoRoot, 'i18n-output');
const siteSettingsPath = path.join(sourceRoot, 'siteSettings', 'settings.yaml');
const contentExtensions = new Set(['.yaml', '.yml', '.md', '.mdoc']);
const report = [];
const preservedFieldNames = new Set([
  'anchor',
  'brand',
  'brandId',
  'category',
  'categorySlug',
  'code',
  'collection',
  'coverImage',
  'date',
  'defaultOgImage',
  'defaultLocale',
  'file',
  'fromEmail',
  'heroBackgroundImage',
  'heroImage',
  'href',
  'id',
  'image',
  'isFeatured',
  'localeCookieName',
  'logo',
  'mainImage',
  'ogImage',
  'platform',
  'slug',
  'status',
  'thumbnail',
  'type',
  'url',
]);

const preservedArrayFieldNames = new Set([
  'categoryOrder',
  'featuredProducts',
  'heroBgImages',
  'homepageCategoryOrder',
  'images',
]);

function toPosix(filePath) {
  return filePath.replace(/\\/g, '/');
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function walkFiles(dir) {
  const results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkFiles(fullPath));
      continue;
    }
    if (contentExtensions.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function addProblem(kind, file, message) {
  report.push({ kind, file: toPosix(file), message });
}

function shouldPreserveField(key, keyPath = []) {
  if (!key) return false;
  const pathText = keyPath.join('.');
  if (key === 'label' && keyPath.includes('supportedLocales')) return true;
  if (key === 'key' && pathText.includes('.navigation.')) return true;
  if (preservedArrayFieldNames.has(keyPath.at(-2) ?? '')) return true;
  return preservedFieldNames.has(key) || /(?:^|_)(?:id|slug|href|url)$/i.test(key) || /(?:Id|Slug|Href|Url)$/.test(key);
}

function compareShape(sourceValue, translatedValue, filePath, keyPath = 'root') {
  if (Array.isArray(sourceValue)) {
    if (!Array.isArray(translatedValue)) {
      addProblem('shape', filePath, `${keyPath} should remain an array.`);
      return;
    }

    if (sourceValue.length !== translatedValue.length) {
      addProblem('shape', filePath, `${keyPath} array length changed from ${sourceValue.length} to ${translatedValue.length}.`);
    }

    sourceValue.forEach((item, index) => {
      compareShape(item, translatedValue[index], filePath, `${keyPath}[${index}]`);
    });
    return;
  }

  if (sourceValue && typeof sourceValue === 'object') {
    if (!translatedValue || typeof translatedValue !== 'object' || Array.isArray(translatedValue)) {
      addProblem('shape', filePath, `${keyPath} should remain an object.`);
      return;
    }

    const sourceKeys = Object.keys(sourceValue).sort();
    const translatedKeys = Object.keys(translatedValue).sort();

    for (const key of sourceKeys) {
      if (!(key in translatedValue)) {
        addProblem('shape', filePath, `${keyPath}.${key} is missing in translated output.`);
      }
    }

    for (const key of translatedKeys) {
      if (!(key in sourceValue)) {
        addProblem('shape', filePath, `${keyPath}.${key} is unexpected in translated output.`);
      }
    }

    for (const key of sourceKeys) {
      compareShape(sourceValue[key], translatedValue[key], filePath, `${keyPath}.${key}`);
    }
  }
}

function comparePreservedFields(sourceValue, translatedValue, filePath, keyPath = ['root']) {
  const key = keyPath.at(-1) ?? '';
  if (shouldPreserveField(key, keyPath) && JSON.stringify(sourceValue) !== JSON.stringify(translatedValue)) {
    addProblem('preserved-field', filePath, `${keyPath.join('.')} must remain unchanged.`);
    return;
  }

  if (Array.isArray(sourceValue) && Array.isArray(translatedValue)) {
    sourceValue.forEach((item, index) => {
      comparePreservedFields(item, translatedValue[index], filePath, [...keyPath, String(index)]);
    });
    return;
  }

  if (
    sourceValue
    && translatedValue
    && typeof sourceValue === 'object'
    && typeof translatedValue === 'object'
    && !Array.isArray(sourceValue)
    && !Array.isArray(translatedValue)
  ) {
    for (const nestedKey of Object.keys(sourceValue)) {
      comparePreservedFields(sourceValue[nestedKey], translatedValue[nestedKey], filePath, [...keyPath, nestedKey]);
    }
  }
}

function isJsonFenceBody(value) {
  return /^```json\s*[\s\S]*?```\s*$/i.test(String(value ?? '').trim());
}

async function auditMarkdownFile(filePath, sourceFilePath, isNewsFile) {
  const raw = await readText(filePath);
  const sourceRaw = await readText(sourceFilePath);
  let parsed;
  let sourceParsed;
  try {
    parsed = matter(raw);
    sourceParsed = matter(sourceRaw);
  } catch (error) {
    addProblem('frontmatter', filePath, error.message);
    return;
  }

  compareShape(sourceParsed.data, parsed.data, filePath);
  comparePreservedFields(sourceParsed.data, parsed.data, filePath);

  if (!isJsonFenceBody(sourceParsed.content) && isJsonFenceBody(parsed.content)) {
    addProblem('markdown-body', filePath, 'Markdown body was converted into a JSON code fence.');
  }

  if (isNewsFile) {
    const dateValue = parsed.data?.date;
    const date = dateValue instanceof Date ? dateValue : new Date(String(dateValue ?? ''));
    if (Number.isNaN(date.getTime())) {
      addProblem('date', filePath, `Invalid news date: ${String(dateValue)}`);
    }
  }
}

async function auditYamlFile(filePath, sourceFilePath) {
  const raw = await readText(filePath);
  const sourceRaw = await readText(sourceFilePath);
  try {
    const sourceParsed = parseYaml(sourceRaw);
    const parsed = parseYaml(raw);
    compareShape(sourceParsed, parsed, filePath);
    comparePreservedFields(sourceParsed, parsed, filePath);
  } catch (error) {
    addProblem('yaml', filePath, error.message);
  }
}

async function getLocales() {
  const raw = await readText(siteSettingsPath);
  const locales = [...raw.matchAll(/^\s*-\s*code:\s*(.+)$/gm)].map((match) => match[1].trim());
  const defaultLocale = raw.match(/^defaultLocale:\s*(.+)$/m)?.[1]?.trim()?.toLowerCase() ?? 'en';
  return locales.filter((locale) => locale.toLowerCase() !== defaultLocale);
}

async function auditContentValidity() {
  if (!(await fs.stat(outputRoot).catch(() => null))) {
    addProblem('filesystem', outputRoot, 'i18n-output directory is missing.');
    return;
  }

  const files = await walkFiles(outputRoot);
  for (const filePath of files) {
    const normalized = toPosix(filePath);
    const localeRelativePath = normalized.replace(/^.*?\/i18n-output\/[^/]+\//, '');
    const sourceFilePath = path.join(repoRoot, localeRelativePath);
    const isNewsFile = normalized.includes('/src/content/news/');

    if (filePath.endsWith('.md') || filePath.endsWith('.mdoc')) {
      await auditMarkdownFile(filePath, sourceFilePath, isNewsFile);
    } else {
      await auditYamlFile(filePath, sourceFilePath);
    }
  }
}

async function auditCompleteness() {
  const locales = await getLocales();
  const sourceFiles = await walkFiles(sourceRoot);
  const sourceRelativePaths = sourceFiles.map((filePath) => toPosix(path.relative(repoRoot, filePath)));

  for (const locale of locales) {
    for (const relativePath of sourceRelativePaths) {
      const translatedPath = path.join(outputRoot, locale, relativePath);
      try {
        await fs.access(translatedPath);
      } catch {
        addProblem('missing', translatedPath, `Missing localized file for locale "${locale}"`);
      }
    }
  }
}

const configuredLocales = await getLocales();
if (configuredLocales.length === 0) {
  console.log('Translation output audit skipped: the project has one configured locale and no translated locale routes.');
  process.exit(0);
}

await auditContentValidity();
await auditCompleteness();

if (report.length > 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log('Translation audit passed.');
