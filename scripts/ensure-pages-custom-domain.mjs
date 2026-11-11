#!/usr/bin/env node

import { Resolver } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEnv, loadEnvFile, sleep } from './lib/cli-helpers.mjs';

const API_BASE = 'https://api.cloudflare.com/client/v4';

export function normalizeHostname(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('Custom domain is empty.');
  const url = new URL(input.includes('://') ? input : `https://${input}`);
  if (url.pathname !== '/' || url.search || url.hash || url.port) {
    throw new Error(`Custom domain must be a hostname without a path, query, port, or hash: ${input}`);
  }
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

export function inferZoneName(hostname) {
  const parts = normalizeHostname(hostname).split('.');
  if (parts.length < 2) throw new Error(`Cannot infer DNS zone from hostname: ${hostname}`);
  return parts.slice(-2).join('.');
}

export function shouldProxyPagesCname(pagesAccountId, zoneAccountId) {
  return Boolean(pagesAccountId && zoneAccountId && pagesAccountId === zoneAccountId);
}

function envFlag(name, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`${name} must be true or false.`);
}

function normalizeDnsTarget(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

async function cfRequest(method, pathname, body) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${pathname}`, {
        method,
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        const messages = (payload.errors || []).map((error) => `${error.code}: ${error.message}`).join('; ');
        const error = new Error(`Cloudflare API ${method} ${pathname} failed (${response.status}): ${messages || response.statusText}`);
        error.status = response.status;
        throw error;
      }
      return payload.result;
    } catch (error) {
      lastError = error;
      const retryable = !error.status || error.status === 429 || error.status >= 500;
      if (!retryable || attempt === 4) throw error;
      console.log(`Cloudflare API request retry ${attempt}/3 after transient failure.`);
      await sleep(attempt * 1500);
    }
  }
  throw lastError;
}

async function ensurePagesBinding(accountId, projectName, hostname) {
  const domainPath = `/accounts/${accountId}/pages/projects/${projectName}/domains/${encodeURIComponent(hostname)}`;
  try {
    return await cfRequest('GET', domainPath);
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  console.log(`Adding Pages custom domain: ${hostname}`);
  await cfRequest('POST', `/accounts/${accountId}/pages/projects/${projectName}/domains`, { name: hostname });
  return cfRequest('GET', domainPath);
}

async function findZone(zoneName) {
  const zones = await cfRequest('GET', `/zones?name=${encodeURIComponent(zoneName)}`);
  const exact = zones.find((zone) => zone.name.toLowerCase() === zoneName.toLowerCase());
  if (!exact) return null;
  if (exact.status !== 'active') return null;
  return exact;
}

async function getPublicCnames(hostname) {
  const resolver = createPublicResolver();
  return resolver.resolveCname(hostname).catch(() => []);
}

async function resolvePagesTarget(accountId, projectName) {
  // The project name is not always a valid *.pages.dev hostname: if the name is
  // already taken globally, Cloudflare assigns a suffixed subdomain (project.subdomain).
  // DNS must point at the real subdomain, never `${projectName}.pages.dev`.
  const project = await cfRequest('GET', `/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}`);
  const subdomain = typeof project?.subdomain === 'string' && project.subdomain.trim()
    ? project.subdomain.trim()
    : `${projectName}.pages.dev`;
  if (!subdomain.endsWith('.pages.dev')) {
    throw new Error(`Pages project subdomain looks invalid: ${subdomain}`);
  }
  return subdomain;
}

async function ensureExternalDns({ accountId, projectName, hostname, manageDns }) {
  if (manageDns) {
    throw new Error('CLOUDFLARE_PAGES_MANAGE_DNS must be false when CLOUDFLARE_PAGES_DNS_MODE=external.');
  }
  const target = await resolvePagesTarget(accountId, projectName);
  const cnames = await getPublicCnames(hostname);
  if (!cnames.some((value) => normalizeDnsTarget(value) === normalizeDnsTarget(target))) {
    throw new Error(`External DNS must create CNAME ${hostname} -> ${target}, then rerun deployment.`);
  }
  console.log(`External DNS CNAME is valid: ${hostname} -> ${target}`);
  return { target, desiredProxied: false, dnsMode: 'external' };
}

async function ensureDnsRouting({ accountId, projectName, hostname, zoneName, manageDns, dnsMode }) {
  if (dnsMode === 'external') {
    return ensureExternalDns({ accountId, projectName, hostname, manageDns });
  }

  const zone = await findZone(zoneName);
  if (!zone) {
    if (dnsMode === 'cloudflare') {
      throw new Error(`Cloudflare DNS zone is not active or visible to this token: ${zoneName}`);
    }
    console.log(`No active Cloudflare zone is visible for ${zoneName}; using external DNS mode.`);
    return ensureExternalDns({ accountId, projectName, hostname, manageDns });
  }

  const target = await resolvePagesTarget(accountId, projectName);
  const desiredProxied = shouldProxyPagesCname(accountId, zone.account?.id);
  const recordsPath = `/zones/${zone.id}/dns_records`;
  const records = await cfRequest('GET', `${recordsPath}?name=${encodeURIComponent(hostname)}`);

  if (records.length > 1) {
    throw new Error(`DNS conflict: multiple records already exist for ${hostname}.`);
  }

  const record = records[0];
  if (record && record.type !== 'CNAME') {
    throw new Error(`DNS conflict: ${hostname} already has a ${record.type} record.`);
  }
  if (record && normalizeDnsTarget(record.content) !== normalizeDnsTarget(target)) {
    throw new Error(`DNS conflict: ${hostname} points to ${record.content}, expected ${target}.`);
  }

  console.log(`Pages/DNS same account: ${zone.account?.id === accountId}`);
  console.log(`Required DNS: CNAME ${hostname} -> ${target}, proxied=${desiredProxied}`);

  if (!record) {
    if (!manageDns) {
      throw new Error(`DNS record is missing. Set CLOUDFLARE_PAGES_MANAGE_DNS=true or create CNAME ${hostname} -> ${target}.`);
    }
    await cfRequest('POST', recordsPath, {
      type: 'CNAME',
      name: hostname,
      content: target,
      proxied: desiredProxied,
      ttl: 1,
      comment: `Cloudflare Pages custom domain for ${projectName}`,
    });
    console.log(`Created DNS CNAME: ${hostname} -> ${target}`);
  } else if (Boolean(record.proxied) !== desiredProxied) {
    if (!manageDns) {
      throw new Error(`DNS proxy mode is incorrect for ${hostname}. Expected proxied=${desiredProxied}.`);
    }
    await cfRequest('PATCH', `${recordsPath}/${record.id}`, { proxied: desiredProxied });
    console.log(`Updated DNS proxy mode: proxied=${desiredProxied}`);
  } else {
    console.log('DNS CNAME already valid.');
  }

  return { target, desiredProxied, dnsMode: 'cloudflare' };
}

function createPublicResolver() {
  const resolver = new Resolver();
  const servers = (process.env.CLOUDFLARE_PUBLIC_DNS_SERVERS || '1.1.1.1,8.8.8.8,223.5.5.5')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  resolver.setServers(servers);
  return resolver;
}

async function requestViaPublicDns(protocol, hostname) {
  const resolver = createPublicResolver();
  const addresses = await resolver.resolve4(hostname);
  if (!addresses.length) throw new Error(`Public DNS returned no A records for ${hostname}.`);
  const transport = protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.get({
      protocol,
      hostname,
      path: '/',
      headers: { Accept: 'text/html' },
      timeout: 20_000,
      lookup: (_name, options, callback) => {
        if (options?.all) {
          callback(null, [{ address: addresses[0], family: 4 }]);
          return;
        }
        callback(null, addresses[0], 4);
      },
    }, (response) => {
      response.resume();
      resolve(response.statusCode || 0);
    });
    request.on('timeout', () => request.destroy(new Error(`${protocol}//${hostname}/ timed out.`)));
    request.on('error', reject);
  });
}

