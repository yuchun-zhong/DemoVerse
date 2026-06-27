import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';

/**
 * 使用 Puppeteer 录制页面截图序列
 * @param {string} url - 目标页面 URL
 * @param {string} jobId - 任务 ID
 * @param {function} onProgress - 进度回调
 * @returns {Promise<{screenshots: string[], pageData: object}>}
 */
export async function recordPage(url, jobId, onProgress = () => {}) {
  const workDir = path.join('/tmp', `demoverse_${jobId}`);
  const screenshotDir = path.join(workDir, 'screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });

  onProgress({ step: 'launch', message: '启动浏览器...' });

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,720',
    ],
    defaultViewport: {
      width: 1280,
      height: 720,
    },
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    onProgress({ step: 'loading', message: '加载页面...' });
    
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // 等待页面渲染
    await new Promise(r => setTimeout(r, 1500));

    const screenshots = [];
    const pageData = {};

    // 获取页面基本信息
    pageData.title = await page.title();
    pageData.url = page.url();

    // 提取页面文本内容用于 AI 分析
    onProgress({ step: 'analyzing', message: '分析页面内容...' });
    
    try {
      pageData.textContent = await page.evaluate(() => {
        const body = document.body;
        // 移除脚本和样式
        const clone = body.cloneNode(true);
        clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
        return clone.innerText?.slice(0, 3000) || '';
      });
    } catch (e) {
      pageData.textContent = '';
    }

    // 截取首屏
    onProgress({ step: 'capturing', message: '截取首屏...' });
    const shot1 = path.join(screenshotDir, 'frame_001.png');
    await page.screenshot({ path: shot1, type: 'png' });
    screenshots.push(shot1);

    // 全页面滚动截图
    const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = 720;
    const scrollSteps = Math.min(Math.ceil(scrollHeight / viewportHeight), 8);
    
    for (let i = 1; i <= scrollSteps; i++) {
      onProgress({ step: 'scrolling', message: `滚动截取 ${i}/${scrollSteps}...` });
      await page.evaluate((step, vh) => {
        window.scrollTo(0, step * vh);
      }, i, viewportHeight);
      
      // 等待滚动动画和懒加载
      await new Promise(r => setTimeout(r, 800));
      
      const shotPath = path.join(screenshotDir, `frame_${String(i + 1).padStart(3, '0')}.png`);
      await page.screenshot({ path: shotPath, type: 'png' });
      screenshots.push(shotPath);
    }

    // 滚回顶部
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 500));

    // 尝试点击主要交互元素
    try {
      onProgress({ step: 'interacting', message: '模拟交互...' });
      
      const clickableSelectors = [
        'button:not([disabled])',
        'a[href]:not([href="#"])',
        '[role="button"]:not([disabled])',
        'summary',
        '[tabindex="0"]',
      ];

      const clicked = new Set();
      for (const selector of clickableSelectors) {
        if (clicked.size >= 3) break;
        const elements = await page.$$(selector);
        for (const el of elements.slice(0, 2)) {
          if (clicked.size >= 3) break;
          try {
            const box = await el.boundingBox();
            if (!box || box.width < 10 || box.height < 10) continue;
            
            // 检查元素是否在视口内
            if (box.y > viewportHeight) continue;
            
            await el.click();
            await new Promise(r => setTimeout(r, 1000));
            
            const shotPath = path.join(screenshotDir, `frame_${String(screenshots.length + 1).padStart(3, '0')}.png`);
            await page.screenshot({ path: shotPath, type: 'png' });
            screenshots.push(shotPath);
            clicked.add(selector);
          } catch (e) {
            // 忽略不可点击元素
          }
        }
      }
    } catch (e) {
      // 忽略交互错误
    }

    onProgress({ step: 'captured', message: `完成截取，共 ${screenshots.length} 帧` });

    return { screenshots, pageData, workDir };
  } finally {
    await browser.close();
  }
}
