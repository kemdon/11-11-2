import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import markdoc from '@astrojs/markdoc';
import { parse as parseYaml } from 'yaml';

function readLocalEnv() {
  const env = { ...process.env };
  let source = '';
  try {
    source = readFileSync(new URL('./.env', import.meta.url), 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (key in env) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const configEnv = readLocalEnv();
const customDomain = configEnv.CLOUDFLARE_PAGES_CUSTOM_DOMAIN?.trim();
const siteOrigin = configEnv.PUBLIC_SITE_URL?.trim() || (customDomain ? `https://${customDomain}` : undefined);

// Deployment shape of the site. The project is a static Pages site by default;
// the Resend contact Function is an opt-in extra, because a Function has to be
// re-provisioned (code + secrets) in every Cloudflare account the site is
// deployed to, while a purely static deployment is nothing but `dist/`.
//
//   static   (default) -- ship dist/ only; no Functions in the deployment
//   function           -- ship dist/ plus functions/, sync the Resend secrets
const declaredContactFormMode = (configEnv.CONTACT_FORM_MODE || '').trim().toLowerCase();
const inferredContactFormMode = existsSync(new URL('./functions/api/contact.js', import.meta.url))
  ? 'function'
  : 'static';
const CONTACT_FORM_MODE = declaredContactFormMode || inferredContactFormMode;
if (!['static', 'function'].includes(CONTACT_FORM_MODE)) {
  throw new Error(`CONTACT_FORM_MODE must be "static" or "function", got "${CONTACT_FORM_MODE}".`);
}
if (!declaredContactFormMode) {
  console.warn(
    `CONTACT_FORM_MODE is not set; inferred "${CONTACT_FORM_MODE}". Set it explicitly in .env so the deployment shape is declared rather than guessed.`,
  );
}
const contactFunctionEnabled = CONTACT_FORM_MODE === 'function';

function localContactFunction({ onRequest, onRequestPost }) {
  const localEnv = readLocalEnv();

  return {
    name: 'local-pages-contact-function',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url || '/', 'http://localhost').pathname;
        if (pathname !== '/api/contact') return next();

        try {
          let response;
          if (req.method === 'POST') {
            const chunks = [];
            for await (const chunk of req) chunks.push(Buffer.from(chunk));
            const body = Buffer.concat(chunks);
            const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
              method: 'POST',
              headers: {
                'content-type': req.headers['content-type'] || 'application/json',
                'content-length': req.headers['content-length'] || String(body.length),
              },
              body,
            });
            response = await onRequestPost({ request, env: localEnv });
          } else {
            response = onRequest();
          }

          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          console.error('Local contact function failed:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: 'Unable to send your inquiry right now.' }));
        }
      });
    },
  };
}

const enableKeystatic = process.env.SKIP_KEYSTATIC !== 'true';
const siteSettings = parseYaml(readFileSync(new URL('./src/content/siteSettings/settings.yaml', import.meta.url), 'utf8'));
const defaultLocale = siteSettings.defaultLocale || 'en';
const locales = (siteSettings.supportedLocales || []).map((locale) => locale.code).filter(Boolean);
const integrations = [react(), markdoc()];

if (enableKeystatic) {
  const { default: keystatic } = await import('@keystatic/astro');
  integrations.push(keystatic());
}

// The contact Function is only imported when it is actually being used, so that
// a static project can drop functions/ without taking the whole build down.
const vitePlugins = [];
if (contactFunctionEnabled) {
  const contactHandlers = await import('./functions/api/contact.js');
  vitePlugins.push(localContactFunction(contactHandlers));
}

// https://astro.build/config
export default defineConfig({
  site: siteOrigin,
  output: 'static',
  vite: {
    cacheDir: '.vite-cache',
    plugins: vitePlugins,
    optimizeDeps: {
      exclude: [
        'virtual:keystatic-config',
        '@keystatic/astro',
        '@keystatic/astro/internal/keystatic-api',
      ],
    },
  },
  session: {
    driver: 'null',
  },
  i18n: {
    defaultLocale,
    locales: locales.length > 0 ? locales : [defaultLocale],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  integrations,
});
