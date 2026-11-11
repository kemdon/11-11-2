#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { assertEnv, loadEnvFile, projectRoot, runCommand, sleep } from './lib/cli-helpers.mjs';

await loadEnvFile();

process.env.WRANGLER_CACHE_DIR = path.join(projectRoot, '.wrangler', 'pages-production-cache');

const token = assertEnv('CLOUDFLARE_API_TOKEN');
const accountId = assertEnv('CLOUDFLARE_ACCOUNT_ID');
const apiBase = 'https://api.cloudflare.com/client/v4';

async function assertWranglerInstall() {
  try {
    await runCommand('pnpm', ['exec', 'wrangler', '--version'], { stdio: 'ignore' });
    return;
  } catch {}
  throw new Error('Wrangler is unavailable. Run `pnpm install --force`, then retry `pnpm run deploy`.');
}

async function runWranglerCommand(args, options = {}) {
  return runCommand('pnpm', ['exec', 'wrangler', ...args], { captureOutput: true, ...options });
}

async function cloudflareApi(pathname, { allowNotFound = false, attempts = 3, method = 'GET', body } = {}) {
  const safePathname = pathname.replace(accountId, '<redacted-account>');
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetch(`${apiBase}${pathname}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (attempt === attempts) throw new Error(`Cloudflare API network failure: ${error.message}`);
      await sleep(750 * attempt);
      continue;
    }
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.success !== false) return payload.result;
    if (allowNotFound && response.status === 404) return null;
    if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
      await sleep(750 * attempt);
      continue;
    }
    const message = payload.errors?.map((item) => item.message).filter(Boolean).join('; ') || `HTTP ${response.status}`;
    throw new Error(`Cloudflare API validation failed for ${safePathname}: ${message}`);
  }
}

async function syncContactFormBindings(projectName) {
  const resendApiKey = assertEnv('RESEND_API_KEY');
  const resendFromEmail = assertEnv('RESEND_FROM_EMAIL');
  // Optional, not a deployment blocker: without a recipient the site still deploys
  // and the Function stays live; only the contact-form email delivery is affected.
  const contactFormToEmail = process.env.CONTACT_FORM_TO_EMAIL?.trim() || '';
  const envVars = {
    RESEND_API_KEY: { type: 'secret_text', value: resendApiKey },
    RESEND_FROM_EMAIL: { type: 'plain_text', value: resendFromEmail },
  };
  if (contactFormToEmail) {
    envVars.CONTACT_FORM_TO_EMAIL = { type: 'plain_text', value: contactFormToEmail };
  } else {
    // Explicitly clear a stale binding so an old recipient does not linger.
    envVars.CONTACT_FORM_TO_EMAIL = null;
    console.log('  note: CONTACT_FORM_TO_EMAIL is not set; contact-form email delivery stays unconfigured (deployment continues).');
  }

  await cloudflareApi(`/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}`, {
    method: 'PATCH',
    body: {
      deployment_configs: {
        production: { env_vars: envVars },
      },
    },
  });
  console.log('Cloudflare Pages production contact-form bindings: synchronized');
}

function assertStaticBuildOutput(expectedOrigin) {
  const distPath = path.join(projectRoot, 'dist');
  if (!existsSync(distPath)) throw new Error('Build output directory not found: dist');
  for (const forbidden of ['_worker.js', '_routes.json']) {
    if (existsSync(path.join(distPath, forbidden))) {
      throw new Error(`Static Cloudflare Pages deploy refused: dist/${forbidden} exists.`);
    }
  }
  const indexHtml = readFileSync(path.join(distPath, 'index.html'), 'utf8');
  const sitemapXml = readFileSync(path.join(distPath, 'sitemap.xml'), 'utf8');
  if (!indexHtml.includes(`rel="canonical" href="${expectedOrigin}`)) {
    throw new Error(`Static deploy refused: dist/index.html canonical does not match ${expectedOrigin}. Rebuild before deploying.`);
  }
  if (!sitemapXml.includes(`<loc>${expectedOrigin}`)) {
    throw new Error(`Static deploy refused: dist/sitemap.xml does not match ${expectedOrigin}. Rebuild before deploying.`);
  }
}

