import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const sitemap = site ? `\nSitemap: ${new URL('/sitemap.xml', site)}` : '';
  return new Response(`User-agent: *\nAllow: /\nDisallow: /keystatic\nDisallow: /api/keystatic/${sitemap}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
