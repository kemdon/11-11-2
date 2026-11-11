#!/usr/bin/env node

import { chromium } from 'playwright';

const targetUrl = process.argv[2] || 'http://localhost:4321';

async function runSmokeTest() {
  console.log(`🚀 开始对目标网站 [ ${targetUrl} ] 执行自动化烟雾测试...`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let hasError = false;

  // 监听页面运行时 JavaScript 未捕获异常
  page.on('pageerror', (err) => {
    console.error('🔴 [JS Uncaught Exception] 客户端崩溃:', err.message);
    if (err.stack) {
      console.error(err.stack);
    }
    hasError = true;
  });

  // 监听浏览器控制台报错
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.error('🟠 [Console Error] 控制台报错:', msg.text());
      hasError = true;
    }
  });

  try {
    const response = await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });
    const status = response ? response.status() : 0;
    
    if (status >= 400) {
      console.error(`🔴 页面加载失败，HTTP 状态码: ${status}`);
      hasError = true;
    } else {
      console.log(`🟢 页面成功加载，HTTP 状态码: ${status}`);
    }

    // 简单检查页面标题和主要内容，确保页面渲染不为空
    const pageTitle = await page.title();
    console.log(`📄 页面 Title: ${pageTitle}`);

    const bodyTextLength = await page.evaluate(() => document.body.innerText.trim().length);
    if (bodyTextLength === 0) {
      console.error('🔴 警告: 页面 body 文本长度为 0，可能页面渲染异常白屏！');
      hasError = true;
    } else {
      console.log(`✅ 页面 body 包含有效文本 (字符数: ${bodyTextLength})`);
    }

  } catch (error) {
    console.error('🔴 发生网络连通性或导航超时错误:', error.message);
    hasError = true;
  } finally {
    await browser.close();
    console.log('🏁 烟雾测试执行完毕。');
    if (hasError) {
      process.exit(1);
    } else {
      console.log('🎉 烟雾测试完美通过，无 JS 运行时异常或控制台错误！');
      process.exit(0);
    }
  }
}

runSmokeTest();
