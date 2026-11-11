// Shared preview router for the *.zhidaola.top staging zone.
//
// This zone exists so a client can look at a site before anyone commits to a
// production domain. It is a staging zone, not a production zone, so the router
// only ever serves timestamp preview slugs. Anything else gets a loud 400.
//
// Why that matters: *.pages.dev is one global namespace shared by every
// Cloudflare account. A router that accepts an arbitrary label will happily
// proxy `site.zhidaola.top` to `site.pages.dev` -- somebody else's project --
// and return it with a 200. Restricting the label to `^\d{14}$` turns that whole
// class of misconfiguration into an immediate, obvious error.
//
// The same namespace blindness is why this Worker cannot verify who owns a
// preview project. Keeping previews inside the preview account is enforced on
// the deploy side (scripts/preview-deploy.mjs), not here.

const PREVIEW_DOMAIN = 'zhidaola.top';
const PREVIEW_SLUG_PATTERN = /^\d{14}$/u;

// Explicit allowlist for the operator's OWN hostnames, in case one is ever
// pinned to this staging zone. Empty by default. Never list a client site
// here -- production belongs on the client's own domain via a Pages Custom
// Domain, which does not involve this Worker at all.
function parseProductionRoutes(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getPreviewSlug(hostname) {
  const suffix = `.${PREVIEW_DOMAIN}`;
  if (!hostname.endsWith(suffix)) {
    return '';
  }

  const slug = hostname.slice(0, -suffix.length);
  return PREVIEW_SLUG_PATTERN.test(slug) ? slug : '';
}

function invalidPreviewHost(hostname) {
  return new Response(
    [
      `Invalid preview host: ${hostname}`,
      '',
      `This zone only serves timestamp preview slugs of the form`,
      `  yyyyMMddHHmmss.${PREVIEW_DOMAIN}`,
      '',
      `Production sites do not belong on ${PREVIEW_DOMAIN}. Deploy them on their`,
      'own domain through a Cloudflare Pages Custom Domain instead.',
      '',
    ].join('\n'),
    { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
}

export default {
  async fetch(request, env) {
    const incomingUrl = new URL(request.url);
    const hostname = incomingUrl.hostname.toLowerCase();
    const productionRoutes = parseProductionRoutes(env?.PRODUCTION_ROUTES);
    const productionTarget = productionRoutes[hostname];

    let targetHostname;
    let diagnosticHeader;
    let diagnosticValue;

    if (productionTarget && /^[a-z0-9][a-z0-9.-]*\.pages\.dev$/iu.test(String(productionTarget))) {
      targetHostname = String(productionTarget).toLowerCase();
      diagnosticHeader = 'x-pages-project';
      diagnosticValue = targetHostname.replace(/\.pages\.dev$/u, '');
    } else {
      const slug = getPreviewSlug(hostname);
      if (!slug) {
        return invalidPreviewHost(hostname);
      }
      targetHostname = `${slug}.pages.dev`;
      diagnosticHeader = 'x-preview-slug';
      diagnosticValue = slug;
    }

    const targetUrl = new URL(request.url);
    targetUrl.hostname = targetHostname;

    const headers = new Headers(request.headers);
    headers.delete('host');

    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      init.duplex = 'half';
    }

    const response = await fetch(targetUrl.toString(), init);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set(diagnosticHeader, diagnosticValue);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
