import { collection, config, fields, singleton } from '@keystatic/core';

const previewOrigin = import.meta.env.PUBLIC_KEYSTATIC_PREVIEW_ORIGIN || 'http://127.0.0.1:4321';
const preview = (path: string) => `${previewOrigin.replace(/\/$/, '')}${path}`;

const mediaImage = (label: string, directory: string, publicPath: string, description?: string) =>
  fields.image({
    label,
    directory,
    publicPath,
    description,
  });

// Image fields must be rooted in the folder the front site actually serves the
// file from. Keystatic rewrites a stored value that lives outside its own
// field's directory on the next save and deletes the file it used to point at,
// so a mismatch between the asset folder and the field configuration silently
// destroys images. scripts/audit-keystatic-image-ownership.mjs flags that.
const siteSettingsImage = (label: string, description?: string) =>
  mediaImage(label, 'public/images/site', '/images/site/', description);

const homeImage = (label: string, description?: string) =>
  mediaImage(label, 'public/images', '/images/', description);

export default config({
  storage: {
    kind: 'local',
  },
  ui: {
    brand: {
      name: '企业官网内容后台',
    },
    navigation: {
      '站点页面': ['siteSettings', 'homePage', 'productsPage'],
      '产品内容': ['products'],
      '系统页面': ['notFoundPage'],
    },
  },
  singletons: {
    siteSettings: singleton({
      label: '站点设置',
      path: 'src/content/siteSettings/settings',
      previewUrl: preview('/'),
      schema: {
        brandName: fields.text({
          label: '品牌名称',
          description: '可留空；显示在浏览器标题、页头和页脚中。',
        }),
        defaultMetaDescription: fields.text({
          label: '默认 Meta 描述',
          multiline: true,
          description: '可留空；作为没有单页覆盖时的站点默认描述。',
        }),
        defaultLocale: fields.text({
          label: '默认语言',
          description: '翻译脚本会把它视为源语言，建议固定为 en 并用英文维护 CMS 原文。',
        }),
        localeCookieName: fields.text({
          label: '语言 Cookie 名称',
          description: '用于记录访客手动切换后的语言，例如 site_locale。',
        }),
        localeSwitcherLabel: fields.text({
          label: '语言切换器标签',
          description: '语言切换组件的辅助说明文本，例如 Language switcher。',
        }),
        mobileMenuLabel: fields.text({
          label: '移动菜单辅助文字',
          description: '移动端菜单按钮的无障碍说明，例如 Toggle navigation menu。',
        }),
        supportedLocales: fields.array(
          fields.object(
            {
              code: fields.text({ label: '语言代码' }),
              label: fields.text({ label: '语言名称' }),
            },
            { layout: [4, 8] },
          ),
          {
            label: '支持的语言',
            description: '翻译脚本会按这里的语言代码生成本地化文件。语言名称应保持各语言自己的原生名称。',
          },
        ),
        logoPath: siteSettingsImage('Logo', '可留空；用于站点图标或品牌图。'),
        defaultOgImage: siteSettingsImage('默认分享/OG图片', '用于站点默认的社交分享缩略图。'),
        categoryTranslations: fields.array(
          fields.object(
            {
              id: fields.text({ label: '分类标识（如 pe-trees）' }),
              label: fields.text({ label: '分类名称' }),
            },
            { layout: [4, 8] },
          ),
          {
            label: '产品分类名称映射',
            description: '用于把分类标识翻译为可读语言。可以在多语言翻译文件中分别做翻译。',
            itemLabel: (props) => `${props.fields.id.value || '未设置'} -> ${props.fields.label.value || '未设置'}`,
          }
        ),
        heroScrollText: fields.text({
          label: 'Hero 滚动提示文字',
          description: '可留空；首页首屏底部的 SCROLL 提示文字。',
        }),
        navigation: fields.array(
          fields.object(
            {
              label: fields.text({ label: '名称' }),
              href: fields.text({ label: '链接' }),
              isPrimary: fields.checkbox({ label: '主按钮样式' }),
            },
            { layout: [5, 5, 2] },
          ),
          {
            label: '顶部导航',
            description: '共享站点壳层导航；不填则前台不显示。',
          },
        ),
        footerBody: fields.text({
          label: '页脚说明',
          multiline: true,
          description: '可留空；用于页脚的基础站点介绍。',
        }),
        footerLinks: fields.array(
          fields.object(
            {
              label: fields.text({ label: '名称' }),
              href: fields.text({ label: '链接' }),
            },
            { layout: [6, 6] },
          ),
          {
            label: '页脚链接',
            description: '页脚二级导航；不填则前台不显示。',
          },
        ),
        footerContactLabel: fields.text({
          label: '页脚联系标签',
          description: '可留空；例如 Email / WhatsApp / Contact。',
        }),
        footerContactValue: fields.text({
          label: '页脚联系内容',
          description: '可留空；例如 hello@example.com。',
        }),
        contactPhonePrimary: fields.text({
          label: '联系电话（主）',
          description: '可留空；例如 +86 18980586886。',
        }),
        contactPhonePrimaryHref: fields.text({
          label: '联系电话链接（主）',
          description: '可留空；例如 https://wa.me/8618980586886。',
        }),
        contactPhoneSecondary: fields.text({
          label: '联系电话（次）',
          description: '可留空。',
        }),
        contactPhoneSecondaryHref: fields.text({
          label: '联系电话链接（次）',
          description: '可留空。',
        }),
        footerAddress: fields.text({
          label: '地址',
          description: '可留空；例如 China Sichuan Province Chengdu。',
        }),
        footerQuickLinksLabel: fields.text({
          label: '页脚「快速链接」栏目标题',
          description: '可留空。',
        }),
        footerContactColumnTitle: fields.text({
          label: '页脚「联系我们」栏目标题',
          description: '可留空。',
        }),
        footerPhone: fields.text({
          label: '页脚联系电话',
          description: '可留空；例如 400-888-9999。',
        }),
        footerEmail: fields.text({
          label: '页脚联系邮箱',
          description: '可留空；例如 contact@example.com。',
        }),
        footerMotto: fields.text({
          label: '页脚品牌标语',
          description: '可留空；页脚底部显示的品牌格言。',
        }),
        copyrightLine: fields.text({
          label: '版权文案',
          description: '可留空；完整填写需要前台显示的版权文本，例如 © 2026 某某公司. All rights reserved.',
        }),
      },
    }),
    homePage: singleton({
      label: '首页',
      path: 'src/content/homePage/home',
      previewUrl: preview('/'),
      schema: {
        heroLabel: fields.text({ label: 'Hero 标签' }),
        heroTitle: fields.text({ label: 'Hero 标题' }),
        heroBody: fields.text({ label: 'Hero 正文', multiline: true }),
        heroImage: homeImage('Hero 图片', '首页首屏图片。'),
        heroPrimaryLabel: fields.text({ label: '主按钮文案' }),
        heroPrimaryHref: fields.text({ label: '主按钮链接' }),
        heroSecondaryLabel: fields.text({ label: '次按钮文案' }),
        heroSecondaryHref: fields.text({ label: '次按钮链接' }),
        heroTertiaryLabel: fields.text({ label: '第三按钮文案' }),
        heroTertiaryHref: fields.text({ label: '第三按钮链接' }),
        heroQuaternaryLabel: fields.text({ label: '第四按钮文案' }),
        heroQuaternaryHref: fields.text({ label: '第四按钮链接' }),
        introTitle: fields.text({ label: '介绍标题' }),
        introBody: fields.text({ label: '介绍正文', multiline: true }),
        highlights: fields.array(
          fields.object(
            {
              title: fields.text({ label: '标题' }),
              body: fields.text({ label: '正文', multiline: true }),
              image: homeImage('配图', '亮点卡片配图。'),
            },
            { layout: [4, 8, 12] },
          ),
          {
            label: '亮点列表',
            description: '首页中部展示的内容块；不填则前台不显示。',
          },
        ),
        storyImages: fields.array(
          fields.object(
            {
              image: homeImage('图片'),
              alt: fields.text({ label: '图片说明' }),
            },
            { layout: [6, 6] },
          ),
          {
            label: '介绍区实景图片',
            description: '介绍区右侧的实景配图；不填则前台不显示。',
            itemLabel: (props) => props.fields.alt.value || '图片',
          },
        ),
        logoCloudLabel: fields.text({ label: '品牌墙标签' }),
        logoCloudTitle: fields.text({ label: '品牌墙标题' }),
        logos: fields.array(
          fields.object(
            {
              name: fields.text({ label: '品牌名称' }),
              image: homeImage('品牌 Logo', '建议统一尺寸的正方形或横图。'),
            },
            { layout: [6, 6] },
          ),
          {
            label: '品牌墙项目',
            description: '用于展示客户、合作方、认证体系或信任标识。',
          },
        ),
        statsLabel: fields.text({ label: '数据区标签' }),
        statsTitle: fields.text({ label: '数据区标题' }),
        stats: fields.array(
          fields.object(
            {
              value: fields.text({ label: '数值' }),
              label: fields.text({ label: '标题' }),
              detail: fields.text({ label: '说明', multiline: true }),
            },
            { layout: [4, 8, 12] },
          ),
          {
            label: '数据卡片',
            description: '首页关键指标展示；建议 3 到 4 项。',
          },
        ),
        showcaseLabel: fields.text({ label: '案例区标签' }),
        showcaseTitle: fields.text({ label: '案例区标题' }),
        showcaseBody: fields.text({ label: '案例区正文', multiline: true }),
        showcases: fields.array(
          fields.object(
            {
              tag: fields.text({ label: '标签' }),
              title: fields.text({ label: '标题' }),
              body: fields.text({ label: '正文', multiline: true }),
              image: homeImage('案例图片', '建议统一比例的横图。'),
            },
            { layout: [4, 8, 12, 12] },
          ),
          {
            label: '案例列表',
            description: '首页展示的案例或解决方案卡片。',
          },
        ),
        ctaLabel: fields.text({ label: 'CTA 标签' }),
        ctaTitle: fields.text({ label: 'CTA 标题' }),
        ctaBody: fields.text({ label: 'CTA 正文', multiline: true }),
        ctaPrimaryLabel: fields.text({ label: 'CTA 主按钮文案' }),
        ctaPrimaryHref: fields.text({ label: 'CTA 主按钮链接' }),
        ctaSecondaryLabel: fields.text({ label: 'CTA 次按钮文案' }),
        ctaSecondaryHref: fields.text({ label: 'CTA 次按钮链接' }),
        productsLabel: fields.text({ label: '产品区标签' }),
        productsTitle: fields.text({ label: '产品区标题' }),
        livingPicksLabel: fields.text({ label: '艺术选品标签' }),
        livingPicksTitle: fields.text({ label: '艺术选品标题' }),
        livingPicksBody: fields.text({ label: '艺术选品说明', multiline: true }),
        livingPicksCategories: fields.array(
          fields.object(
            {
              id: fields.text({ label: '分类标识' }),
              name: fields.text({ label: '分类名称' }),
              englishName: fields.text({ label: '英文名称' }),
              description: fields.text({ label: '分类说明', multiline: true }),
              mainImage: homeImage('分类主图'),
              products: fields.array(
                fields.object(
                  {
                    name: fields.text({ label: '作品名称' }),
                    description: fields.text({ label: '作品说明', multiline: true }),
                    image: homeImage('作品图片'),
                  },
                  { layout: [4, 8, 12] },
                ),
                {
                  label: '分类下的作品',
                  itemLabel: (props) => props.fields.name.value || '作品',
                },
              ),
            },
            { layout: [4, 4, 4, 12, 6, 6] },
          ),
          {
            label: '艺术选品分类',
            description: '艺术选品区块的分类卡片；不填则前台不显示该区块。',
            itemLabel: (props) => props.fields.name.value || '分类',
          },
        ),
        aboutLabel: fields.text({ label: '关于区块标签' }),
        aboutTitle: fields.text({ label: '关于区块标题' }),
        aboutBody: fields.text({ label: '关于区块正文', multiline: true }),
        aboutContactEmail: fields.text({
          label: '关于区块联系邮箱',
          description: '可留空；填写后关于区块显示邮箱入口。',
        }),
        aboutContactRedNote: fields.text({
          label: '关于区块小红书账号',
          description: '可留空；填写后关于区块显示小红书入口。',
        }),
        brandTimelineTitle: fields.text({ label: '品牌历程栏目标题' }),
        brandTimeline: fields.array(
          fields.object(
            {
              date: fields.text({ label: '日期' }),
              title: fields.text({ label: '标题' }),
              description: fields.text({ label: '说明', multiline: true }),
            },
            { layout: [4, 8, 12] },
          ),
          { label: '品牌历程' },
        ),
        brandStatsLabel: fields.text({ label: '品牌数据标签' }),
        brandStatsTitle: fields.text({ label: '品牌数据标题' }),
        brandStatsItems: fields.array(
          fields.object(
            {
              label: fields.text({ label: '名称' }),
              value: fields.text({ label: '数值' }),
              detail: fields.text({ label: '说明' }),
            },
            { layout: [4, 8, 12] },
          ),
          { label: '品牌数据' },
        ),
      },
    }),
    productsPage: singleton({
      label: '产品列表页',
      path: 'src/content/productsPage/products',
      previewUrl: preview('/products'),
      schema: {
        seoTitle: fields.text({
          label: 'SEO 标题',
          description: '可留空；留空时使用页面标题。',
        }),
        seoDescription: fields.text({
          label: 'SEO 描述',
          multiline: true,
          description: '可留空；留空时使用页面正文或站点默认描述。',
        }),
        kicker: fields.text({ label: '小标签' }),
        title: fields.text({ label: '页面标题' }),
        body: fields.text({ label: '页面正文', multiline: true }),
        emptyNote: fields.text({
          label: '空列表提示',
          description: '可留空；还没有可展示的产品时显示。',
        }),
      },
    }),
    notFoundPage: singleton({
      label: '404 页面',
      path: 'src/content/notFoundPage/not-found',
      previewUrl: preview('/404.html'),
      schema: {
        seoTitle: fields.text({ label: 'SEO 标题' }),
        code: fields.text({ label: '状态码' }),
        message: fields.text({ label: '主提示' }),
        detail: fields.text({ label: '详细提示', multiline: true }),
        homeLabel: fields.text({ label: '返回首页按钮' }),
        homeHref: fields.text({ label: '返回首页链接' }),
      },
    }),
  },
  collections: {
    products: collection({
      label: '产品条目',
      slugField: 'title',
      path: 'src/content/products/*',
      previewUrl: preview('/products/{slug}'),
      columns: ['title', 'brand'],
      schema: {
        title: fields.slug({
          name: {
            label: '产品名称',
            description: '显示在产品列表与详情页的标题。',
          },
          slug: {
            label: 'URL 标识（文件名）',
            description: '决定详情页地址 /products/<标识>；修改会改变文件名与网址，请谨慎。',
          },
        }),
        brand: fields.text({ label: '品牌' }),
        partNumber: fields.text({ label: '型号/编号' }),
        englishName: fields.text({ label: '英文名称' }),
        oneLiner: fields.text({
          label: '一句话卖点',
          multiline: true,
          description: '列表卡片与详情页顶部展示的短句。',
        }),
        mainImage: mediaImage(
          '主图',
          'public/images/products',
          '/images/products/',
          '本地上传；留空时自动使用与文件名同名的产品图片。',
        ),
        keywords: fields.array(fields.text({ label: '关键词' }), {
          label: '关键词标签',
          description: '列表卡片最多展示 3 个标签。',
          itemLabel: (props) => props.value || '关键词',
        }),
        stockStatus: fields.text({ label: '库存/状态' }),
        summary: fields.text({
          label: '产品简介',
          multiline: true,
          description: '同时作为详情页的 SEO 描述兜底。',
        }),
        description: fields.text({ label: '产品详情', multiline: true }),
        ingredients: fields.text({ label: '成分/材质', multiline: true }),
        usage: fields.text({ label: '用法/场景', multiline: true }),
        seoTitle: fields.text({
          label: 'SEO 标题',
          description: '可留空；留空时使用产品名称。',
        }),
        seoDescription: fields.text({
          label: 'SEO 描述',
          multiline: true,
          description: '可留空；留空时使用产品简介。',
        }),
      },
    }),
  },
});
