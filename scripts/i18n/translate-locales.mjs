#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadEnvFile, projectRoot, sleep } from '../lib/cli-helpers.mjs';

function parseArgs(argv) {
  const options = {
    locales: [],
    sourceLocale: '',
    limit: 0,
    throttleLimit: 3,
    maxAttempts: 4,
    retryDelaySeconds: 5,
    minRequestIntervalMs: 0,
    outputRoot: 'i18n-output',
    force: false,
    stale: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--locale':
      case '-l':
        options.locales.push(...String(argv[index + 1] ?? '').split(',').map((item) => item.trim()).filter(Boolean));
        index += 1;
        break;
      case '--source-locale':
        options.sourceLocale = String(argv[index + 1] ?? options.sourceLocale);
        index += 1;
        break;
      case '--model':
        // Legacy compatibility: model is read from DEEPSEEK_MODEL env var
        index += 1;
        break;
      case '--limit':
        options.limit = Number(argv[index + 1] ?? options.limit);
        index += 1;
        break;
      case '--throttle-limit':
        options.throttleLimit = Number(argv[index + 1] ?? options.throttleLimit);
        index += 1;
        break;
      case '--max-attempts':
        options.maxAttempts = Number(argv[index + 1] ?? options.maxAttempts);
        index += 1;
        break;
      case '--retry-delay-seconds':
        options.retryDelaySeconds = Number(argv[index + 1] ?? options.retryDelaySeconds);
        index += 1;
        break;
      case '--min-request-interval-ms':
        options.minRequestIntervalMs = Number(argv[index + 1] ?? options.minRequestIntervalMs);
        index += 1;
        break;
      case '--output-root':
        options.outputRoot = String(argv[index + 1] ?? options.outputRoot);
        index += 1;
        break;
      case '--force':
        options.force = true;
        break;
      case '--stale':
        options.stale = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.throttleLimit) || options.throttleLimit < 1) {
    throw new Error('Throttle limit must be at least 1.');
  }

  if (!Number.isFinite(options.minRequestIntervalMs) || options.minRequestIntervalMs < 0) {
    throw new Error('Minimum request interval must be 0 or greater.');
  }

  return options;
}

async function walkFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkFiles(fullPath));
      continue;
    }
    if (['.yaml', '.yml', '.md', '.mdoc'].includes(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getSupportedLocales(siteSettingsPath, requestedLocales, defaultLocale) {
  const raw = await fs.readFile(siteSettingsPath, 'utf8');
  const foundLocales = [...raw.matchAll(/^\s*-\s*code:\s*(.+)$/gm)].map((match) => match[1].trim());
  if (!foundLocales.length) {
    throw new Error('No supported locales found in src/content/siteSettings/settings.yaml');
  }

  if (requestedLocales.length) {
    const requested = new Set(requestedLocales.map((item) => item.toLowerCase()));
    return foundLocales.filter((locale) => requested.has(locale.toLowerCase()));
  }

  return foundLocales.filter((locale) => locale.toLowerCase() !== defaultLocale.toLowerCase());
}

const languageNames = {
  en: 'English',
  'zh-CN': 'Chinese',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  ru: 'Russian',
  pt: 'Portuguese',
  'pt-BR': 'Portuguese',
  ar: 'Arabic',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay',
  hi: 'Hindi',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
};

async function invokeDeepSeekTranslation({
  apiKey,
  model,
  fromLocale,
  toLocale,
  content,
  maxAttempts,
  retryDelaySeconds,
  systemPrompt,
  userContent,
}) {
  const sourceLang = languageNames[fromLocale] || fromLocale;
  const targetLang = languageNames[toLocale] || toLocale;
  const defaultSystemPrompt = `You are a precise website localization engine. Translate the following content from ${sourceLang} to ${targetLang}. Preserve JSON structure, numeric values, markdown syntax, placeholders, file paths, URLs, emails, phone numbers, and brand/product codes. Translate only the human-readable text values. Return only the translated result with the exact same structure.`;

  const payload = {
    model,
    messages: [
      {
        role: 'system',
        content: systemPrompt ?? defaultSystemPrompt,
      },
      {
        role: 'user',
        content: userContent ?? content,
      },
    ],
    max_tokens: 4096,
    temperature: 0.2,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`DeepSeek API returned ${response.status}: ${body}`);
      }

      const json = await response.json();
      const translated = String(json.choices?.[0]?.message?.content ?? '').trim();
      if (!translated) {
        throw new Error(`DeepSeek response missing translated content: ${JSON.stringify(json)}`);
      }
      return translated;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`DeepSeek request failed for ${toLocale} on attempt ${attempt}/${maxAttempts}. Retrying in ${retryDelaySeconds}s. Error: ${message}`);
      await sleep(retryDelaySeconds * 1000);
    }
  }

  throw new Error(`DeepSeek API request failed for ${toLocale}`);
}

