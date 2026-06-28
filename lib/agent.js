/**
 * DemoVerse - 智能页面探索 Agent
 * 从「拍一张首页」升级为「带着用户逛网站」
 * 
 * 核心能力：
 * 1. 分析页面结构，提取可交互元素
 * 2. 用 LLM 规划合理的浏览路径
 * 3. 自动执行交互（点击、滚动、悬停、输入）
 * 4. 每步动作带视觉反馈（高亮、光圈）
 */

import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

export class PageAgent {
  constructor(customHeaders = {}, options = {}) {
    const config = new Config();
    this.llmClient = new LLMClient(config, customHeaders);
    this.style = options.style || 'professional';
    this.platform = options.platform || 'bilibili';
    this.executedSteps = [];
    this.pageContent = {};
  }

  /**
   * 注入视觉反馈样式（高亮、光圈、缩放效果）
   */
  async injectEffects(page) {
    await page.evaluate(() => {
      if (document.getElementById('demoverse-effects-style')) return;
      const style = document.createElement('style');
      style.id = 'demoverse-effects-style';
      style.textContent = `
        @keyframes dv-highlight-pulse {
          0% { box-shadow: 0 0 0 0 rgba(139,92,246,0.5); }
          50% { box-shadow: 0 0 0 8px rgba(139,92,246,0.2); }
          100% { box-shadow: 0 0 0 0 rgba(139,92,246,0); }
        }
        @keyframes dv-cursor-ring {
          0% { transform: translate(-50%,-50%) scale(0.8); opacity: 0; }
          20% { transform: translate(-50%,-50%) scale(1); opacity: 1; }
          80% { transform: translate(-50%,-50%) scale(1); opacity: 0.6; }
          100% { transform: translate(-50%,-50%) scale(1.3); opacity: 0; }
        }
        .dv-highlight {
          outline: 2px solid rgba(139,92,246,0.9) !important;
          outline-offset: 3px !important;
          animation: dv-highlight-pulse 1.2s ease-out !important;
          transition: outline 0.15s ease !important;
          z-index: 99998 !important;
          position: relative !important;
        }
        .dv-cursor {
          position: fixed !important;
          width: 40px !important;
          height: 40px !important;
          border-radius: 50% !important;
          background: rgba(139,92,246,0.3) !important;
          border: 2px solid rgba(139,92,246,0.8) !important;
          pointer-events: none !important;
          z-index: 99999 !important;
          animation: dv-cursor-ring 1.5s ease-out forwards !important;
        }
        .dv-scroll-indicator {
          position: fixed !important;
          right: 20px !important;
          top: 50% !important;
          transform: translateY(-50%) !important;
          width: 4px !important;
          height: 60px !important;
          border-radius: 2px !important;
          background: rgba(139,92,246,0.6) !important;
          z-index: 99999 !important;
          pointer-events: none !important;
          transition: top 0.3s ease !important;
        }
        .dv-scroll-arrow {
          position: fixed !important;
          right: 14px !important;
          top: calc(50% - 20px) !important;
          width: 0 !important;
          height: 0 !important;
          border-left: 6px solid transparent !important;
          border-right: 6px solid transparent !important;
          border-bottom: 8px solid rgba(139,92,246,0.8) !important;
          z-index: 99999 !important;
          pointer-events: none !important;
          transition: top 0.3s ease !important;
        }
      `;
      document.head.appendChild(style);
    });
  }

