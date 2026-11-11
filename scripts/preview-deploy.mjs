#!/usr/bin/env node
//
// Deploy a throwaway preview of this site to the shared staging zone.
//
// A preview URL is  https://{slug}.zhidaola.top  and it is served by the fixed
// preview-router Worker, which proxies {slug}.zhidaola.top to
// {slug}.pages.dev.
//
// Two properties make that chain fragile, and this script exists to make both
// of them fail loudly instead of silently:
//
//   1. *.pages.dev is a single global namespace. If the slug is already taken
//      by anybody else, Cloudflare quietly hands back {slug}-xxxx.pages.dev,
//      the Worker still proxies to {slug}.pages.dev, and the "preview" shows a
//      stranger's site with a 200. So the project's real subdomain is asserted.
//   2. The Worker cannot tell which account a preview project lives in, it only
//      resolves a global name. So the credentials are asserted against the
//      account that owns the staging zone before anything is created.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { assertEnv, loadEnvFile, projectRoot, runCommand, sleep } from './lib/cli-helpers.mjs';

await loadEnvFile();

const apiBase = 'https://api.cloudflare.com/client/v4';
const PREVIEW_DOMAIN = process.env.PREVIEW_DOMAIN || 'zhidaola.top';
const RETRY_ATTEMPTS = 12;
const RETRY_DELAY_MS = 10_000;

function getArgValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();

  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1]?.trim();

  return '';
}

function getShanghaiTimestampSlug() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(new Date())
    .reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});

  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

function assertSlug(slug) {
  if (!/^\d{14}$/.test(slug)) {
    throw new Error(`Invalid preview slug (expected yyyyMMddHHmmss): ${slug}`);
  }
}

function assertStaticBuildOutput() {
  const distPath = path.join(projectRoot, 'dist');
  if (!existsSync(distPath)) {
    throw new Error('Build output directory not found: dist');
  }

  if (existsSync(path.join(distPath, '_worker.js'))) {
    throw new Error('Preview deploy refused: dist/_worker.js exists.');
  }

  if (existsSync(path.join(distPath, '_routes.json'))) {
    throw new Error('Preview deploy refused: dist/_routes.json exists.');
  }
}

// Astro emits content-hashed asset filenames, so the entry stylesheet is a
// build-specific string. Finding it in the deployed HTML is what proves the
// response came from THIS build rather than from some other Pages project that
// happens to answer on the same name.
function buildFingerprint() {
  const indexPath = path.join(projectRoot, 'dist', 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  const match = html.match(/\/_astro\/[A-Za-z0-9._-]+\.(?:css|js)/);
  if (!match) {
    throw new Error(
      'Could not find an /_astro/* asset reference in dist/index.html, so the deployed page cannot be tied back to this build.',
    );
  }
  return match[0];
}

async function runWrangler(args, options = {}) {
  return runCommand('pnpm', ['exec', 'wrangler', ...args], { captureOutput: true, ...options });
}

const token = assertEnv('CLOUDFLARE_API_TOKEN');
const accountId = assertEnv('CLOUDFLARE_ACCOUNT_ID');

async function cloudflareApi(pathname, { allowNotFound = false, method = 'GET', body } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.ok && payload.success !== false) return payload.result;
  if (allowNotFound && response.status === 404) return null;
  const message =
    payload.errors?.map((item) => item.message).filter(Boolean).join('; ') || `HTTP ${response.status}`;
  throw new Error(`Cloudflare API ${pathname}: ${message}`);
}

async function assertPreviewZoneOwnership() {
  const zones = await cloudflareApi(`/zones?name=${encodeURIComponent(PREVIEW_DOMAIN)}`);
  const zone = Array.isArray(zones) ? zones[0] : null;

  if (!zone) {
    throw new Error(
      [
        `These credentials cannot see the preview zone ${PREVIEW_DOMAIN}.`,
        'A preview deployment must run against the account that owns the staging zone.',
        'Refusing to create a Pages project anywhere else -- otherwise the preview would be',
        'built in an unrelated account and the shared router would still resolve it by name.',
        'If this is a CI/CD run, the injected CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are',
        'pointed at the wrong account.',
      ].join('\n'),
    );
  }
  if (zone.account?.id !== accountId) {
    throw new Error(
      `Preview zone ${PREVIEW_DOMAIN} belongs to account ${zone.account?.id}, but CLOUDFLARE_ACCOUNT_ID is ${accountId}.`,
    );
  }
  if (zone.status !== 'active') {
    throw new Error(`Preview zone ${PREVIEW_DOMAIN} is "${zone.status}", expected "active".`);
  }
  return zone;
}

async function getPagesProject(name) {
  return cloudflareApi(`/accounts/${accountId}/pages/projects/${encodeURIComponent(name)}`, {
    allowNotFound: true,
  });
}

