// @ts-ignore
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { text, textSafe } from './lib/content-schema';

const homePage = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/content/homePage' }),
  schema: textSafe(z.object({
    heroLabel: z.string().optional(),
    heroTitle: z.string().optional(),
    heroBody: z.string().optional(),
    heroImage: z.string().optional(),
    heroPrimaryLabel: z.string().optional(),
    heroPrimaryHref: z.string().optional(),
    heroSecondaryLabel: z.string().optional(),
    heroSecondaryHref: z.string().optional(),
    heroTertiaryLabel: z.string().optional(),
    heroTertiaryHref: z.string().optional(),
    heroQuaternaryLabel: z.string().optional(),
    heroQuaternaryHref: z.string().optional(),
    introTitle: z.string().optional(),
    introBody: z.string().optional(),
    highlights: z.array(
      z.object({
        title: z.string().optional(),
        body: z.string().optional(),
        image: z.string().optional(),
      }),
    ).default([]),
    storyImages: z.array(
      z.object({
        image: z.string().optional(),
        alt: z.string().optional(),
      }),
    ).default([]),
    logoCloudLabel: z.string().optional(),
    logoCloudTitle: z.string().optional(),
    logos: z.array(
      z.object({
        name: z.string().optional(),
        image: z.string().optional(),
      }),
    ).default([]),
    statsLabel: z.string().optional(),
    statsTitle: z.string().optional(),
    stats: z.array(
      z.object({
        value: z.string().optional(),
        label: z.string().optional(),
        detail: z.string().optional(),
      }),
    ).default([]),
    showcaseLabel: z.string().optional(),
    showcaseTitle: z.string().optional(),
    showcaseBody: z.string().optional(),
    showcases: z.array(
      z.object({
        tag: z.string().optional(),
        title: z.string().optional(),
        body: z.string().optional(),
        image: z.string().optional(),
      }),
    ).default([]),
    giftBoxLabel: z.string().optional(),
    giftBoxTitle: z.string().optional(),
    giftBoxDescription: z.string().optional(),
    giftBoxContents: z.array(z.string()).default([]),
    giftBoxScenes: z.string().optional(),
    giftBoxImage: z.string().optional(),
    aboutLabel: z.string().optional(),
    aboutTitle: z.string().optional(),
    aboutBody: z.string().optional(),
    aboutContactEmail: z.string().optional(),
    aboutContactRedNote: z.string().optional(),
    ctaLabel: z.string().optional(),
    ctaTitle: z.string().optional(),
    ctaBody: z.string().optional(),
    ctaPrimaryLabel: z.string().optional(),
    ctaPrimaryHref: z.string().optional(),
    ctaSecondaryLabel: z.string().optional(),
    ctaSecondaryHref: z.string().optional(),
    ctaTertiaryLabel: z.string().optional(),
    ctaTertiaryHref: z.string().optional(),
    ctaQuaternaryLabel: z.string().optional(),
    ctaQuaternaryHref: z.string().optional(),
    productsLabel: z.string().optional(),
    productsTitle: z.string().optional(),
    brandTimelineTitle: z.string().optional(),
    // Added fields
    brandTimeline: z.array(
      z.object({
        date: text(),
        title: text(),
        description: text(),
      })
    ).default([]),
    brandStatsLabel: z.string().optional(),
    brandStatsTitle: z.string().optional(),
    brandStatsItems: z.array(
      z.object({
        label: text(),
        value: text(),
        detail: text(),
      })
    ).default([]),
    livingPicksLabel: z.string().optional(),
    livingPicksTitle: z.string().optional(),
    livingPicksBody: z.string().optional(),
    livingPicksCategories: z.array(
      z.object({
        id: text(),
        name: text(),
        englishName: z.string().optional(),
        description: z.string().optional(),
        mainImage: z.string().optional(),
        products: z.array(
          z.object({
            name: text(),
            description: z.string().optional(),
            image: z.string().optional(),
          })
        ).default([]),
      })
    ).default([]),
    comingSoonLabel: z.string().optional(),
    comingSoonTitle: z.string().optional(),
    comingSoonBody: z.string().optional(),
    comingSoonConcepts: z.array(
      z.object({
        title: text(),
        englishTitle: z.string().optional(),
        description: z.string().optional(),
        image: z.string().optional(),
        tag: z.string().optional(),
      })
    ).default([]),
  })),
});

const siteSettings = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/content/siteSettings' }),
  schema: textSafe(z.object({
    brandName: z.string().optional(),
    defaultMetaDescription: z.string().optional(),
    logoPath: z.string().optional(),
    defaultOgImage: z.string().optional(),
    defaultLocale: z.string().default('en'),
    localeCookieName: z.string().default('site_locale'),
    localeSwitcherLabel: z.string().optional(),
    mobileMenuLabel: z.string().default('Toggle navigation menu'),
    supportedLocales: z.array(
      z.object({
        code: text(),
        label: z.string().optional(),
      }),
    ).default([
      { code: 'en', label: 'English' },
      { code: 'zh-CN', label: '简体中文' },
    ]),
    categoryTranslations: z.array(
      z.object({
        id: text(),
        label: z.string().optional(),
      }),
    ).default([]),
    heroScrollText: z.string().optional(),
    navigation: z.array(
      z.object({
        label: z.string().optional(),
        href: z.string().optional(),
        isPrimary: z.boolean().optional(),
      }),
    ).default([]),
    footerBody: z.string().optional(),
    footerLinks: z.array(
      z.object({
        label: z.string().optional(),
        href: z.string().optional(),
      }),
    ).default([]),
    footerContactLabel: z.string().optional(),
    footerContactValue: z.string().optional(),
    contactPhonePrimary: z.string().optional(),
    contactPhonePrimaryHref: z.string().optional(),
    contactPhoneSecondary: z.string().optional(),
    contactPhoneSecondaryHref: z.string().optional(),
    footerAddress: z.string().optional(),
    footerQuickLinksLabel: z.string().optional(),
    footerContactColumnTitle: z.string().optional(),
    footerPhone: z.string().optional(),
    footerEmail: z.string().optional(),
    footerMotto: z.string().optional(),
    copyrightLine: z.string().optional(),
  })),
});

const products = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/content/products' }),
  schema: textSafe(z.object({
    title: text(),
    brand: z.string().optional(),
    partNumber: z.string().optional(),
    englishName: z.string().optional(),
    oneLiner: z.string().optional(),
    ingredients: z.string().optional(),
    usage: z.string().optional(),
    keywords: z.array(z.string()).default([]),
    mainImage: z.string().optional(),
    stockStatus: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
  })),
});

const productsPage = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/content/productsPage' }),
  schema: textSafe(z.object({
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    kicker: z.string().optional(),
    title: text(),
    body: z.string().optional(),
    emptyNote: z.string().optional(),
  })),
});

const notFoundPage = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/content/notFoundPage' }),
  schema: textSafe(z.object({
    seoTitle: text(),
    code: text(),
    message: text(),
    detail: text(),
    homeLabel: text(),
    homeHref: text(),
  })),
});

export const collections = {
  homePage,
  siteSettings,
  products,
  productsPage,
  notFoundPage,
};
