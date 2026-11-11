#!/usr/bin/env node

import fs from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import { ensureDir, fileExists, openUrl, projectRoot, runCommand, waitForUrl } from './lib/cli-helpers.mjs';

function isProcessAlive(pid) {
  try {
    return process.kill(Number(pid), 0);
  } catch {
    return false;
  }
}

function getWindowsProcessCommandLine(pid) {
  if (process.platform !== 'win32') return '';
  return execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`],
    { encoding: 'utf8' },
  ).trim();
}

function processBelongsToProject(pid) {
  if (process.platform !== 'win32') return true;
  try {
    return getWindowsProcessCommandLine(pid).toLowerCase().includes(projectRoot.toLowerCase());
  } catch {
    return false;
  }
}

function getWindowsListeningPid(port) {
  if (process.platform !== 'win32') return null;
  try {
    const value = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `(Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort ${port} -ErrorAction Stop | Select-Object -First 1 -ExpandProperty OwningProcess)`],
      { encoding: 'utf8' },
    ).trim();
    const pid = Number(value);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

// Mirror the dev-server log file to the console in real time so startup errors
// appear directly in the launcher window instead of only inside the log file.
function mirrorLogToConsole(logPath) {
  let lastSize = 0;
  const timer = setInterval(async () => {
    try {
      const stat = await fs.stat(logPath);
      if (stat.size <= lastSize) return;
      const chunkSize = stat.size - lastSize;
      const handle = await fs.open(logPath, 'r');
      try {
        const buffer = Buffer.alloc(chunkSize);
        const { bytesRead } = await handle.read(buffer, 0, chunkSize, lastSize);
        if (bytesRead > 0) {
          process.stdout.write(buffer.subarray(0, bytesRead));
          lastSize += bytesRead;
        }
      } finally {
        await handle.close();
      }
    } catch {
      // The log may briefly not exist during startup; retry on the next tick.
    }
  }, 250);
  return () => clearInterval(timer);
}

const logDir = path.join(projectRoot, 'logs');
const logPath = path.join(logDir, 'keystatic-local.log');
const pidPath = path.join(projectRoot, '.keystatic-local.pid');

function getFreePort(startPort) {
  return new Promise((resolve) => {
    const checkPort = (port) => {
      const server = net.createServer();
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          checkPort(port + 1);
        } else {
          resolve(port);
        }
      });
      server.once('listening', () => {
        server.close(() => resolve(port));
      });
      server.listen(port, '127.0.0.1');
    };
    checkPort(startPort);
  });
}

// 检查代理环境变量，代理会导致本地连接失败
const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
const activeProxies = proxyVars.filter(v => process.env[v]?.trim());
if (activeProxies.length > 0) {
  console.warn('⚠ 检测到代理环境变量，可能影响本地服务连接:');
  for (const v of activeProxies) {
    console.warn(`  ${v}=${process.env[v]}`);
  }
  console.warn('  将自动设置 no_proxy=127.0.0.1,localhost 绕过代理\n');
}

// 构建代理绕过环境
const noProxyValue = '127.0.0.1,localhost';
process.env.NO_PROXY = process.env.NO_PROXY
  ? `${process.env.NO_PROXY},${noProxyValue}`
  : noProxyValue;
process.env.no_proxy = process.env.no_proxy
  ? `${process.env.no_proxy},${noProxyValue}`
  : noProxyValue;

await ensureDir(logDir);

// 1. 检查是否已经有在运行的后台服务
if (await fileExists(pidPath)) {
  const existingPid = (await fs.readFile(pidPath, 'utf8')).trim();
  if (existingPid && isProcessAlive(existingPid) && processBelongsToProject(existingPid)) {
    // Only reuse a listener owned by this project. Never attach to another Astro repo.
    let existingPort = 0;
    for (let p = 4321; p <= 4330; p++) {
      const listeningPid = getWindowsListeningPid(p);
      if (
        (!listeningPid || Number(existingPid) === listeningPid) &&
        await waitForUrl(`http://127.0.0.1:${p}/keystatic`, { attempts: 1, delayMs: 50 })
      ) {
        existingPort = p;
        break;
      }
    }
    
    if (existingPort > 0) {
      const editorUrl = `http://127.0.0.1:${existingPort}/keystatic`;
      console.log('Keystatic local is already running.');
      console.log(`PID: ${existingPid}`);
      console.log(`Port: ${existingPort}`);
      console.log(`Editor: ${editorUrl}`);
      await openUrl(editorUrl);
      process.exit(0);
    }
  }

  await fs.rm(pidPath, { force: true });
  console.log('Removed stale or foreign .keystatic-local.pid without stopping that process.');
}