async function verifyPublicDelivery(hostname, target, desiredProxied) {
  const resolver = createPublicResolver();
  if (!desiredProxied) {
    const cnames = await resolver.resolveCname(hostname);
    if (!cnames.some((value) => normalizeDnsTarget(value) === normalizeDnsTarget(target))) {
      throw new Error(`Public CNAME for ${hostname} does not point to ${target}.`);
    }
  }

  const httpStatus = await requestViaPublicDns('http:', hostname);
  const httpsStatus = await requestViaPublicDns('https:', hostname);
  if (httpStatus < 200 || httpStatus >= 400) throw new Error(`Public HTTP check failed: ${httpStatus}`);
  if (httpsStatus < 200 || httpsStatus >= 400) throw new Error(`Public HTTPS check failed: ${httpsStatus}`);
  console.log(`Public HTTP status: ${httpStatus}`);
  console.log(`Public HTTPS status: ${httpsStatus}`);
}

async function waitForActiveDomain({ accountId, projectName, hostname, target, desiredProxied }) {
  const attempts = Number.parseInt(process.env.CLOUDFLARE_PAGES_DOMAIN_POLL_ATTEMPTS || '12', 10);
  const delaySeconds = Number.parseInt(process.env.CLOUDFLARE_PAGES_DOMAIN_POLL_SECONDS || '5', 10);
  const domainPath = `/accounts/${accountId}/pages/projects/${projectName}/domains/${encodeURIComponent(hostname)}`;
  let lastDomain;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastDomain = await cfRequest('GET', domainPath);
    const validation = lastDomain.validation_data || {};
    const verification = lastDomain.verification_data || {};
    console.log(
      `Custom domain attempt ${attempt}: status=${lastDomain.status} ` +
      `validation=${validation.status || 'unknown'} verification=${verification.status || 'unknown'}`,
    );
    if (validation.error_message) console.log(`Validation detail: ${validation.error_message}`);
    if (verification.error_message) console.log(`Verification detail: ${verification.error_message}`);

    if (['blocked', 'deactivated', 'error'].includes(lastDomain.status)) {
      throw new Error(`Pages custom domain failed: ${lastDomain.status}`);
    }
    if (lastDomain.status === 'active') {
      await verifyPublicDelivery(hostname, target, desiredProxied);
      return lastDomain;
    }
    if (attempt < attempts) await sleep(delaySeconds * 1000);
  }

  throw new Error(`Pages custom domain did not become active: ${hostname} (${lastDomain?.status || 'unknown'})`);
}

