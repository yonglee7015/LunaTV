#!/usr/bin/env node

/* eslint-disable no-console,@typescript-eslint/no-var-requires */
const http = require('http');
const path = require('path');
const fs = require('fs');

// 调用 generate-manifest.js 生成 manifest.json
function generateManifest() {
  console.log('Generating manifest.json for Docker deployment...');

  try {
    const generateManifestScript = path.join(
      __dirname,
      'scripts',
      'generate-manifest.js'
    );

    if (!fs.existsSync(generateManifestScript)) {
      throw new Error(`Script not found: ${generateManifestScript}`);
    }

    require(generateManifestScript);
  } catch (error) {
    console.error('❌ Error calling generate-manifest.js:', error);
    throw error;
  }
}

generateManifest();

// 直接在当前进程中启动 standalone Server（`server.js`）
require('./server.js');

// 每 1 秒轮询一次，直到请求成功（最多 60 次尝试）
const TARGET_URL = `http://${process.env.HOSTNAME || 'localhost'}:${process.env.PORT || 3000}/login`;
const MAX_POLL_ATTEMPTS = 60;
let pollAttempts = 0;

const intervalId = setInterval(() => {
  pollAttempts++;
  console.log(`Fetching ${TARGET_URL} (attempt ${pollAttempts}/${MAX_POLL_ATTEMPTS})...`);

  if (pollAttempts > MAX_POLL_ATTEMPTS) {
    console.error('⚠️  Max poll attempts reached. Server may not be responding.');
    clearInterval(intervalId);
    return;
  }

  const req = http.get(TARGET_URL, (res) => {
    // 当返回 2xx 状态码时认为成功，然后停止轮询
    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
      console.log('✅ Server is up, stop polling.');
      clearInterval(intervalId);

      setTimeout(() => {
        // 服务器启动后，立即执行一次 cron 任务
        executeCronJob();
      }, 3000);

      // 然后设置每小时执行一次 cron 任务
      setInterval(() => {
        executeCronJob();
      }, 60 * 60 * 1000); // 每小时执行一次
    }
  });

  req.on('error', (err) => {
    console.warn(`⚠️  Polling request failed: ${err.message}`);
  });

  req.setTimeout(2000, () => {
    console.warn('⚠️  Polling request timeout');
    req.destroy();
  });
}, 1000);

// 执行 cron 任务的函数
function executeCronJob() {
  const cronUrl = `http://${process.env.HOSTNAME || 'localhost'}:${process.env.PORT || 3000}/api/cron`;
  const cronSecret = process.env.CRON_SECRET || '';

  console.log(`Executing cron job: ${cronUrl}`);

  const options = {
    headers: cronSecret ? { 'X-Cron-Secret': cronSecret } : {},
  };

  const req = http.get(cronUrl, options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        console.log('✅ Cron job executed successfully:', data);
      } else {
        console.error('❌ Cron job failed:', res.statusCode, data);
      }
    });
  });

  req.on('error', (err) => {
    console.error('❌ Error executing cron job:', err);
  });

  req.setTimeout(30000, () => {
    console.error('❌ Cron job timeout');
    req.destroy();
  });
}