await assertWranglerInstall();
const tokenStatus = await cloudflareApi('/user/tokens/verify');
if (tokenStatus?.status !== 'active') throw new Error('Cloudflare API token is not active.');
await cloudflareApi(`/accounts/${accountId}/pages/projects?per_page=1`);

process.env.SKIP_KEYSTATIC = 'true';
if (!process.env.NODE_OPTIONS || !process.env.NODE_OPTIONS.includes('--max-old-space-size')) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=8192`.trim();
}

const projectName = assertEnv('CLOUDFLARE_PAGES_PROJECT_NAME');
const productionBranch = assertEnv('CLOUDFLARE_PAGES_PRODUCTION_BRANCH');
const project = await cloudflareApi(`/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}`, { allowNotFound: true });

if (!project) {
  throw new Error(`Configured Cloudflare Pages project does not exist or is inaccessible: ${projectName}. Deployment stopped; no project was created.`);
}
if (project.name !== projectName) throw new Error(`Cloudflare Pages project identity mismatch: expected ${projectName}.`);
if (project.production_branch !== productionBranch) {
  throw new Error(`Cloudflare Pages production branch mismatch: project=${project.production_branch}, configured=${productionBranch}.`);
}

// Informational, deliberately not fatal: `*.pages.dev` is a global namespace, so
// a project name that is already taken comes back with a suffix. Production is
// unaffected because a Custom Domain routes by hostname, not by that name -- but
// a suffixed project is not addressable as a preview slug, so it is worth seeing.
const expectedPagesHostname = `${projectName}.pages.dev`;
console.log(`Cloudflare Pages subdomain: ${project.subdomain || '(none)'}`);
if (project.subdomain && project.subdomain !== expectedPagesHostname) {
  console.log(
    `  note: expected ${expectedPagesHostname}. The name is taken globally, so this project cannot be reached as a preview slug.`,
  );
}

const configuredSiteOrigin = process.env.PUBLIC_SITE_URL?.trim();
const customDomain = process.env.CLOUDFLARE_PAGES_CUSTOM_DOMAIN?.trim();
const pagesHostname = typeof project.subdomain === 'string' && project.subdomain.trim()
  ? project.subdomain.trim()
  : `${projectName}.pages.dev`;
const productionSiteOrigin = configuredSiteOrigin || (customDomain ? `https://${customDomain}` : `https://${pagesHostname}`);
const parsedSiteOrigin = new URL(productionSiteOrigin);
if (parsedSiteOrigin.protocol !== 'https:' || !parsedSiteOrigin.hostname) {
  throw new Error('PUBLIC_SITE_URL must be an absolute HTTPS production origin.');
}
process.env.PUBLIC_SITE_URL = parsedSiteOrigin.origin;

console.log('Cloudflare token: active');
console.log('Cloudflare account: valid for Pages');
console.log(`Cloudflare Pages project: ${projectName}`);
console.log(`Cloudflare production branch: ${productionBranch}`);
console.log(`Production site origin: ${parsedSiteOrigin.origin}`);
// Deployment shape. The site is a static Pages deployment by default; the Resend
// contact Function is opt-in, because a Function is not just extra code -- it has
// to be re-provisioned together with its secrets in every Cloudflare account the
// site is deployed to, while a static deployment is nothing but `dist/`.
const functionsDirectory = path.join(projectRoot, 'functions');
const contactFunctionPath = ['functions/api/contact.js', 'functions/api/contact.ts']
  .map((relativePath) => path.join(projectRoot, relativePath))
  .find((absolutePath) => existsSync(absolutePath));

const declaredContactFormMode = (process.env.CONTACT_FORM_MODE || '').trim().toLowerCase();
const CONTACT_FORM_MODE = declaredContactFormMode || (contactFunctionPath ? 'function' : 'static');
if (!['static', 'function'].includes(CONTACT_FORM_MODE)) {
  throw new Error(`CONTACT_FORM_MODE must be "static" or "function", got "${CONTACT_FORM_MODE}".`);
}
if (!declaredContactFormMode) {
  console.log(
    `CONTACT_FORM_MODE is not set; inferred "${CONTACT_FORM_MODE}". ` +
      'Set it explicitly in .env so the deployment shape is declared rather than guessed.',
  );
}

