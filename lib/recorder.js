/**
 * DemoVerse - 全程录屏录制器
 * 
 * ScreencastSession 逐帧截图 + 标题页/结尾页生成
 * 配合智能浏览 Agent 完成完整的产品演示录制
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { PageAgent } from './agent.js';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// 平台视口尺寸映射
const VIEWPORT_MAP = {
  bilibili:   { width: 1920, height: 1080, ratio: '16:9' },
  youtube:    { width: 1920, height: 1080, ratio: '16:9' },
  zhihu:      { width: 1920, height: 1080, ratio: '16:9' },
  douyin:     { width: 1080, height: 1920, ratio: '9:16' },
  wechat:     { width: 1080, height: 1920, ratio: '9:16' },
  xiaohongshu: { width: 1080, height: 1440, ratio: '3:4' },
  custom:     { width: 1920, height: 1080, ratio: '16:9' },
};

/**
 * 帧捕获器 - 管理逐帧截图的采集
 */
export class FrameCapture {
  constructor(workDir) {
    this.workDir = workDir;
    this.frames = [];
    this.frameIndex = 0;
    this.totalDuration = 0;
  }

  /**
   * 捕获一帧并指定其持续时长
   */
  async capture(page, durationSeconds = 0.5) {
    const filename = `frame_${String(this.frameIndex).padStart(6, '0')}.png`;
    const filepath = path.join(this.workDir, filename);

    try {
      await page.screenshot({ path: filepath, type: 'png' });
      this.frames.push({ file: filepath, duration: durationSeconds });
      this.totalDuration += durationSeconds;
      this.frameIndex++;
    } catch (err) {
      console.error('截图失败:', err.message);
    }
  }

  getFrameCount() {
    return this.frames.length;
  }

  getTotalDuration() {
    return this.totalDuration;
  }

  getFrames() {
    return this.frames;
  }
}

/**
 * 生成标题页 HTML 并截图
 */
