import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const projectRoot = path.resolve(import.meta.dirname, '..', '..');

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function loadEnvFile(envPath = path.join(projectRoot, '.env')) {
  if (!(await fileExists(envPath))) {
    return;
  }

  const raw = await fs.readFile(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 1) {
      continue;
    }

    const name = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[name]?.trim()) {
      process.env[name] = value;
    }
  }
}

export function assertEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function runCommand(command, args = [], options = {}) {
  const {
    cwd = projectRoot,
    env = process.env,
    stdio = 'inherit',
    shell = false,
    detached = false,
    input,
    captureOutput = false,
  } = options;
  const isWindowsBatchCommand =
    process.platform === 'win32' &&
    !shell &&
    /^(?:npm|npx|pnpm|pnpx|corepack)(?:\.cmd)?$/i.test(command);
  const quoteCmdArg = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const batchCommand = command.replace(/\.cmd$/i, '');
  const resolvedCommand = isWindowsBatchCommand ? (process.env.ComSpec || 'cmd.exe') : command;
  const resolvedArgs = isWindowsBatchCommand
    ? [
        '/d',
        '/s',
        '/c',
        [`${batchCommand}.cmd`, ...args.map(quoteCmdArg)].join(' '),
      ]
    : args;

  return await new Promise((resolve, reject) => {
    const output = [];
    const childStdio = captureOutput ? ['pipe', 'pipe', 'pipe'] : stdio;
    const child = spawn(resolvedCommand, resolvedArgs, {
      cwd,
      env,
      stdio: childStdio,
      shell,
      detached,
      windowsVerbatimArguments: isWindowsBatchCommand,
    });

    if (captureOutput) {
      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        output.push(text);
        process.stdout.write(text);
      });
      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        output.push(text);
        process.stderr.write(text);
      });
    }

    if (input !== undefined && child.stdin) {
      child.stdin.on('error', (err) => {
        // EPIPE is expected when the child closes stdin early
        // (e.g., wrangler prompts for confirmation on existing secrets)
        if (err.code !== 'EPIPE') {
          console.error(`Unexpected stdin error for ${resolvedCommand}:`, err);
        }
      });
      child.stdin.write(input);
      if (!String(input).endsWith('\n')) {
        child.stdin.write('\n');
      }
      child.stdin.end();
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ code, pid: child.pid, output: output.join('') });
        return;
      }
      const details = output.join('').trim();
      reject(new Error(
        [`Command failed: ${[command, ...args].join(' ')}`, details].filter(Boolean).join('\n'),
      ));
    });
  });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForUrl(url, { attempts = 15, delayMs = 1000 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok) {
        return true;
      }
    } catch {}

    await sleep(delayMs);
  }

  return false;
}

export async function openUrl(url) {
  const commands =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];

  try {
    await runCommand(commands[0], commands[1], { stdio: 'ignore' });
  } catch {}
}
