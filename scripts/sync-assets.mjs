#!/usr/bin/env node

/**
 * 自动化静态资源同步与映射脚本
 * 
 * 用法:
 * node sync-assets.mjs <src_dir> <dest_dir> <output_json_path> <category_key>
 * 
 * 示例:
 * node sync-assets.mjs ./素材/好評 ./public/images/material ./src/data/reviews.json reviews
 */

import fs from 'node:fs';
import path from 'node:path';

const [,, srcDir, destDir, outputJsonPath, categoryKey] = process.argv;

if (!srcDir || !destDir || !outputJsonPath || !categoryKey) {
  console.error('❌ 参数缺失！用法:');
  console.error('node sync-assets.mjs <src_dir> <dest_dir> <output_json_path> <category_key>');
  process.exit(1);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function run() {
  console.log(`📂 开始同步 [${srcDir}] 中的图片资源...`);
  
  if (!fs.existsSync(srcDir)) {
    console.error(`❌ 源目录不存在: ${srcDir}`);
    process.exit(1);
  }

  ensureDir(destDir);
  ensureDir(path.dirname(outputJsonPath));

  const files = fs.readdirSync(srcDir);
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
  const imageFiles = files.filter(file => {
    const ext = path.extname(file).toLowerCase();
    return imageExtensions.includes(ext);
  });

  if (imageFiles.length === 0) {
    console.warn(`⚠️ 警告: 源目录 [${srcDir}] 内没有找到任何图片文件。`);
    process.exit(0);
  }

  let existingData = {};
  if (fs.existsSync(outputJsonPath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(outputJsonPath, 'utf-8'));
    } catch (e) {
      console.warn(`⚠️ 无法读取已存在的映射文件: ${outputJsonPath}，将重新生成。`);
    }
  }

  const resultImages = [];
  let count = 0;

  for (const file of imageFiles) {
    const ext = path.extname(file).toLowerCase();
    const newName = `${categoryKey}_${count}${ext}`;
    const srcFilePath = path.join(srcDir, file);
    const destFilePath = path.join(destDir, newName);

    try {
      fs.copyFileSync(srcFilePath, destFilePath);
      const webUrl = `/images/material/${newName}`; // 默认的 public 下相对 web 访问路径
      
      resultImages.push({
        name: newName,
        url: webUrl,
        title: `${categoryKey} - 资源 ${count + 1}`
      });
      count++;
    } catch (err) {
      console.error(`❌ 拷贝文件失败 ${file} -> ${newName}:`, err.message);
    }
  }

  // 更新对应 categoryKey 的数据
  existingData[categoryKey] = {
    key: categoryKey,
    count: count,
    images: resultImages
  };

  fs.writeFileSync(outputJsonPath, JSON.stringify(existingData, null, 2), 'utf-8');
  console.log(`✅ 成功同步了 ${count} 张图片至: ${destDir}`);
  console.log(`📝 数据映射已更新并写入至: ${outputJsonPath}`);
}

run();
