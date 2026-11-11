#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from './lib/cli-helpers.mjs';

const auditRoot = process.argv[2] ? path.resolve(process.argv[2]) : projectRoot;
const distRoot = path.join(auditRoot, 'dist');
if (!existsSync(distRoot)) throw new Error('SEO audit requires an existing dist directory. Run the production build first.');

const htmlFiles = [];
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(fullPath);
    else if (entry.name.endsWith('.html')) htmlFiles.push(fullPath);
  }
};
visit(distRoot);

const issues = [];
const contentOf = (html, pattern) => html.match(pattern)?.[1]?.trim() || '';
for (const file of htmlFiles) {
  const relativePath = path.relative(distRoot, file).replaceAll('\\', '/');
  const html = readFileSync(file, 'utf8');
  const title = contentOf(html, /<title>([\s\S]*?)<\/title>/i);
  const description = contentOf(html, /<meta\s+name="description"\s+content(?:="([^"]*)")?[^>]*>/i);
  const canonical = contentOf(html, /<link\s+rel="canonical"\s+href="([^"]+)"[^>]*>/i);
  const robots = contentOf(html, /<meta\s+name="robots"\s+content="([^"]+)"[^>]*>/i);
  const ogTitle = contentOf(html, /<meta\s+property="og:title"\s+content(?:="([^"]*)")?[^>]*>/i);
  const ogDescription = contentOf(html, /<meta\s+property="og:description"\s+content(?:="([^"]*)")?[^>]*>/i);
  const ogUrl = contentOf(html, /<meta\s+property="og:url"\s+content="([^"]+)"[^>]*>/i);
  const twitterCard = contentOf(html, /<meta\s+name="twitter:card"\s+content="([^"]+)"[^>]*>/i);
  const twitterTitle = contentOf(html, /<meta\s+name="twitter:title"\s+content(?:="([^"]*)")?[^>]*>/i);
  const twitterDescription = contentOf(html, /<meta\s+name="twitter:description"\s+content(?:="([^"]*)")?[^>]*>/i);
  const is404 = relativePath === '404.html';
  // Redirect stub pages (meta refresh + noindex) are not indexable content.
  const isRedirectStub = /<meta\s+http-equiv="refresh"/i.test(html) && /\bnoindex\b/i.test(robots || html);

  if (isRedirectStub) continue;

  if (!is404 && !title) issues.push(`${relativePath}: title is empty`);
  if (!is404 && !description) issues.push(`${relativePath}: meta description is empty`);
  if (!/^https:\/\//i.test(canonical)) issues.push(`${relativePath}: canonical is missing or not HTTPS`);
  if (!is404 && !ogTitle) issues.push(`${relativePath}: og:title is empty`);
  if (!is404 && !ogDescription) issues.push(`${relativePath}: og:description is empty`);
  if (ogUrl !== canonical) issues.push(`${relativePath}: og:url does not match canonical`);
  if (!twitterCard) issues.push(`${relativePath}: twitter:card is missing`);
  if (!is404 && !twitterTitle) issues.push(`${relativePath}: twitter:title is empty`);
  if (!is404 && !twitterDescription) issues.push(`${relativePath}: twitter:description is empty`);
  if (is404 && !/\bnoindex\b/i.test(robots)) issues.push(`${relativePath}: 404 page is not noindex`);
}

const robotsPath = path.join(distRoot, 'robots.txt');
const sitemapPath = path.join(distRoot, 'sitemap.xml');
if (!existsSync(robotsPath)) issues.push('robots.txt is missing');
else if (!/^Sitemap:\s+https:\/\//im.test(readFileSync(robotsPath, 'utf8'))) issues.push('robots.txt has no absolute HTTPS sitemap URL');
if (!existsSync(sitemapPath)) issues.push('sitemap.xml is missing');
else if (!/<loc>https:\/\//i.test(readFileSync(sitemapPath, 'utf8'))) issues.push('sitemap.xml has no absolute HTTPS URL');
for (const forbidden of ['_worker.js', '_routes.json', 'keystatic']) {
  if (existsSync(path.join(distRoot, forbidden))) issues.push(`forbidden production output exists: dist/${forbidden}`);
}

if (issues.length) {
  console.error(`SEO output audit failed (${issues.length} issue${issues.length === 1 ? '' : 's'}):`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`SEO output audit passed (${htmlFiles.length} HTML files checked).`);
