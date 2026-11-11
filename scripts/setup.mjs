#!/usr/bin/env node

import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { runCommand } from './lib/cli-helpers.mjs';

console.log('Checking Node.js...');
await runCommand('node', ['-v']);

const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageManagerMatch = String(packageJson.packageManager ?? '').match(/^pnpm@(.+)$/);
const expectedPnpmVersion = packageManagerMatch?.[1] ?? '';

async function getInstalledPnpmVersion() {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'pnpm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm.cmd -v']
    : ['-v'];
  return new Promise((resolve) => {
    const chunks = [];
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsVerbatimArguments: process.platform === 'win32',
    });
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.on('error', () => resolve(''));
    child.on('close', (code) => resolve(code === 0 ? Buffer.concat(chunks).toString('utf8').trim() : ''));
  });
}

const installedPnpmVersion = await getInstalledPnpmVersion();

if (!installedPnpmVersion || (expectedPnpmVersion && installedPnpmVersion !== expectedPnpmVersion)) {
  const pnpmPackage = expectedPnpmVersion ? `pnpm@${expectedPnpmVersion}` : 'pnpm';
  console.log(
    installedPnpmVersion
      ? `pnpm ${installedPnpmVersion} does not match package.json. Installing ${pnpmPackage}...`
      : `pnpm not found. Installing ${pnpmPackage}...`,
  );
  await runCommand('npm', ['install', '-g', pnpmPackage]);
  await runCommand('pnpm', ['-v']);
}

console.log('Installing project dependencies with pnpm...');
await runCommand('pnpm', ['install', '--force']);

console.log('');
console.log('Install summary');
console.log('Dependencies: Installed');
console.log('Result: Success');
