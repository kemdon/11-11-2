import type { APIRoute } from 'astro';
import { getLocaleConfig, getProducts } from '../lib/site-content';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const origin = site?.origin || process.env.PUBLIC_SITE_URL?.trim() || 'http://localhost:4321';
  const { defaultLocale, locales } = await getLocaleConfig();
  const products = await getProducts(defaultLocale, defaultLocale);
  const paths = [
    '/',
    '/products',
    ...products.map((product) => `/products/${product.slug}`),
    ...locales
      .filter((locale) => locale.code.toLowerCase() !== defaultLocale.toLowerCase())
      .map((locale) => `/${locale.code}/`),
  ];
  const urls = paths.map((pathname) => `  <url><loc>${new URL(pathname, origin)}</loc></url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
