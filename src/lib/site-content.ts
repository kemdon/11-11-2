import { getEntry } from 'astro:content';
import { parse as parseYaml } from 'yaml';
import {
  localizeHref,
  localeMatches,
  normalizeLocale,
  stripLocaleFromPath,
  type SupportedLocale,
} from './i18n';

export type { SupportedLocale } from './i18n';

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined || override === null) {
    return base;
  }
  if (Array.isArray(base) || Array.isArray(override)) {
    return (override as T) ?? base;
  }
  if (isObject(base) && isObject(override)) {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
      merged[key] = key in merged ? deepMerge(merged[key], value) : value;
    }
    return merged as T;
  }
  return override as T;
}

export interface NavItem {
  label?: string;
  href?: string;
  isPrimary?: boolean;
}

export interface SiteSettings {
  brandName?: string;
  defaultMetaDescription?: string;
  logoPath?: string;
  defaultOgImage?: string;
  defaultLocale: string;
  localeCookieName?: string;
  localeSwitcherLabel?: string;
  mobileMenuLabel: string;
  supportedLocales: SupportedLocale[];
  categoryTranslations: Array<{ id: string; label?: string }>;
  heroScrollText?: string;
  navigation: NavItem[];
  footerBody?: string;
  footerLinks: Array<{ label?: string; href?: string }>;
  footerContactLabel?: string;
  footerContactValue?: string;
  contactPhonePrimary?: string;
  contactPhonePrimaryHref?: string;
  contactPhoneSecondary?: string;
  contactPhoneSecondaryHref?: string;
  footerAddress?: string;
  footerQuickLinksLabel?: string;
  footerContactColumnTitle?: string;
  footerPhone?: string;
  footerEmail?: string;
  footerMotto?: string;
  copyrightLine?: string;
}

export interface HomePageContent {
  heroLabel?: string;
  heroTitle?: string;
  heroBody?: string;
  heroImage?: string;
  heroPrimaryLabel?: string;
  heroPrimaryHref?: string;
  heroSecondaryLabel?: string;
  heroSecondaryHref?: string;
  heroTertiaryLabel?: string;
  heroTertiaryHref?: string;
  heroQuaternaryLabel?: string;
  heroQuaternaryHref?: string;
  introTitle?: string;
  introBody?: string;
  highlights: Array<{ title?: string; body?: string; image?: string }>;
  storyImages: Array<{ image?: string; alt?: string }>;
  logoCloudLabel?: string;
  logoCloudTitle?: string;
  logos: Array<{ name?: string; image?: string }>;
  statsLabel?: string;
  statsTitle?: string;
  stats: Array<{ value?: string; label?: string; detail?: string }>;
  showcaseLabel?: string;
  showcaseTitle?: string;
  showcaseBody?: string;
  showcases: Array<{ tag?: string; title?: string; body?: string; image?: string }>;
  giftBoxLabel?: string;
  giftBoxTitle?: string;
  giftBoxDescription?: string;
  giftBoxContents: string[];
  giftBoxScenes?: string;
  giftBoxImage?: string;
  aboutLabel?: string;
  aboutTitle?: string;
  aboutBody?: string;
  aboutContactEmail?: string;
  aboutContactRedNote?: string;
  ctaLabel?: string;
  ctaTitle?: string;
  ctaBody?: string;
  ctaPrimaryLabel?: string;
  ctaPrimaryHref?: string;
  ctaSecondaryLabel?: string;
  ctaSecondaryHref?: string;
  ctaTertiaryLabel?: string;
  ctaTertiaryHref?: string;
  ctaQuaternaryLabel?: string;
  ctaQuaternaryHref?: string;
  productsLabel?: string;
  productsTitle?: string;
  brandTimelineTitle?: string;
  brandTimeline?: Array<{
    date: string;
    title: string;
    description: string;
  }>;
  brandStatsLabel?: string;
  brandStatsTitle?: string;
  brandStatsItems?: Array<{
    label: string;
    value: string;
    detail: string;
  }>;
  livingPicksLabel?: string;
  livingPicksTitle?: string;
  livingPicksBody?: string;
  livingPicksCategories?: Array<{
    id: string;
    name: string;
    englishName?: string;
    description?: string;
    mainImage?: string;
    products: Array<{ name: string; description?: string; image?: string }>;
  }>;
  comingSoonLabel?: string;
  comingSoonTitle?: string;
  comingSoonBody?: string;
  comingSoonConcepts?: Array<{
    title: string;
    englishTitle?: string;
    description?: string;
    image?: string;
    tag?: string;
  }>;
}

export interface Product {
  title: string;
  brand?: string;
  partNumber?: string;
  englishName?: string;
  oneLiner?: string;
  ingredients?: string;
  usage?: string;
  keywords?: string[];
  mainImage?: string;
  stockStatus?: string;
  summary?: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
  slug?: string;
}

export interface ProductsPageContent {
  seoTitle?: string;
  seoDescription?: string;
  kicker?: string;
  title: string;
  body?: string;
  emptyNote?: string;
}

const localizedYamlModules = import.meta.glob('../../i18n-output/*/src/content/**/*.yaml', {
  eager: true,
  query: '?raw',
  import: 'default',
});

function parseLocalizedModuleKey(moduleKey: string) {
  const normalized = moduleKey.replace(/\\/g, '/');
  const match = normalized.match(/i18n-output\/([^/]+)\/src\/content\/(.+)$/);
  if (!match) {
    return null;
  }
  return {
    localeDirectory: match[1],
    relativePath: match[2],
  };
}