async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  const results = [];
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) {
        return;
      }
      results.push(await worker(item));
    }
  });
  await Promise.all(runners);
  return results;
}

function shouldKeepLiteral(value) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^(\/|\.{1,2}\/)/.test(trimmed)) return true;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) return true;
  if (/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/i.test(trimmed)) return true;
  if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/i.test(trimmed)) return true;
  if (/^[+0-9()\-\s/]+$/.test(trimmed)) return true;
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)+$/i.test(trimmed)) return true;
  if (/\.(png|jpe?g|webp|svg|gif|pdf|mp4)$/i.test(trimmed)) return true;
  return false;
}

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

function shouldPreserveField(key, keyPath = []) {
  if (!key) return false;
  const pathText = keyPath.join('.');
  if (key === 'label' && keyPath.includes('supportedLocales')) return true;
  if (key === 'key' && pathText.includes('.navigation.')) return true;
  if (preservedArrayFieldNames.has(keyPath.at(-2) ?? '')) return true;
  return preservedFieldNames.has(key) || /(?:^|_)(?:id|slug|href|url)$/i.test(key) || /(?:Id|Slug|Href|Url)$/.test(key);
}

function collectTranslatableStrings(value, bucket, keyPath = []) {
  if (typeof value === 'string') {
    if (!shouldPreserveField(keyPath.at(-1) ?? '', keyPath) && !shouldKeepLiteral(value)) {
      bucket.push(value);
    }
    return;
  }

  if (value instanceof Date) {
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectTranslatableStrings(item, bucket, [...keyPath, String(index)]);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      collectTranslatableStrings(nestedValue, bucket, [...keyPath, nestedKey]);
    }
  }
}

function applyTranslations(value, translatedMap, keyPath = []) {
  if (typeof value === 'string') {
    return shouldPreserveField(keyPath.at(-1) ?? '', keyPath) || shouldKeepLiteral(value) ? value : (translatedMap.get(value) ?? value);
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => applyTranslations(item, translatedMap, [...keyPath, String(index)]));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [nestedKey, applyTranslations(nestedValue, translatedMap, [...keyPath, nestedKey])]),
    );
  }

  return value;
}

// ── JSON parsing resilience ──────────────────────────────────────────

function extractJson(raw) {
  let cleaned = raw.trim();
  // Remove markdown code fences
  const fencedMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    cleaned = fencedMatch[1].trim();
  }
  // Strip leading text before first '[' or '{' and trailing text after last ']' or '}'
  const firstBracket = cleaned.search(/[[{]/);
  if (firstBracket > 0) cleaned = cleaned.slice(firstBracket);
  const lastBracket = cleaned.search(/[}\]]\s*$/);
  if (lastBracket > 0 && lastBracket < cleaned.length - 1) cleaned = cleaned.slice(0, lastBracket + 1);
  return cleaned;
}

function escapeQuotesInJson(json) {
  // Walk character-by-character and escape any `"` that appears inside a string
  // but is NOT a closing delimiter (i.e. not followed by , ] } or :).
  // This handles the common LLM issue: ["text with "quotes" inside", ...]
  let result = '';
  let inString = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];

    if (ch === '\\' && inString) {
      // Consume escaped character as-is
      result += ch + (json[i + 1] || '');
      i += 1;
      continue;
    }

    if (ch === '"') {
      if (inString) {
        // Check if this is a closing delimiter or content quote
        const lookahead = json.slice(i + 1).match(/^\s*(.)/);
        const next = lookahead ? lookahead[1] : '';
        if (next === ',' || next === ']' || next === '}' || next === ':') {
          inString = false;
          result += '"';
        } else {
          result += '\\"';
        }
      } else {
        inString = true;
        result += '"';
      }
      continue;
    }

    result += ch;
  }

  return result;
}

