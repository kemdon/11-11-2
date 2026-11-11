#!/usr/bin/env node

import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { runCommand } from './lib/cli-helpers.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const archiveName = 'project-source.zip';
const archivePath = path.join(projectRoot, archiveName);

if (existsSync(archivePath)) {
  rmSync(archivePath);
}

const excludedNames = new Set(['node_modules', 'dist', '.astro', '.wrangler', 'logs']);
const sourcePaths = readdirSync(projectRoot, { withFileTypes: true })
  .map((entry) => entry.name)
  .filter((name) => !excludedNames.has(name))
  .filter((name) => !/\.zip$/i.test(name) && !/\.tar\.gz$/i.test(name))
  .map((name) => path.join(projectRoot, name));

const quotePowerShellString = (value) => `'${value.replaceAll("'", "''")}'`;
const sourceList = sourcePaths.map(quotePowerShellString).join(',');
const command = [
  `$paths = @(${sourceList})`,
  `Compress-Archive -LiteralPath $paths -DestinationPath ${quotePowerShellString(archivePath)} -Force`,
].join('; ');

await runCommand('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { cwd: projectRoot });
console.log(`Created: ${archivePath}`);
console.log('Use this archive when moving the project to another Windows computer.');

if (process.platform === 'win32') {
  await runCommand('explorer.exe', [`/select,${archivePath}`], { cwd: projectRoot, stdio: 'ignore' }).catch(() => {});
}