async function fetchEventually(url, { expectedHeader } = {}) {
  let lastFailure = 'no attempt made';

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      const body = await response.text();

      if (!response.ok) {
        lastFailure = `HTTP ${response.status}`;
      } else if (expectedHeader) {
        const actual = response.headers.get(expectedHeader.name);
        if (actual !== expectedHeader.value) {
          // A 2xx with the wrong routing header is not a propagation delay: the
          // request did not go through the shared router as this slug.
          throw new Error(
            `${url} returned ${response.status} but ${expectedHeader.name}=${actual}, expected ${expectedHeader.value}.`,
          );
        }
        return body;
      } else {
        return body;
      }
    } catch (error) {
      if (error.message.startsWith(url)) throw error;
      lastFailure = error.message;
    }

    if (attempt < RETRY_ATTEMPTS) {
      console.log(`  waiting for ${url} (${lastFailure}), retry ${attempt}/${RETRY_ATTEMPTS - 1}`);
      await sleep(RETRY_DELAY_MS);
    }
  }

  throw new Error(`${url} was not usable after ${RETRY_ATTEMPTS} attempts: ${lastFailure}`);
}

const zone = await assertPreviewZoneOwnership();
console.log(`Preview zone: ${PREVIEW_DOMAIN} (account ${zone.account.id})`);

const explicitSlug = getArgValue('--slug');
const slug = explicitSlug || getShanghaiTimestampSlug();
assertSlug(slug);

const host = `${slug}.${PREVIEW_DOMAIN}`;
const previewUrl = `https://${host}`;
const pagesUrl = `https://${slug}.pages.dev`;
const expectedSubdomain = `${slug}.pages.dev`;
const reuseExisting = process.argv.includes('--reuse');
const skipBuild = process.argv.includes('--skip-build');

process.env.SKIP_KEYSTATIC = 'true';
process.env.CLOUDFLARE_PAGES_PROJECT_NAME = slug;
if (!process.env.NODE_OPTIONS || !process.env.NODE_OPTIONS.includes('--max-old-space-size')) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=8192`.trim();
}

console.log(`Preview slug: ${slug}`);
console.log(`Preview URL: ${previewUrl}`);

if (!skipBuild) {
  await runCommand('pnpm', ['run', 'build']);
}

assertStaticBuildOutput();
const fingerprint = buildFingerprint();
await runCommand('node', ['./scripts/optimize-images.mjs']);
await runCommand('pnpm', ['run', 'audit:images', '--', '--built']);

if (explicitSlug && (await getPagesProject(slug)) && !reuseExisting) {
  throw new Error(
    [
      `Cloudflare Pages project "${slug}" already exists and was not created by this run.`,
      'Refusing to overwrite it. Re-run without --slug to get a fresh timestamp,',
      'or pass --reuse if redeploying into that project is deliberate.',
    ].join('\n'),
  );
}

if (!(await getPagesProject(slug))) {
  console.log(`Creating Cloudflare Pages project: ${slug}`);
  await runWrangler(['pages', 'project', 'create', slug, '--production-branch', 'main']);
} else {
  console.log(`Reusing existing Cloudflare Pages project: ${slug}`);
}

// The staging zone is served by a router that resolves {slug}.pages.dev. If
// Cloudflare handed out a suffixed subdomain the whole preview chain points at
// a name this project does not own, so stop before deploying anything.
const project = await getPagesProject(slug);
if (project.subdomain !== expectedSubdomain) {
  throw new Error(
    [
      `Cloudflare assigned the subdomain "${project.subdomain}", not "${expectedSubdomain}".`,
      `"${expectedSubdomain}" is already taken in the global *.pages.dev namespace, so the`,
      `router would proxy ${host} to a project that is not yours.`,
      'Re-run without --slug to generate a fresh timestamp.',
    ].join('\n'),
  );
}
console.log(`Cloudflare Pages subdomain confirmed: ${project.subdomain}`);

const CONTACT_FORM_MODE = (process.env.CONTACT_FORM_MODE || '').trim().toLowerCase();
const staticOnly = CONTACT_FORM_MODE !== 'function';

console.log(`Deploying dist to Cloudflare Pages project: ${slug} (${staticOnly ? 'static only' : 'static + Functions'})`);
await runWrangler([
  'pages',
  'deploy',
  staticOnly ? '.' : 'dist',
  '--project-name',
  slug,
  '--cwd',
  staticOnly ? path.join(projectRoot, 'dist') : projectRoot,
]);

console.log('Verifying the deployment through both URLs');

const pagesBody = await fetchEventually(pagesUrl);
if (!pagesBody.includes(fingerprint)) {
  throw new Error(
    `${pagesUrl} is up but does not contain this build's asset ${fingerprint}. The deployed page is not the build that was just produced.`,
  );
}
console.log(`  ${pagesUrl} -> 2xx and contains ${fingerprint}`);

const previewBody = await fetchEventually(previewUrl, {
  expectedHeader: { name: 'x-preview-slug', value: slug },
});
if (!previewBody.includes(fingerprint)) {
  throw new Error(
    `${previewUrl} is up but does not contain this build's asset ${fingerprint}. The request reached the router but not this build.`,
  );
}
console.log(`  ${previewUrl} -> 2xx, x-preview-slug=${slug}, contains ${fingerprint}`);

console.log('');
console.log('Preview deployment verified.');
console.log(`Slug: ${slug}`);
console.log(`Pages URL: ${pagesUrl}`);
console.log(`Preview URL: ${previewUrl}`);
