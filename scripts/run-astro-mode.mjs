#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [, , command = 'build'] = process.argv;
const passthroughArgs = process.argv
  .slice(3)
  .filter((arg) => arg !== '--');

if (!['build', 'preview'].includes(command)) {
  console.error(`Unsupported Astro command: ${command}`);
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const env = { ...process.env };
if (isWindows) {
  const preflight = spawnSync(process.execPath, ['./scripts/windows-astro-preflight.mjs'], { stdio: 'inherit' });
  if (preflight.status !== 0) process.exit(preflight.status ?? 1);
}
env.SKIP_KEYSTATIC = 'true';
env.ASTRO_DEPLOY_MODE = 'static';
if (!env.NODE_OPTIONS || !env.NODE_OPTIONS.includes('--max-old-space-size')) {
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --max-old-space-size=8192`.trim();
}

const quoteCmdArg = (value) => `"${String(value).replace(/"/g, '""')}"`;
const astroArgs = ['exec', 'astro', command, ...passthroughArgs];
const result = spawnSync(
  isWindows ? (process.env.ComSpec || 'cmd.exe') : 'pnpm',
  isWindows
    ? ['/d', '/s', '/c', ['pnpm.cmd', ...astroArgs.map(quoteCmdArg)].join(' ')]
    : astroArgs,
  {
  stdio: 'inherit',
  env,
  shell: false,
  windowsVerbatimArguments: isWindows,
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (command === 'build' && existsSync('dist/_worker.js')) {
  console.error('Static Pages build must not contain dist/_worker.js.');
  process.exit(1);
}

if (command === 'build' && existsSync('dist/_routes.json')) {
  console.error('Static Pages build must not contain dist/_routes.json.');
  process.exit(1);
}
