/**
 * Content-schema helpers that keep the site buildable when the CMS writes a
 * sparse document.
 *
 * Keystatic (storage: local) rewrites the whole YAML file on save, and an empty
 * text field is written by omitting the key entirely — inside array items that
 * is the normal case — or as `key:` (null) when the value was cleared by hand.
 * Plain `z.string()` rejects both, so Astro's content sync aborts and
 * `astro dev` / `astro build` die with an error that only names the zod path
 * (for example `brandTimeline.0.description: Required`).
 *
 * No field in the content model needs `null`, so both shapes are read as empty
 * text:
 *   text()      required text field -> empty string when missing or null
 *   textSafe()  schema wrapper -> null values become empty strings before parsing
 *
 * Keep new "required" text fields on `text()` unless the build must fail when the
 * field is empty, and keep the audits in `scripts/` aware of the wrapper.
 */
import { z } from 'astro:content';

export const text = () => z.string().catch('');

function replaceNullValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(replaceNullValues);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        item === null ? '' : replaceNullValues(item),
      ]),
    );
  }
  return value;
}

export function textSafe<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(replaceNullValues, schema);
}