if (CONTACT_FORM_MODE === 'function') {
  if (!contactFunctionPath) {
    throw new Error('CONTACT_FORM_MODE=function but functions/api/contact.js is missing.');
  }
  await syncContactFormBindings(projectName);
  console.log('Contact-form bindings: synchronized (CONTACT_FORM_MODE=function)');
} else {
  if (existsSync(functionsDirectory)) {
    throw new Error(
      [
        'CONTACT_FORM_MODE=static but a functions/ directory exists.',
        'A static deployment ships dist/ only, so this is a contradiction, not a warning:',
        '  - to deploy the Resend contact Function, set CONTACT_FORM_MODE=function',
        '  - to keep the site purely static, remove functions/',
      ].join('\n'),
    );
  }
  const contactEndpoint = process.env.PUBLIC_CONTACT_FORM_ENDPOINT?.trim() ?? '';
  if (contactEndpoint.startsWith('/')) {
    throw new Error(
      `CONTACT_FORM_MODE=static cannot serve the same-origin endpoint "${contactEndpoint}". ` +
        'Set CONTACT_FORM_MODE=function, or point PUBLIC_CONTACT_FORM_ENDPOINT at an external URL.',
    );
  }
  console.log('Contact-form bindings: skipped (CONTACT_FORM_MODE=static)');
}

console.log(
  `Deployment target: Cloudflare Pages production (${
    CONTACT_FORM_MODE === 'function' ? 'static assets + contact Function' : 'static assets only'
  })`,
);

const skipBuild = process.argv.includes('--skip-build');
await runCommand('pnpm', ['run', 'audit:images']);
await runCommand('pnpm', ['run', 'audit:admin-preview']);
await runCommand('pnpm', ['run', 'audit:keystatic:layout']);
if (!skipBuild) await runCommand('pnpm', ['run', 'build']);
assertStaticBuildOutput(parsedSiteOrigin.origin);
await runCommand('pnpm', ['run', 'audit:images', '--', '--built']);

console.log(`Deploying dist to Cloudflare Pages production: ${projectName}`);
// Wrangler discovers Functions relative to its own working directory, and there
// is no `--functions-directory` flag to override that. So the two modes deploy
// from different places: `--cwd dist` ships the static build alone, while the
// repository root is what makes Wrangler pick up functions/api/contact.js.
const staticOnly = CONTACT_FORM_MODE !== 'function';
const deployResult = await runWranglerCommand([
  'pages',
  'deploy',
  staticOnly ? '.' : 'dist',
  '--project-name',
  projectName,
  '--branch',
  productionBranch,
  '--cwd',
  staticOnly ? path.join(projectRoot, 'dist') : projectRoot,
]);
const deploymentUrl = deployResult.output.match(/https:\/\/[a-z0-9.-]+\.pages\.dev\/?/i)?.[0]?.replace(/\/$/, '');
if (!deploymentUrl) throw new Error('Wrangler did not report a Pages deployment URL.');

const deployments = await cloudflareApi(`/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/deployments?per_page=10`);
const deployment = deployments.find((item) => item.url === deploymentUrl || item.aliases?.includes(deploymentUrl));
if (!deployment) throw new Error(`Pages API did not return the Wrangler deployment URL: ${deploymentUrl}`);
if (deployment.environment !== 'production') throw new Error(`Pages deployment environment is ${deployment.environment}, expected production.`);
if (deployment.latest_stage?.status !== 'success') throw new Error(`Pages deployment status is ${deployment.latest_stage?.status}, expected success.`);
if (deployment.deployment_trigger?.metadata?.branch !== productionBranch) {
  throw new Error(`Pages deployment branch is ${deployment.deployment_trigger?.metadata?.branch}, expected ${productionBranch}.`);
}

console.log(`Production deployment URL: ${deployment.url}`);
console.log(`Production deployment ID: ${deployment.id}`);
console.log(`Cloudflare production status: ${deployment.latest_stage.name}/${deployment.latest_stage.status}`);
console.log(`Cloudflare production environment: ${deployment.environment}`);
console.log(`Cloudflare production branch confirmed: ${productionBranch}`);

if (process.env.CLOUDFLARE_PAGES_CUSTOM_DOMAIN?.trim()) {
  console.log(`Ensuring Pages custom domain: ${process.env.CLOUDFLARE_PAGES_CUSTOM_DOMAIN.trim()}`);
  await runCommand('node', ['./scripts/ensure-pages-custom-domain.mjs']);
}

console.log('Result: Success');
