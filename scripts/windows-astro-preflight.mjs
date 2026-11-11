#!/usr/bin/env node

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const cacheDir = path.join(projectRoot, '.vite-cache');
const probe = path.join(cacheDir, `.write-test-${process.pid}`);

await mkdir(cacheDir, { recursive: true });
try {
  await writeFile(probe, 'ok', 'utf8');
  await rm(probe, { force: true });
} catch (error) {
  console.error(`Astro Windows preflight: Vite cache is not writable: ${cacheDir}`);
  console.error(error.message);
  console.error('Repair the project-folder ACL, then rerun pnpm install and pnpm run build.');
  process.exit(1);
}

if (process.platform === 'win32') {
  console.log(`Astro Windows preflight: using project-local Vite cache ${cacheDir}`);
}
