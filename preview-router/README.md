# Preview Router

One fixed Worker, deployed once, that routes preview hosts to matching
Cloudflare Pages projects.

```text
https://20260703202601.zhidaola.top
-> preview-router
-> https://20260703202601.pages.dev
```

## What this zone is for

`zhidaola.top` is a **staging zone**. Its only job is to let a client look at a
finished site before anyone commits to a production domain.

That has two hard consequences:

1. **Only timestamp preview slugs are served.** A hostname that is not
   `yyyyMMddHHmmss.zhidaola.top` gets a `400`, it does not get guessed at.
   This is not cosmetic. `*.pages.dev` is a single global namespace shared by
   every Cloudflare account, so a router that accepts any label will proxy
   `site.zhidaola.top` to `site.pages.dev` -- somebody else's project -- and
   return it with a `200`.
2. **Production sites never live here.** They go on the client's own domain
   through a Cloudflare Pages Custom Domain, which does not involve this Worker
   at all. `PRODUCTION_ROUTES` exists only as an explicit, normally-empty
   allowlist for the operator's own hostnames.

## The router cannot verify ownership

Because it resolves through the global `*.pages.dev` namespace, this Worker
cannot tell whether a preview project lives in the preview account, in a
client's account, or belongs to a stranger. That check is enforced on the
deploy side instead: `scripts/preview-deploy.mjs` refuses to run unless the
credentials actually own `zhidaola.top`.

## One-time Cloudflare setup

1. `zhidaola.top` is in the account used for previews.
2. A proxied wildcard DNS record exists for `*.zhidaola.top`.
3. Deploy the router **from the base repository**:

   ```bash
   pnpm run preview:router:deploy
   ```

## Do not deploy this from a project clone

Every project carries its own `preview-router/` copy, and those copies drift.
Deploying one of them replaces the shared Worker for the whole zone and can
silently roll the rules above back. This directory in the base repository is
the single source of truth.

## Daily preview deploys

```bash
pnpm run preview:deploy
```

Never create one Worker per preview site.
