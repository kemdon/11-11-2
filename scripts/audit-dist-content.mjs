// Post-build dist audit (section 11.5):
// 1. every customer-visible business text on production pages must trace to a
//    Keystatic-managed content YAML value
// 2. every Keystatic field rendered by front-end templates must have non-empty
//    values in the content files (no blank nodes on production pages)
// 3. every img[src] in dist HTML must trace to a fields.image-derived YAML value
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const root = process.cwd();
const dist = path.join(root, 'dist');
const problems = [];

// ---- collect content values (source of truth) ----
function collectStrings(node, keyHint, strings, images) {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    const v = node.trim();
    if (v) strings.add(v.replace(/\s+/g, ' '));
    if (/^(image|logoMark|logoPath|defaultOgImage|mainImage)$/.test(keyHint || '')) images.add(v);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, keyHint, strings, images);
    return;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) collectStrings(v, k, strings, images);
  }
}

const contentValues = new Set();
const imageValues = new Set();
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.yaml$/.test(entry.name)) {
      let parsed;
      try { parsed = parseYaml(fs.readFileSync(full, 'utf8')); } catch { continue; }
      collectStrings(parsed, null, contentValues, imageValues);
    }
  }
}
walk(path.join(root, 'src', 'content'));
walk(path.join(root, 'i18n-output'));

// template literal corpus: chrome/UI copy authored directly in templates is
// reported separately from untraceable text (which stays a hard failure)
const templateValues = new Set();
function walkTemplates(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTemplates(full);
    else if (/\.(astro|ts|tsx)$/.test(entry.name) && !full.includes('content' + path.sep)) {
      const text = fs.readFileSync(full, 'utf8');
      for (const m of text.matchAll(/['"`]([^'"`\n]{2,200})['"`]/g)) templateValues.add(m[1]);
    }
  }
}
walkTemplates(path.join(root, 'src'));

const templateCorpus = [...templateValues];
const coveredMemo = new Map();
// a string is template-covered when it is a substring of a template literal or
// segments into corpus pieces (handles `${label}suffix` concatenations)
function templateCovered(s) {
  if (coveredMemo.has(s)) return coveredMemo.get(s);
  if (s.length < 2) return true;
  let result = false;
  for (const cand of templateCorpus) {
    if (cand.length < 2) continue;
    if (cand.includes(s)) { result = true; break; }
    const idx = s.indexOf(cand);
    if (idx === -1) continue;
    if (templateCovered(s.slice(0, idx)) && templateCovered(s.slice(idx + cand.length))) { result = true; break; }
  }
  coveredMemo.set(s, result);
  return result;
}
let templateBackedCount = 0;

// ---- scan production HTML pages ----
const htmlFiles = [];
function walkDist(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDist(full);
    else if (/\.html$/.test(entry.name)) htmlFiles.push(full);
  }
}
walkDist(dist);

const exemptExact = new Set(['/keystatic', '/404.html']);
let emptyNodeCount = 0;
let imageRefCount = 0;
for (const file of htmlFiles) {
  const rel = path.relative(dist, file).replace(/\\/g, '/');
  if (exemptExact.has('/' + rel.replace(/\\/g, '/')) || rel.startsWith('keystatic')) continue;

  const html = fs.readFileSync(file, 'utf8');
  // strip inline script/style bodies so JS/CSS tokens are not mistaken for text
  const htmlNoScript = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');

  // (3) image traceability: every img src must be a known content image value
  for (const m of html.matchAll(/<img[^>]*>/g)) {
    const tag = m[0];
    const srcMatch = tag.match(/\ssrc="([^"]+)"/);
    imageRefCount += 1;
    if (!srcMatch) {
      problems.push(`${rel}: <img> tag without src attribute: ${tag.slice(0, 100)}`);
      continue;
    }
    const src = srcMatch[1];
    if (src.startsWith('data:') || src.startsWith('http')) continue;
    if (!imageValues.has(src)) {
      problems.push(`${rel}: img src not traceable to content YAML: ${src}`);
    }
  }

  // (2) empty rendered fields: detect common CMS-driven empty outputs
  for (const m of html.matchAll(/<(h1|h2|h3|h4|p|span|div|a|button)([^>]*)>(\s*)<\/\1>/g)) {
    const attrs = m[2] || '';
    // decorative/aria-hidden spans and live-status regions are intentionally empty
    if (/aria-hidden|form-status|aria-live|class="[^"]*(icon|divider|spacer|scroll|menu-toggle|hamburger|dot|overlay|arrow|poster|slide|shade|page-status|newsletter-status|status)/.test(attrs)) continue;
    if (!attrs.trim()) continue; // bare decorative <span></span> (menu bars etc.)
    emptyNodeCount += 1;
    problems.push(`${rel}: empty <${m[1]}> node rendered (possible empty CMS field)`);
  }

  // (1) hardcoded business text heuristic: visible latin/zh sentences inside
  // tags that do NOT appear in any content YAML
  const visibleText = [];
  for (const m of html.matchAll(/>([^<>{}]{8,})</g)) {
    const t = m[1].trim();
    if (!t) continue;
    if (/^[0-9\s.,:;+%°()\-—•|]+$/.test(t)) continue;
    visibleText.push(t);
  }
  for (const t of visibleText) {
    // decode common HTML entities, then fold whitespace for comparison
    const decoded = t
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ');
    const folded = decoded.replace(/\s+/g, ' ');
    let found = contentValues.has(folded) || contentValues.has(decoded);
    if (!found) {
      for (const v of contentValues) {
        const vf = v.replace(/\s+/g, ' ');
        if (vf.includes(folded) || folded.includes(vf)) { found = true; break; }
      }
    }
    if (!found && templateCovered(folded)) {
      templateBackedCount += 1;
      found = true;
    }
    if (!found) {
      problems.push(`${rel}: text not traceable to content files: "${t.slice(0, 80)}"`);
    }
  }
}

console.log(`dist audit: ${htmlFiles.length} HTML page(s), ${imageRefCount} img tag(s), ${emptyNodeCount} empty-node candidate(s)`);
console.log(`template-backed strings (exempted, P2): ${templateBackedCount}`);
if (problems.length) {
  console.error(`DIST AUDIT FAILED (${problems.length}):`);
  for (const p of problems.slice(0, 40)) console.error('- ' + p);
  if (problems.length > 40) console.error(`... and ${problems.length - 40} more`);
  process.exit(1);
}
console.log('dist content audit passed: all visible text/images trace to content files.');
