/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_ENABLE_SITE_ANALYTICS?: string;
  readonly PUBLIC_SITE_ANALYTICS_ENDPOINT?: string;
  readonly PUBLIC_CONTACT_FORM_ENDPOINT?: string;
  readonly PUBLIC_CONTACT_FORM_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    locale: string;
  }
}