export async function main() {
  await loadEnvFile();
  const accountId = assertEnv('CLOUDFLARE_ACCOUNT_ID');
  assertEnv('CLOUDFLARE_API_TOKEN');
  const projectName = assertEnv('CLOUDFLARE_PAGES_PROJECT_NAME');
  const hostname = normalizeHostname(assertEnv('CLOUDFLARE_PAGES_CUSTOM_DOMAIN'));
  const zoneName = normalizeHostname(process.env.CLOUDFLARE_PAGES_DNS_ZONE_NAME || inferZoneName(hostname));
  const manageDns = envFlag('CLOUDFLARE_PAGES_MANAGE_DNS', false);
  const dnsMode = (process.env.CLOUDFLARE_PAGES_DNS_MODE || 'auto').trim().toLowerCase();
  if (!['auto', 'cloudflare', 'external'].includes(dnsMode)) {
    throw new Error('CLOUDFLARE_PAGES_DNS_MODE must be auto, cloudflare, or external.');
  }

  await ensurePagesBinding(accountId, projectName, hostname);
  const dns = await ensureDnsRouting({ accountId, projectName, hostname, zoneName, manageDns, dnsMode });
  console.log(`DNS delivery mode: ${dns.dnsMode}`);
  await waitForActiveDomain({ accountId, projectName, hostname, ...dns });
  console.log(`Pages custom domain is active: https://${hostname}/`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