const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
await runCommand(pnpmCmd, ['-v']);

// 获取可用的空闲端口
const actualPort = await getFreePort(4321);
const editorUrl = `http://127.0.0.1:${actualPort}/keystatic`;
const viteCachePath = path.join(projectRoot, 'node_modules', '.vite');
const forceAstroDev = process.env.ASTRO_DEV_FORCE === 'true' || process.argv.includes('--force');

const childEnv = {
  ...process.env,
  PUBLIC_KEYSTATIC_PREVIEW_ORIGIN: `http://127.0.0.1:${actualPort}`,
};

// 2. 启动 Astro dev 服务
console.log(`Starting Astro dev server on port ${actualPort} in local mode...`);
if (forceAstroDev) {
  console.log('ASTRO_DEV_FORCE=true or --force detected; clearing Vite cache and forcing dependency optimization.');
  await fs.rm(viteCachePath, { recursive: true, force: true });
}
const logHandle = await fs.open(logPath, 'w');

const astroArgs = ['exec', 'astro', 'dev'];
if (forceAstroDev) astroArgs.push('--force');
astroArgs.push('--host', '127.0.0.1', '--port', String(actualPort));

const isWindows = process.platform === 'win32';
const quoteCmdArg = (value) => `"${String(value).replace(/"/g, '""')}"`;
const child = spawn(
  isWindows ? (process.env.ComSpec || 'cmd.exe') : pnpmCmd,
  isWindows
    ? ['/d', '/s', '/c', ['pnpm.cmd', ...astroArgs.map(quoteCmdArg)].join(' ')]
    : astroArgs,
  {
    cwd: projectRoot,
    env: childEnv,
    shell: false,
    windowsVerbatimArguments: isWindows,
    detached: true,
    stdio: ['ignore', logHandle.fd, logHandle.fd],
  });

child.unref();
await fs.writeFile(pidPath, String(child.pid), 'utf8');
await logHandle.close();
mirrorLogToConsole(logPath);

// 3. 等待服务可用并打开
const started = await waitForUrl(editorUrl, { attempts: 120, delayMs: 1000 });

if (!started) {
  // Best-effort cleanup of a half-started dev server before reporting failure.
  try {
    child.kill();
  } catch {}

  // Surface the actual dev-server output instead of hiding it behind a generic timeout.
  let logTail = '';
  try {
    const logContent = await fs.readFile(logPath, 'utf8');
    const lines = logContent.trimEnd().split(/\r?\n/);
    logTail = lines.slice(-40).join('\n');
  } catch (err) {
    logTail = `(could not read ${logPath}: ${err.message})`;
  }

  console.error(`\n⛔ Keystatic local did not become available at ${editorUrl} after 120s.\n`);
  if (logTail) {
    console.error(`--- tail of ${logPath} ---`);
    console.error(logTail);
    console.error(`-----------------------------`);
  }
  console.error(`\n检查建议:`);
  console.error(`  1. 确认已双击运行“安装环境.cmd”完成依赖安装。若项目是从其他电脑复制的,`);
  console.error(`     请先删除 node_modules、.astro、node_modules/.vite 三个文件夹,再重新运行“安装环境.cmd”。`);
  console.error(`  2. 查看上方日志末尾的实际报错,通常能直接定位原因(依赖缺失/配置报错/端口占用等)。`);
  console.error(`\n`);
  throw new Error(
    `Keystatic local did not become available at ${editorUrl}. See log tail above / ${logPath}`,
  );
}

const listeningPid = getWindowsListeningPid(actualPort);
if (listeningPid && processBelongsToProject(listeningPid)) {
  await fs.writeFile(pidPath, String(listeningPid), 'utf8');
}

const serverPid = listeningPid && processBelongsToProject(listeningPid) ? listeningPid : child.pid;

await openUrl(editorUrl);
console.log('Keystatic local started.');
console.log(`PID: ${serverPid}`);
console.log(`Port: ${actualPort}`);
console.log(`Editor: ${editorUrl}`);
console.log(`Log: ${logPath}`);
console.log('Result: Success');
process.exit(0);