  /**
   * 提取页面可交互元素和内容结构
   */
  async analyzePageStructure(page) {
    return page.evaluate(() => {
      function getSelector(el) {
        if (!el || el === document.body || el === document.documentElement) return 'body';
        if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return `#${el.id}`;
        if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
        if (el.getAttribute('aria-label')) {
          const tag = el.tagName.toLowerCase();
          return `${tag}[aria-label="${el.getAttribute('aria-label')}"]`;
        }
        // Build compact path
        const path = [];
        let current = el;
        let depth = 0;
        while (current && current !== document.body && depth < 4) {
          let seg = current.tagName.toLowerCase();
          if (current.id && /^[a-zA-Z][\w-]*$/.test(current.id)) {
            path.unshift(`#${current.id}`);
            break;
          }
          if (current.className && typeof current.className === 'string') {
            const cls = current.className.trim().split(/\s+/).find(c => 
              c.length > 2 && !c.startsWith('_') && !c.startsWith('css-') && !c.startsWith('sc-') && !c.startsWith('styled-')
            );
            if (cls) seg += `.${cls}`;
          }
          const siblings = Array.from(current.parentElement?.children || []);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(current) + 1;
            seg += `:nth-child(${idx})`;
          }
          path.unshift(seg);
          current = current.parentElement;
          depth++;
        }
        return path.join(' > ');
      }

      function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      }

      const elements = [];
      const seen = new Set();

      // 导航链接
      document.querySelectorAll('nav a, nav button, [role="navigation"] a, header a, header button').forEach(el => {
        if (!isVisible(el) || seen.has(el)) return;
        seen.add(el);
        elements.push({
          type: 'nav',
          text: el.textContent?.trim().slice(0, 50) || '',
          selector: getSelector(el),
          href: el.href || '',
        });
      });

      // CTA / 主要按钮
      document.querySelectorAll('button, [role="button"], a[class*="btn"], a[class*="cta"], a[class*="button"], [class*="cta"], [class*="hero"] a').forEach(el => {
        if (!isVisible(el) || seen.has(el)) return;
        seen.add(el);
        const text = el.textContent?.trim().slice(0, 50) || '';
        if (text.length < 2) return;
        elements.push({
          type: 'button',
          text,
          selector: getSelector(el),
          href: el.href || el.getAttribute('onclick') ? true : false,
        });
      });

      // 功能区域/章节
      document.querySelectorAll('section, [class*="feature"], [class*="section"], [id*="feature"], [id*="section"]').forEach(el => {
        if (!isVisible(el) || seen.has(el)) return;
        seen.add(el);
        const heading = el.querySelector('h1, h2, h3, h4');
        elements.push({
          type: 'section',
          text: heading?.textContent?.trim().slice(0, 80) || el.id || '',
          selector: getSelector(el),
        });
      });

      // 表单输入
      document.querySelectorAll('input[type="text"], input[type="email"], input[type="search"], input:not([type]), textarea').forEach(el => {
        if (!isVisible(el) || seen.has(el)) return;
        seen.add(el);
        elements.push({
          type: 'input',
          text: el.placeholder || el.getAttribute('aria-label') || el.name || '',
          selector: getSelector(el),
        });
      });

      // Tab / 切换
      document.querySelectorAll('[role="tab"], [class*="tab"], [class*="toggle"]').forEach(el => {
        if (!isVisible(el) || seen.has(el)) return;
        seen.add(el);
        elements.push({
          type: 'tab',
          text: el.textContent?.trim().slice(0, 50) || '',
          selector: getSelector(el),
        });
      });

      // 页面内容概要
      const headings = [];
      document.querySelectorAll('h1, h2, h3').forEach(h => {
        if (isVisible(h)) headings.push(h.textContent?.trim().slice(0, 100));
      });

      const bodyClone = document.body.cloneNode(true);
      bodyClone.querySelectorAll('script, style, noscript, svg, img').forEach(el => el.remove());
      const textContent = bodyClone.innerText?.replace(/\n{3,}/g, '\n\n').slice(0, 3000) || '';

      return {
        title: document.title || '',
        url: window.location.href,
        elements: elements.slice(0, 30), // 限制数量
        headings: headings.slice(0, 15),
        textContent,
      };
    });
  }

  /**
   * 使用 LLM 规划智能浏览路径
   */
  async planBrowsingPath(pageStructure, customHeaders = {}) {
    const elementsList = pageStructure.elements
      .map((el, i) => `[${i}] ${el.type}: "${el.text}" → ${el.selector}`)
      .join('\n');

    const headingsList = pageStructure.headings
      .map((h, i) => `${i + 1}. ${h}`)
      .join('\n');

    const styleGuide = {
      professional: '专业简洁，像一个产品经理在做演示',
      casual: '轻松亲切，像在给朋友展示产品',
      energetic: '充满激情，像发布会演讲者',
    }[this.style] || '专业简洁';

    const prompt = `你是一位专业的 Demo 视频导演。你需要根据以下网页的结构和内容，规划一条引人入胜的浏览路径，让观众像被带着逛网站一样了解这个产品。

## 网页信息
标题：${pageStructure.title}
地址：${pageStructure.url}

## 页面内容摘要
${pageStructure.textContent.slice(0, 1500)}

## 页面标题结构
${headingsList}

## 可交互元素（带编号）
${elementsList}

## 规划要求
1. 起始步必须是 "wait"（展示首页全貌 3 秒）
2. 中间包含 2-4 次 "scroll"（滚动到不同区域），使用元素编号指定目标
3. 包含 1-3 次 "click"（点击重要按钮/Tab/导航），使用元素编号
4. 可包含 1 次 "hover"（悬停展示效果）
5. 结尾必须是 "wait"（展示最终画面 3 秒）
6. 每步的 description 必须是自然的解说词风格，就像你在边操作边解说
7. 总步骤 5-9 步，总浏览时长 30-90 秒
8. 风格：${styleGuide}

请严格返回 JSON 数组，不要加 \`\`\` 标记：
[
  {"type":"wait","description":"让我们先看看这个产品的首页全貌","duration":3000},
  {"type":"scroll","elementIndex":3,"description":"现在滚动到核心功能区，看看它都有哪些能力"},
  {"type":"click","elementIndex":2,"description":"点击这个按钮，体验一下实际交互效果"},
  ...
]`;

    try {
      const response = await this.llmClient.invoke(
        [{ role: 'user', content: prompt }],
        { model: 'doubao-seed-2-0-lite-260215', temperature: 0.6 }
      );

      let text = response.content || '';
      // 提取 JSON 数组
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('LLM 返回格式异常，使用默认路径');
        return this.getDefaultPlan(pageStructure);
      }

      const steps = JSON.parse(jsonMatch[0]);
      // 验证并修正步骤
      return steps.map(step => ({
        type: step.type || 'wait',
        elementIndex: step.elementIndex ?? null,
        description: step.description || '浏览页面',
        duration: step.duration || 3000,
      }));
    } catch (error) {
      console.error('LLM 规划浏览路径失败:', error);
      return this.getDefaultPlan(pageStructure);
    }
  }

  /**
   * 降级：默认浏览路径
   */
  getDefaultPlan(pageStructure) {
    const steps = [
      { type: 'wait', elementIndex: null, description: '让我们先看看这个页面的全貌', duration: 3000 },
    ];

    // 滚动到各个 section
    const sections = pageStructure.elements.filter(e => e.type === 'section');
    sections.slice(0, 3).forEach((sec, i) => {
      const idx = pageStructure.elements.indexOf(sec);
      steps.push({
        type: 'scroll',
        elementIndex: idx,
        description: sec.text ? `接下来看看${sec.text}` : '继续往下浏览',
        duration: 2500,
      });
    });

    // 点击第一个 CTA 按钮
    const btn = pageStructure.elements.find(e => e.type === 'button');
    if (btn) {
      const idx = pageStructure.elements.indexOf(btn);
      steps.push({
        type: 'click',
        elementIndex: idx,
        description: btn.text ? `点击${btn.text}看看效果` : '点击这个按钮体验一下',
        duration: 3000,
      });
    }

    steps.push({ type: 'wait', elementIndex: null, description: '以上就是这个产品的主要功能展示', duration: 3000 });
    return steps;
  }

  /**
   * 执行浏览路径 - 带录屏帧捕获
   */
  async executeBrowsingPath(page, steps, pageStructure, frameCapture) {
    this.executedSteps = [];
    const elements = pageStructure.elements;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const element = step.elementIndex != null ? elements[step.elementIndex] : null;
      const executedStep = {
        index: i,
        type: step.type,
        description: step.description,
        elementText: element?.text || '',
        startTime: Date.now(),
      };

      try {
        switch (step.type) {
          case 'wait':
            await this.executeWait(page, step.duration, frameCapture);
            break;
          case 'scroll':
            await this.executeScroll(page, element, step.duration, frameCapture);
            break;
          case 'click':
            await this.executeClick(page, element, step.duration, frameCapture);
            break;
          case 'hover':
            await this.executeHover(page, element, step.duration, frameCapture);
            break;
          case 'type':
            await this.executeType(page, element, step, frameCapture);
            break;
          default:
            await this.executeWait(page, 2000, frameCapture);
        }
      } catch (err) {
        console.error(`步骤 ${i} 执行失败:`, err.message);
        // 降级：等待一下继续
        await delay(1500);
      }

      executedStep.endTime = Date.now();
      executedStep.duration = executedStep.endTime - executedStep.startTime;

      // 捕获步骤后的页面内容片段（用于生成精准解说）
      try {
        executedStep.visibleText = await page.evaluate(() => {
          const clone = document.body.cloneNode(true);
          clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
          const text = clone.innerText || '';
          // 只取可见区域附近的内容
          return text.replace(/\n{3,}/g, '\n\n').slice(0, 500);
        });
      } catch {
        executedStep.visibleText = '';
      }

      this.executedSteps.push(executedStep);
    }

    return this.executedSteps;
  }

  /**
   * 执行等待步骤 - 展示当前画面
   */
  async executeWait(page, duration, frameCapture) {
    // 捕获当前画面并保持指定时长
    await frameCapture.capture(page, duration / 1000);
  }

  /**
   * 执行平滑滚动 - 带视觉指示器
   */
  async executeScroll(page, element, duration, frameCapture) {
    // 注入滚动指示器
    await page.evaluate(() => {
      const indicator = document.createElement('div');
      indicator.className = 'dv-scroll-indicator';
      const arrow = document.createElement('div');
      arrow.className = 'dv-scroll-arrow';
      document.body.appendChild(indicator);
      document.body.appendChild(arrow);
      setTimeout(() => { indicator.remove(); arrow.remove(); }, 3000);
    }).catch(() => {});

    if (element?.selector) {
      try {
        // 先检查元素是否存在
        const exists = await page.$(element.selector);
        if (exists) {
          // 平滑滚动到元素
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, element.selector);
        } else {
          // 元素不存在，执行通用滚动
          await page.evaluate(() => window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' }));
        }
      } catch {
        await page.evaluate(() => window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' }));
      }
    } else {
      await page.evaluate(() => window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' }));
    }

    // 滚动过程中持续捕获帧
    const scrollDuration = Math.min(duration, 2500);
    const frameCount = Math.ceil(scrollDuration / 200);
    for (let i = 0; i < frameCount; i++) {
      await delay(200);
      await frameCapture.capture(page, 0.2);
    }

    // 滚动到位后停留
    await frameCapture.capture(page, 1.5);
  }

  /**
   * 执行点击 - 带高亮和光圈效果
   */
  async executeClick(page, element, duration, frameCapture) {
    if (!element?.selector) {
      await this.executeWait(page, duration, frameCapture);
      return;
    }

    try {
      const exists = await page.$(element.selector);
      if (!exists) {
        await this.executeWait(page, duration, frameCapture);
        return;
      }

      // 获取元素位置
      const rect = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }, element.selector);

      if (rect) {
        // 添加高亮效果
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.classList.add('dv-highlight');
        }, element.selector);

        // 添加光圈效果
        await page.evaluate((cx, cy) => {
          const cursor = document.createElement('div');
          cursor.className = 'dv-cursor';
          cursor.style.left = cx + 'px';
          cursor.style.top = cy + 'px';
          document.body.appendChild(cursor);
          setTimeout(() => cursor.remove(), 1500);
        }, rect.cx, rect.cy);

        // 捕获高亮帧
        await frameCapture.capture(page, 1.0);

        // 执行点击
        try {
          await page.click(element.selector, { timeout: 3000 });
        } catch {
          // 点击可能被拦截，降级为 JS 点击
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) el.click();
          }, element.selector);
        }

        // 等待页面响应
        await delay(800);

        // 移除高亮
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.classList.remove('dv-highlight');
        }, element.selector).catch(() => {});

        // 捕获点击后画面
        await frameCapture.capture(page, Math.max(duration / 1000 - 1.8, 1.5));
      } else {
        await this.executeWait(page, duration, frameCapture);
      }
    } catch (err) {
      console.error('点击执行失败:', err.message);
      await this.executeWait(page, duration, frameCapture);
    }
  }

  /**
   * 执行悬停 - 展示 hover 效果
   */
  async executeHover(page, element, duration, frameCapture) {
    if (!element?.selector) {
      await this.executeWait(page, duration, frameCapture);
      return;
    }

    try {
      const exists = await page.$(element.selector);
      if (!exists) {
        await this.executeWait(page, duration, frameCapture);
        return;
      }

      // 捕获悬停前
      await frameCapture.capture(page, 0.5);

      // 执行悬停
      await page.hover(element.selector);
      await delay(500);

      // 添加高亮
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.classList.add('dv-highlight');
      }, element.selector).catch(() => {});

      // 捕获悬停效果
      await frameCapture.capture(page, Math.max(duration / 1000 - 1, 1.5));

      // 移除高亮
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.classList.remove('dv-highlight');
      }, element.selector).catch(() => {});
    } catch {
      await this.executeWait(page, duration, frameCapture);
    }
  }

  /**
   * 执行文本输入 - 模拟填写表单
   */
  async executeType(page, element, step, frameCapture) {
    if (!element?.selector) {
      await this.executeWait(page, step.duration, frameCapture);
      return;
    }

    try {
      // 点击输入框
      await page.click(element.selector).catch(() => {});
      await delay(300);

      // 逐字输入效果
      const sampleText = 'Demo';
      for (const char of sampleText) {
        await page.keyboard.type(char, { delay: 100 });
        await frameCapture.capture(page, 0.1);
      }

      await frameCapture.capture(page, 1.5);
    } catch {
      await this.executeWait(page, step.duration, frameCapture);
    }
  }
}
