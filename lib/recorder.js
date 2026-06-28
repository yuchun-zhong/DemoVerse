/**
 * DemoVerse - 智能录屏服务
 * 从静态截图升级为全程录屏帧捕获
 * 
 * 核心机制：
 * 1. FrameCapture - 帧捕获器，管理截图和帧时长
 * 2. recordPageWithAgent - 启动浏览器 + Agent 智能浏览 + 帧捕获
 * 3. 输出帧序列文件（FFmpeg concat demuxer 格式）
 */

import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';

/**
 * 平台对应的视口尺寸
 */
const PLATFORM_VIEWPORTS = {
  bilibili:   { width: 1280, height: 720 },
  youtube:    { width: 1280, height: 720 },
  zhihu:      { width: 1280, height: 720 },
  douyin:     { width: 720, height: 1280 },
  wechat:     { width: 720, height: 1280 },
  xiaohongshu:{ width: 810, height: 1080 },
  custom:     { width: 1280, height: 720 },
};

/**
 * 帧捕获器 - 管理帧截图和时长
 */
export class FrameCapture {
  constructor(workDir) {
    this.frameDir = path.join(workDir, 'frames');
    fs.mkdirSync(this.frameDir, { recursive: true });
    this.frameIndex = 0;
    this.frameList = []; // { path, duration } 帧列表
  }

  /**
   * 捕获当前页面帧，指定展示时长
   * @param {import('puppeteer-core').Page} page
   * @param {number} duration - 此帧展示时长（秒）
   */
  async capture(page, duration) {
    const framePath = path.join(this.frameDir, `frame_${String(this.frameIndex++).padStart(6, '0')}.jpg`);
    try {
      await page.screenshot({
        path: framePath,
        type: 'jpeg',
        quality: 88,
      });
      this.frameList.push({ path: framePath, duration });
    } catch (err) {
      console.error('帧捕获失败:', err.message);
    }
  }

  /**
   * 捕获多帧序列（用于动画过程）
   */
  async captureSequence(page, count, intervalMs = 200) {
    for (let i = 0; i < count; i++) {
      await this.capture(page, intervalMs / 1000);
      if (i < count - 1) {
        await new Promise(r => setTimeout(r, intervalMs));
      }
    }
  }

  /**
   * 生成 FFmpeg concat demuxer 文件
   * @returns {string} concat 文件路径
   */
  generateConcatFile() {
    const concatPath = path.join(this.frameDir, 'frames.txt');
    const lines = [];
    for (const frame of this.frameList) {
      lines.push(`file '${frame.path}'`);
      lines.push(`duration ${frame.duration.toFixed(3)}`);
    }
    // FFmpeg concat demuxer 需要最后一帧没有 duration 但需要再列一次
    if (this.frameList.length > 0) {
      lines.push(`file '${this.frameList[this.frameList.length - 1].path}'`);
    }
    fs.writeFileSync(concatPath, lines.join('\n'));
    return concatPath;
  }

  /**
   * 获取总时长（秒）
   */
  getTotalDuration() {
    return this.frameList.reduce((sum, f) => sum + f.duration, 0);
  }

  /**
   * 获取帧数量
   */
  getFrameCount() {
    return this.frameList.length;
  }
}

/**
 * 使用 Puppeteer + Agent 录制智能浏览视频帧
 * @param {string} url - 目标页面 URL
 * @param {string} jobId - 任务 ID
 * @param {object} options - 生成选项
 * @param {import('./agent.js').PageAgent} agent - 智能浏览 Agent
 * @param {function} onProgress - 进度回调
 * @returns {Promise<{frameCapture: FrameCapture, pageData: object, executedSteps: Array, workDir: string}>}
 */
export async function recordPageWithAgent(url, jobId, options, agent, onProgress = () => {}) {
  const platform = options.platform || 'bilibili';
  const viewport = PLATFORM_VIEWPORTS[platform] || PLATFORM_VIEWPORTS.bilibili;

  const workDir = path.join('/tmp', `demoverse_${jobId}`);
  fs.mkdirSync(workDir, { recursive: true });

  onProgress({ step: 'launch', message: '启动浏览器...' });

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      `--window-size=${viewport.width},${viewport.height}`,
    ],
    defaultViewport: {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    },
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });

    // 设置 User-Agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    onProgress({ step: 'loading', message: '加载页面...' });

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // 等待页面稳定渲染
    await new Promise(r => setTimeout(r, 2000));

    onProgress({ step: 'analyzing', message: 'AI 分析页面结构...' });

    // 注入视觉效果样式
    await agent.injectEffects(page);

    // 分析页面结构
    const pageStructure = await agent.analyzePageStructure(page);

    const pageData = {
      title: pageStructure.title,
      url: pageStructure.url,
      textContent: pageStructure.textContent,
      elements: pageStructure.elements,
      headings: pageStructure.headings,
    };

    onProgress({ step: 'planning', message: 'AI 规划浏览路径...' });

    // 使用 LLM 规划浏览路径
    const browsingSteps = await agent.planBrowsingPath(pageStructure);

    onProgress({ step: 'recording', message: `智能浏览录制中（${browsingSteps.length} 步）...` });

    // 创建帧捕获器
    const frameCapture = new FrameCapture(workDir);

    // 先捕获空白/加载起始帧
    await frameCapture.capture(page, 0.5);

    // 执行浏览路径并捕获帧
    const executedSteps = await agent.executeBrowsingPath(
      page, browsingSteps, pageStructure, frameCapture
    );

    // 结尾画面渐黑效果 - 捕获最后一帧
    await frameCapture.capture(page, 2.0);

    onProgress({ step: 'captured', message: `录制完成，共 ${frameCapture.getFrameCount()} 帧，时长 ${frameCapture.getTotalDuration().toFixed(1)}s` });

    // 生成 FFmpeg concat 文件
    frameCapture.generateConcatFile();

    return {
      frameCapture,
      pageData,
      executedSteps,
      browsingSteps,
      workDir,
    };

  } finally {
    await browser.close().catch(() => {});
  }
}