const localizedYamlMap = new Map(
  Object.entries(localizedYamlModules)
    .map(([moduleKey, raw]) => {
      const parsedKey = parseLocalizedModuleKey(moduleKey);
      if (!parsedKey || typeof raw !== 'string') {
        return null;
      }
      return [`${normalizeLocale(parsedKey.localeDirectory)}:${parsedKey.relativePath}`, raw] as const;
    })
    .filter(Boolean) as Array<readonly [string, string]>,
);

function readLocalizedYaml<T>(locale: string, relativePath: string) {
  const raw = localizedYamlMap.get(`${normalizeLocale(locale)}:${relativePath}`);
  if (!raw) {
    return null;
  }
  return parseYaml(raw) as T;
}

export async function getBaseSiteSettings() {
  const entry = await getEntry('siteSettings', 'settings');
  if (!entry) {
    throw new Error('Missing site settings content entry: settings');
  }
  return entry.data as SiteSettings;
}

import { getCollection } from 'astro:content';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Product images live in public/images/products/ with the product slug as the
// file name. When a product YAML omits `mainImage`, fall back to the slug-named
// image automatically instead of silently rendering a placeholder.
const PRODUCT_IMAGE_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg', '.svg'];
let productImageFileCache: string[] | null = null;

function listProductImageFiles(): string[] {
  if (!productImageFileCache) {
    const imageDir = path.join(process.cwd(), 'public', 'images', 'products');
    productImageFileCache = existsSync(imageDir) ? readdirSync(imageDir) : [];
  }
  return productImageFileCache;
}

function getProductImage(slug: string, explicitImage?: string): string | undefined {
  if (explicitImage) return explicitImage;
  for (const extension of PRODUCT_IMAGE_EXTENSIONS) {
    const fileName = `${slug}${extension}`;
    // Match case-exactly: local Windows filesystems are case-insensitive but
    // Cloudflare and other static hosts serve assets case-sensitively, so a
    // lenient match would pass locally and 404 in production.
    if (listProductImageFiles().includes(fileName)) {
      return `/images/products/${fileName}`;
    }
  }
  return undefined;
}

export async function getProducts(locale: string, defaultLocale: string) {
  const sourceEntries = await getCollection('products');
  
  return Promise.all(sourceEntries.map(async (entry) => {
    const localized = localeMatches(locale, defaultLocale)
      ? entry.data
      : deepMerge(entry.data, readLocalizedYaml<Partial<Product>>(locale, `products/${entry.id}.yaml`) ?? {});
    
    return {
      ...localized,
      mainImage: getProductImage(entry.id, (localized as { mainImage?: string }).mainImage),
      slug: entry.id,
    } as Product;
  }));
}

export async function getProduct(slug: string, locale: string, defaultLocale: string) {
  const sourceEntry = await getEntry('products', slug);
  if (!sourceEntry) {
    return null;
  }

  const localized = localeMatches(locale, defaultLocale)
    ? sourceEntry.data
    : deepMerge(sourceEntry.data, readLocalizedYaml<Partial<Product>>(locale, `products/${slug}.yaml`) ?? {});

  return {
    ...localized,
    mainImage: getProductImage(slug, (localized as { mainImage?: string }).mainImage),
    slug,
  } as Product;
}

export async function getProductsPage(locale: string, defaultLocale: string) {
  const entry = await getEntry('productsPage', 'products');
  if (!entry) {
    throw new Error('Missing products page content entry: products');
  }

  const localized = localeMatches(locale, defaultLocale)
    ? entry.data
    : deepMerge(
        entry.data,
        readLocalizedYaml<Partial<ProductsPageContent>>(locale, 'productsPage/products.yaml') ?? {},
      );

  return localized as ProductsPageContent;
}

export async function getSiteSettings(locale: string) {
  const sourceSettings = await getBaseSiteSettings();
  const localizedSettings = localeMatches(locale, sourceSettings.defaultLocale)
    ? sourceSettings
    : (readLocalizedYaml<Partial<SiteSettings>>(locale, 'siteSettings/settings.yaml') ?? {});

  return deepMerge<SiteSettings>(sourceSettings, {
    ...localizedSettings,
    defaultLocale: sourceSettings.defaultLocale,
    supportedLocales: sourceSettings.supportedLocales ?? [],
  });
}

export async function getLocaleConfig() {
  const site = await getBaseSiteSettings();
  return {
    defaultLocale: site.defaultLocale,
    locales: site.supportedLocales,
  };
}

export async function getHomePage(locale: string, defaultLocale: string) {
  const sourceEntry = await getEntry('homePage', 'home');
  if (!sourceEntry) {
    throw new Error('Missing home page content entry: home');
  }

  const localized = localeMatches(locale, defaultLocale)
    ? sourceEntry.data
    : deepMerge(sourceEntry.data, readLocalizedYaml<Partial<HomePageContent>>(locale, 'homePage/home.yaml') ?? {});

  return {
    ...localized,
    highlights: localized.highlights ?? [],
    storyImages: localized.storyImages ?? [],
    logos: localized.logos ?? [],
    stats: localized.stats ?? [],
    showcases: localized.showcases ?? [],
    giftBoxContents: localized.giftBoxContents ?? [],
    livingPicksCategories: localized.livingPicksCategories ?? [],
    comingSoonConcepts: localized.comingSoonConcepts ?? [],
  } satisfies HomePageContent;
}

export async function getNotFoundPage() {
  const entry = await getEntry('notFoundPage', 'not-found');
  if (!entry) throw new Error('Missing 404 page content entry: not-found');
  return entry.data;
}

export { localizeHref, normalizeLocale, stripLocaleFromPath };