async function generateTitlePage(page, workDir, pageData, frameCapture) {
  const productName = pageData.title || 'Demo';
  const description = pageData.meta?.description || pageData.meta?.['og:description'] || '';
  
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { 
    width: 1920px; height: 1080px; 
    background: #000; 
    display: flex; flex-direction: column; 
    justify-content: center; align-items: center;
    font-family: 'Inter', -apple-system, sans-serif;
    overflow: hidden;
  }
  .glow {
    position: absolute; top: -200px; left: 50%; transform: translateX(-50%);
    width: 600px; height: 400px;
    background: radial-gradient(ellipse, rgba(139,92,246,0.15) 0%, transparent 70%);
    pointer-events: none;
  }
  .logo { font-size: 64px; font-weight: 800; color: #fff; letter-spacing: -0.03em; margin-bottom: 16px; }
  .logo span { color: #8B5CF6; }
  .tagline { font-size: 24px; color: #888; font-weight: 400; max-width: 700px; text-align: center; line-height: 1.5; }
  .url { font-size: 16px; color: #555; margin-top: 40px; font-family: 'JetBrains Mono', monospace; }
  .badge { 
    display: inline-block; margin-top: 20px; 
    padding: 8px 20px; border-radius: 20px; 
    background: rgba(139,92,246,0.12); border: 1px solid rgba(139,92,246,0.3);
    color: #A78BFA; font-size: 14px; letter-spacing: 0.05em;
  }
</style></head><body>
  <div class="glow"></div>
  <div class="logo">Demo<span>Verse</span></div>
  <div class="tagline">${description || `AI 驱动的智能 Demo 视频生成器`}</div>
  <div class="url">${pageData.url || ''}</div>
  <div class="badge">AI POWERED DEMO</div>
</body></html>`;

  const titlePath = path.join(workDir, 'title_page.html');
  fs.writeFileSync(titlePath, html);

  await page.goto(`file://${titlePath}`, { waitUntil: 'networkidle0', timeout: 10000 });
  await delay(500);

  // 捕获标题页帧（4秒展示）
  for (let i = 0; i < 8; i++) {
    await frameCapture.capture(page, 0.5);
  }
}

/**
 * 生成结尾页 HTML 并截图
 */
async function generateEndingPage(page, workDir, pageData, frameCapture) {
  const productName = pageData.title || 'Demo';
  const url = pageData.url || '';
  
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { 
    width: 1920px; height: 1080px; 
    background: #000; 
    display: flex; flex-direction: column; 
    justify-content: center; align-items: center;
    font-family: 'Inter', -apple-system, sans-serif;
    overflow: hidden;
  }
  .glow {
    position: absolute; bottom: -200px; left: 50%; transform: translateX(-50%);
    width: 600px; height: 400px;
    background: radial-gradient(ellipse, rgba(139,92,246,0.12) 0%, transparent 70%);
    pointer-events: none;
  }
  .product-name { font-size: 48px; font-weight: 800; color: #fff; letter-spacing: -0.03em; margin-bottom: 16px; }
  .product-name span { color: #8B5CF6; }
  .cta { font-size: 28px; color: #EDEDED; margin-bottom: 30px; font-weight: 500; }
  .link { 
    font-size: 20px; color: #A78BFA; 
    font-family: 'JetBrains Mono', monospace;
    padding: 12px 28px; border-radius: 8px;
    background: rgba(139,92,246,0.08); border: 1px solid rgba(139,92,246,0.2);
  }
  .footer { position: absolute; bottom: 40px; color: #555; font-size: 14px; }
</style></head><body>
  <div class="glow"></div>
  <div class="product-name">${productName}</div>
  <div class="cta">Made with DemoVerse</div>
  ${url ? `<div class="link">${url}</div>` : ''}
  <div class="footer">Powered by AI</div>
</body></html>`;

  const endingPath = path.join(workDir, 'ending_page.html');
  fs.writeFileSync(endingPath, html);

  await page.goto(`file://${endingPath}`, { waitUntil: 'networkidle0', timeout: 10000 });
  await delay(500);

  // 捕获结尾页帧（4秒展示）
  for (let i = 0; i < 8; i++) {
    await frameCapture.capture(page, 0.5);
  }
}

/**
 * 主录制函数 - 智能浏览 Agent + 全程录屏
 */
export async function recordPageWithAgent(url, jobId, options = {}, agent, onProgress = () => {}) {
  const workDir = path.join('/tmp', `demoverse_${jobId}`);
  fs.mkdirSync(workDir, { recursive: true });

  const vp = VIEWPORT_MAP[options.platform] || VIEWPORT_MAP.bilibili;

  let browser = null;

  try {
    // 启动浏览器
    onProgress({ step: 'launch', message: '启动浏览器...' });

    const puppeteerOptions = {
      headless: true,
      defaultViewport: { width: vp.width, height: vp.height },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-software-rasterizer',
        '--disable-web-security',
        '--no-first-run',
        '--disable-features=VizDisplayCompositor',
      ],
    };

    // 尝试使用系统 Chromium
    const execPath = process.env.PUPPETEER_EXECUTABLE_PATH || 
      '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
    if (execPath) {
      puppeteerOptions.executablePath = execPath;
    }

    browser = await puppeteer.launch(puppeteerOptions);

    // 加载页面
    onProgress({ step: 'loading', message: '加载目标页面...' });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await delay(2000);

    // 提取页面数据
    onProgress({ step: 'analyzing', message: '智能分析页面结构...' });
    const pageData = await agent.analyzePageStructure(page);

    // 注入视觉增强效果
    await agent.injectEffects(page);

    // 生成标题页
    onProgress({ step: 'recording', message: '生成开场标题页...' });
    const frameCapture = new FrameCapture(workDir);
    await generateTitlePage(page, workDir, pageData, frameCapture);

    // 导航回目标页面并重新注入效果
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    await delay(2000);
    await agent.injectEffects(page);

    // 规划浏览路径
    onProgress({ step: 'planning', message: 'AI 规划演示路径...' });
    const browsingSteps = await agent.planBrowsingPath(pageData);

    // 执行浏览录制
    onProgress({ step: 'recording', message: '智能浏览录制中...' });
    const executedSteps = await agent.executeBrowsingPath(page, browsingSteps, pageData, frameCapture);

    // 生成结尾页
    onProgress({ step: 'captured', message: '生成结尾画面...' });
    await generateEndingPage(page, workDir, pageData, frameCapture);

    onProgress({ step: 'captured', message: `录制完成，共 ${frameCapture.getFrameCount()} 帧，时长 ${frameCapture.getTotalDuration().toFixed(1)}s` });

    return {
      frameCapture,
      pageData,
      executedSteps,
      browsingSteps,
      workDir,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
