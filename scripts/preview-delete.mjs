#!/usr/bin/env node

import { assertEnv, loadEnvFile, runCommand } from './lib/cli-helpers.mjs';

await loadEnvFile();

function getArgValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();

  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1]?.trim();

  return '';
}

function assertSlug(slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(slug)) {
    throw new Error(`Invalid preview slug: ${slug}`);
  }
}

async function runWrangler(args, options = {}) {
  return runCommand('pnpm', ['exec', 'wrangler', ...args], { captureOutput: true, ...options });
}

assertEnv('CLOUDFLARE_API_TOKEN');
assertEnv('CLOUDFLARE_ACCOUNT_ID');

const slug = getArgValue('--slug') || process.argv[2]?.trim();
if (!slug) {
  throw new Error('Usage: pnpm run preview:delete -- --slug <slug>');
}
assertSlug(slug);

console.log(`Deleting Cloudflare Pages preview project: ${slug}`);
await runWrangler(['pages', 'project', 'delete', slug, '--yes']);
console.log(`Deleted preview project: ${slug}`);
