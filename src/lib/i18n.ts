export interface SupportedLocale {
  code: string;
  label?: string;
}

const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);

export function normalizeLocale(locale: string | undefined | null) {
  return String(locale || '').toLowerCase();
}

export function localeMatches(left: string | undefined | null, right: string | undefined | null) {
  return normalizeLocale(left) === normalizeLocale(right);
}

export function getLocaleFromPath(pathname: string, supportedLocales: SupportedLocale[] = []) {
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  if (!firstSegment) return '';

  const knownLocales = supportedLocales.map((item) => normalizeLocale(item.code));
  if (knownLocales.includes(normalizeLocale(firstSegment))) return firstSegment;

  return firstSegment.includes('-') || firstSegment.length === 2 ? firstSegment : '';
}

export function getCurrentLocale(
  Astro: { params: Record<string, string | undefined>; url: URL },
  defaultLocale: string,
  supportedLocales: SupportedLocale[] = [],
) {
  return Astro.params.locale || getLocaleFromPath(Astro.url.pathname, supportedLocales) || defaultLocale;
}

export function getTextDirection(locale: string) {
  const language = normalizeLocale(locale).split('-')[0];
  return RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr';
}

function isExternalHref(href: string) {
  return /^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#');
}

export function stripLocaleFromPath(pathname: string, supportedLocales: SupportedLocale[] = []) {
  const segments = pathname.split('/').filter(Boolean);
  if (!segments.length) return '/';

  const knownLocales = supportedLocales.map((item) => normalizeLocale(item.code));
  if (knownLocales.includes(normalizeLocale(segments[0]))) {
    return `/${segments.slice(1).join('/')}` || '/';
  }

  return pathname || '/';
}

export function localizeHref(
  locale: string,
  href: string,
  defaultLocale?: string,
  supportedLocales: SupportedLocale[] = [],
) {
  if (!href || isExternalHref(href)) return href;

  const normalizedPath = href.startsWith('/') ? href : `/${href}`;
  const basePath = stripLocaleFromPath(normalizedPath, supportedLocales);
  if (defaultLocale && localeMatches(locale, defaultLocale)) return basePath;

  return basePath === '/' ? `/${locale}` : `/${locale}${basePath}`;
}
