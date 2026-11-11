#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const cwd = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const configPath = path.join(cwd, 'keystatic.config.ts');
const astroConfigPath = path.join(cwd, 'astro.config.mjs');
const packageJsonPath = path.join(cwd, 'package.json');

const result = {
  ok: true,
  cwd,
  checks: {},
  recommendations: [],
};

if (!fs.existsSync(configPath)) {
  result.ok = false;
  result.recommendations.push('Missing keystatic.config.ts.');
} else {
  const keystaticConfig = fs.readFileSync(configPath, 'utf8');
  result.checks.previewUrlConfigured = /previewUrl\s*:/.test(keystaticConfig);
  result.checks.usesBrowserUnsafeProcessEnv = /process\s*\.\s*env(?:\s*\?\.|\s*\.|\s*\[)/.test(keystaticConfig);
  result.checks.usesImportMetaEnv = /import\s*\.\s*meta\s*\.\s*env(?:\s*\?\.|\s*\.|\s*\[)/.test(keystaticConfig);
  result.checks.usesPublicPreviewOrigin = /PUBLIC_KEYSTATIC_PREVIEW_ORIGIN/.test(keystaticConfig);
  result.checks.hasAbsolutePreviewFallback = /https?:\\?\/\\?\/127\.0\.0\.1:\d+/.test(keystaticConfig);

  if (!result.checks.previewUrlConfigured) {
    result.ok = false;
    result.recommendations.push('Add previewUrl entries for editable singletons and collections.');
  }

  if (result.checks.usesBrowserUnsafeProcessEnv) {
    result.ok = false;
    result.recommendations.push('Replace process.env access in keystatic config with import.meta.env to avoid blank admin screens.');
  }

  if (!result.checks.usesImportMetaEnv || !result.checks.usesPublicPreviewOrigin || !result.checks.hasAbsolutePreviewFallback) {
    result.ok = false;
    result.recommendations.push('Configure Preview with import.meta.env.PUBLIC_KEYSTATIC_PREVIEW_ORIGIN and an explicit local fallback origin.');
  }
}

if (!fs.existsSync(astroConfigPath)) {
  result.ok = false;
  result.recommendations.push('Missing astro.config.mjs.');
} else {
  const astroConfig = fs.readFileSync(astroConfigPath, 'utf8');
  result.checks.serverAdapterConfigured =
    /@astrojs\/node/.test(astroConfig) ||
    /@astrojs\/cloudflare/.test(astroConfig) ||
    /adapter:\s*\w+\(/.test(astroConfig);
  result.checks.outputModeConfigured = /output:\s*['"](?:server|static)['"]/.test(astroConfig);
  result.checks.keystaticCanBeSkipped = /SKIP_KEYSTATIC/.test(astroConfig);
  result.checks.keystaticDynamicImportWhenEnabled =
    /await\s+import\(['"]@keystatic\/astro['"]\)/.test(astroConfig) ||
    !/@keystatic\/astro/.test(astroConfig);

  result.checks.staticOutputConfigured = /output:\s*['"]static['"]/.test(astroConfig);

  if (!result.checks.outputModeConfigured || (!result.checks.staticOutputConfigured && !result.checks.serverAdapterConfigured)) {
    result.ok = false;
    result.recommendations.push('Use an explicit Astro output mode and adapter so production runtime matches the intended delivery model.');
  }

  if (!result.checks.keystaticCanBeSkipped) {
    result.ok = false;
    result.recommendations.push('Gate Keystatic with SKIP_KEYSTATIC so production builds can skip the local-only admin.');
  }

  if (!result.checks.keystaticDynamicImportWhenEnabled) {
    result.ok = false;
    result.recommendations.push('Use a dynamic @keystatic/astro import only when Keystatic is enabled, so skipped production builds do not evaluate the integration.');
  }
}

if (!fs.existsSync(packageJsonPath)) {
  result.ok = false;
  result.recommendations.push('Missing package.json.');
} else {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  result.checks.hasBuildScript = Boolean(packageJson.scripts?.build);
  result.checks.hasStartScript = typeof packageJson.scripts?.start === 'string';

  if (!result.checks.hasBuildScript || !result.checks.hasStartScript) {
    result.ok = false;
    result.recommendations.push('Keep build and start scripts aligned with Astro server output.');
  }
}

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
