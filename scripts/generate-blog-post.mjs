#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadEnvFile, projectRoot, sleep } from './lib/cli-helpers.mjs';

const dryRun = process.argv.includes('--dry-run');
await loadEnvFile();

const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
const model = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat';
if (!dryRun && !apiKey) {
  throw new Error('Missing DEEPSEEK_API_KEY in .env');
}

const keywordsPath = path.join(projectRoot, '关键词.txt');
const raw = await fs.readFile(keywordsPath, 'utf8');

const entries = [];
for (const rawLine of raw.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line) continue;
  // 跳过“一、物品类别关键词”这类分组标题
  if (/^[一二三四五六七八九十]+、/.test(line)) continue;
  // 兼容“1. keyword”“12、keyword”编号格式
  const stripped = line.replace(/^\d+\s*[.、)]\s*/, '').trim();
  // 去掉“（细节）”括号，保留细节作为上下文
  const paren = stripped.match(/^(.+?)[（(](.*?)[)）]\s*$/);
  const key = (paren ? paren[1] : stripped).trim();
  const detail = (paren ? paren[2] : '').trim();
  if (!key) continue;
  entries.push({ key, detail });
}

if (entries.length < 3) {
  throw new Error(`关键词.txt 需要至少 3 个关键词，实际解析到 ${entries.length} 个。`);
}

function pickRandomThree(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy.slice(0, 3);
}

const picks = pickRandomThree(entries);
const pickText = picks
  .map((item) => (item.detail ? `${item.key}（${item.detail}）` : item.key))
  .join('、');

if (dryRun) {
  console.log('（dry-run，不会调用 DeepSeek、不会写文件）');
  console.log('解析到关键词数：' + entries.length);
  console.log('随机关键词：' + pickText);
  process.exit(0);
}

const systemPrompt = [
  '你是一名资深的收藏品回收、鉴定评估与家庭/单位物品处置行业的内容编辑。',
  '请始终输出一个严格的 JSON 对象（不要 markdown 代码块，不要多余文字），字段如下：',
  'title: 中文标题（≤30 字，主谓清楚）',
  'slug: 英文小写短横线标识（≤50 字符，仅含 a-z 0-9 -）',
  'category: 简短分类（业务解读/指南/行业观察/收藏常识 之一）',
  'excerpt: 摘要（≤90 字）',
  'body: 正文，段落之间用空行分隔（\\n\\n），全文 600-900 字',
].join('\n');

const userContent = [
  '请以这三个关键词为主题，写一篇面向藏家与客户的中文博客文章：',
  pickText,
  '',
  '要求：内容围绕三者展开，专业、平实、客观；说明品类常识、鉴定/评估/处置流程、注意事项；',
  '不得编造具体公司、人名、地址、价格、资质、荣誉、统计数据或社交账号；',
  '只写行业通用知识与合理建议。',
].join('\n');

const payload = {
  model,
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ],
  max_tokens: 3000,
  temperature: 0.8,
};

async function invokeDeepSeek() {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`DeepSeek API returned ${response.status}: ${body}`);
      }

      const json = await response.json();
      const content = String(json.choices?.[0]?.message?.content ?? '').trim();
      if (!content) {
        throw new Error(`DeepSeek response missing content: ${JSON.stringify(json)}`);
      }
      return content;
    } catch (error) {
      lastError = error;
      if (attempt === 4) throw error;
      console.warn(`DeepSeek request failed on attempt ${attempt}/4: ${error.message}. Retrying in 5s.`);
      await sleep(5000);
    }
  }
  throw lastError;
}

function stripFences(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

// 去掉 AI 生成正文里偶尔残留的 <link reference_id="..."> 引用型 HTML 标记，
// 兼容属性顺序、大小写、跨行以及成对的 </link> 收尾，再折叠多余空行。
function stripReferenceIds(text) {
  if (!text) return text;
  return String(text)
    .replace(/<link\b[^>]*\breference_id\b[^>]*>/gi, '')
    .replace(/<\/link\s*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pickField(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim()) {
      return String(obj[key]).trim();
    }
  }
  return '';
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const contentText = await invokeDeepSeek();
let parsed;
try {
  parsed = JSON.parse(stripFences(contentText));
} catch {
  parsed = null;
}

let title = parsed ? pickField(parsed, ['title']) : '';
let slug = parsed ? pickField(parsed, ['slug']).toLowerCase() : '';
let category = parsed ? pickField(parsed, ['category']) : '';
let excerpt = parsed ? pickField(parsed, ['excerpt']) : '';
let body = parsed ? pickField(parsed, ['body']) : '';

if (!title || !body) {
  // Fallback: try to parse JSON embedded in the raw text.
  const jsonMatch = contentText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
      title = title || pickField(parsed, ['title']);
      slug = slug || pickField(parsed, ['slug']).toLowerCase();
      category = category || pickField(parsed, ['category']);
      excerpt = excerpt || pickField(parsed, ['excerpt']);
      body = body || pickField(parsed, ['body']);
    } catch {}
  }
}

if (!title || !body) {
  throw new Error('DeepSeek 未返回有效的博文章节（缺少 title/body）。请重试。');
}

slug = slug.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || '';
if (!slug) slug = `post-${Date.now()}`;

// 入库前过滤：清除 AI 输出中残留的 <link reference_id="..."> 标记
title = stripReferenceIds(title);
excerpt = stripReferenceIds(excerpt);
body = stripReferenceIds(body);

const now = new Date();
const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

let targetSlug = slug;
let filePath = path.join(projectRoot, 'src', 'content', 'blog', `${targetSlug}.yaml`);
let suffix = 2;
while (await fileExists(filePath)) {
  targetSlug = `${slug}-${suffix}`;
  filePath = path.join(projectRoot, 'src', 'content', 'blog', `${targetSlug}.yaml`);
  suffix += 1;
}

let yaml = stringifyYaml({
  slug: targetSlug,
  title,
  date,
  category,
  excerpt,
  body,
});

// Astro 的 YAML 加载器会把裸的 2026-08-26 解析成 Date，而 blog schema 要求 string 日期，
// 因此强制把顶层 date 输出为带单引号的字符串（与仓库既有文章一致）。
yaml = yaml.replace(/^date:\s*(.+?)\s*$/m, "date: '$1'");

await fs.writeFile(filePath, yaml, 'utf8');

console.log('随机关键词：' + pickText);
console.log('文章标题：' + title);
console.log('分类：' + (category || '（未设置）'));
console.log('Slug：' + targetSlug);
console.log('已写入：' + filePath);