function parseJsonResponse(raw) {
  const json = extractJson(raw);

  // Fast path: strict parse
  try {
    return JSON.parse(json);
  } catch {
    // Repair pass: handle trailing commas + unescaped quotes
    let repaired = json
      .replace(/,(\s*[}\]])/g, '$1');       // trailing commas
    try {
      return JSON.parse(repaired);
    } catch {
      repaired = escapeQuotesInJson(repaired);
      try {
        return JSON.parse(repaired);
      } catch (error) {
        throw new SyntaxError(
          `Structured translation did not return valid JSON.\n${json.slice(0, 500)}`
        );
      }
    }
  }
}

function parseSingleTranslationResponse(raw, sourceValue) {
  let cleaned = String(raw ?? '').trim();
  const fencedMatch = cleaned.match(/^```(?:json|text|markdown)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    cleaned = fencedMatch[1].trim();
  }

  if (!cleaned) {
    throw new Error('Item-by-item translation returned an empty response.');
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return String(parsed[0] ?? sourceValue);
    }
    if (typeof parsed === 'string') {
      return parsed;
    }
  } catch {
    // A plain-text response is valid for the item-by-item fallback.
  }

  return cleaned;
}

// ── Batch translation ────────────────────────────────────────────────

async function translateStringBatch({
  apiKey,
  model,
  fromLocale,
  toLocale,
  values,
  maxAttempts,
  retryDelaySeconds,
}) {
  if (!values.length) {
    return new Map();
  }

  const payload = JSON.stringify(values);
  const translated = await invokeDeepSeekTranslation({
    apiKey,
    model,
    fromLocale,
    toLocale,
    content: payload,
    maxAttempts,
    retryDelaySeconds,
  });

  let translatedValues;
  try {
    translatedValues = parseJsonResponse(translated);
  } catch {
    throw new Error(`Structured translation did not return valid JSON for ${toLocale}.`);
  }

  if (!Array.isArray(translatedValues) || translatedValues.length !== values.length) {
    throw new Error(`Structured translation length mismatch for ${toLocale}.`);
  }

  const translatedMap = new Map();
  values.forEach((value, index) => {
    translatedMap.set(value, String(translatedValues[index] ?? value));
  });
  return translatedMap;
}

async function translateStructuredData(data, context) {
  const values = [];
  collectTranslatableStrings(data, values);
  const uniqueValues = [...new Set(values)];
  let translatedMap;
  try {
    translatedMap = await translateStringBatch({
      ...context,
      values: uniqueValues,
    });
  } catch (error) {
    console.warn(`Falling back to item-by-item structured translation for ${context.toLocale}: ${error instanceof Error ? error.message : String(error)}`);
    translatedMap = new Map();
    for (const value of uniqueValues) {
      const translatedValue = await invokeDeepSeekTranslation({
        ...context,
        content: value,
        systemPrompt: `You are a precise website localization engine. Translate one text value from ${languageNames[context.fromLocale] || context.fromLocale} to ${languageNames[context.toLocale] || context.toLocale}. Return only the translated text, without JSON, quotes, markdown fences, explanations, labels, or numbering. Preserve URLs, emails, file paths, product codes, numerals, placeholders, and inline HTML/Markdown syntax.`,
        userContent: value,
      });
      translatedMap.set(value, parseSingleTranslationResponse(translatedValue, value));
    }
  }
  return applyTranslations(data, translatedMap);
}

function serializeMarkdown(frontmatter, body) {
  const serializedFrontmatter = stringifyYaml(frontmatter).trimEnd();
  const trimmedBody = body.replace(/^\s+/, '');
  return `---\n${serializedFrontmatter}\n---\n\n${trimmedBody}`;
}

async function translateMarkdownBody(body, context) {
  const sourceLang = languageNames[context.fromLocale] || context.fromLocale;
  const targetLang = languageNames[context.toLocale] || context.toLocale;
  return invokeDeepSeekTranslation({
    ...context,
    content: body,
    systemPrompt: 'You are a precise Markdown website localization engine. Keep the same Markdown structure, headings, lists, links, emphasis, images, and paragraph breaks. Do not return JSON. Do not add code fences unless the source text already has code fences. Translate only human-readable prose.',
    userContent: `Translate this Markdown body from ${sourceLang} to ${targetLang}. Return Markdown only, with the same structure. Do not wrap the answer in JSON or code fences.\n\n${body}`,
  });
}

async function translateFileContent(filePath, sourceText, context, options = {}) {
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
    const parsed = parseYaml(sourceText);
    const translated = await translateStructuredData(parsed, context);

    if (options.keepSupportedLocalesLabels && parsed?.supportedLocales) {
      translated.supportedLocales = parsed.supportedLocales;
    }

    return `${stringifyYaml(translated).trimEnd()}\n`;
  }

  const parsed = matter(sourceText);
  const translatedData = await translateStructuredData(parsed.data, context);
  const translatedBody = parsed.content.trim()
    ? await translateMarkdownBody(parsed.content, context)
    : parsed.content;

  return serializeMarkdown(translatedData, translatedBody);
}

// ── Main ─────────────────────────────────────────────────────────────

const options = parseArgs(process.argv.slice(2));
await loadEnvFile();

const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
if (!apiKey) {
  throw new Error('DEEPSEEK_API_KEY is required in .env or current environment.');
}

const model = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat';

const contentRoot = path.join(projectRoot, 'src', 'content');
const settingsPath = path.join(contentRoot, 'siteSettings', 'settings.yaml');
const outputRoot = path.isAbsolute(options.outputRoot) ? options.outputRoot : path.join(projectRoot, options.outputRoot);
const siteSettingsRaw = await fs.readFile(settingsPath, 'utf8');
const defaultLocale = siteSettingsRaw.match(/^defaultLocale:\s*(.+)$/m)?.[1]?.trim() || 'en';
const sourceLocale = options.sourceLocale || defaultLocale;

const targetLocales = await getSupportedLocales(settingsPath, options.locales, sourceLocale);
if (!targetLocales.length) {
  throw new Error('No target locales resolved for translation.');
}

let files = await walkFiles(contentRoot);
if (options.limit > 0) {
  files = files.slice(0, options.limit);
}

await fs.mkdir(outputRoot, { recursive: true });

const failures = [];

await runWithConcurrency(targetLocales, options.throttleLimit, async (targetLocale) => {
  const localeRoot = path.join(outputRoot, targetLocale);
  await fs.mkdir(localeRoot, { recursive: true });

  console.log(`Translating locale: ${targetLocale}`);

  for (const filePath of files) {
    const relativePath = path.relative(projectRoot, filePath).split(path.sep).join('/');
    const outputPath = path.join(localeRoot, relativePath);

    if (!options.force && await fileExists(outputPath)) {
      if (options.stale) {
        const srcStat = await fs.stat(filePath);
        const transStat = await fs.stat(outputPath);
        if (srcStat.mtimeMs <= transStat.mtimeMs) {
          console.log(`Unchanged:  ${targetLocale}/${relativePath}`);
          continue;
        }
        console.log(`Stale:      ${targetLocale}/${relativePath}`);
      } else {
        console.log(`Skipped existing: ${targetLocale}/${relativePath}`);
        continue;
      }
    }

    try {
      const sourceText = await fs.readFile(filePath, 'utf8');
      const translatedText = await translateFileContent(filePath, sourceText, {
        apiKey,
        model,
        fromLocale: sourceLocale,
        toLocale: targetLocale,
        maxAttempts: options.maxAttempts,
        retryDelaySeconds: options.retryDelaySeconds,
      }, {
        keepSupportedLocalesLabels: relativePath.endsWith('src/content/siteSettings/settings.yaml'),
      });

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, translatedText, 'utf8');
      console.log(`Translated: ${targetLocale}/${relativePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed: ${targetLocale}/${relativePath} - ${message}`);
      failures.push(`${targetLocale}:${relativePath} - ${message}`);
    }
  }
});

if (failures.length) {
  throw new Error(`Translation completed with ${failures.length} failures.\n${failures.slice(0, 10).join('\n')}`);
}

console.log('Translation complete.');
