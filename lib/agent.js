/**
 * DemoVerse - 智能页面探索 Agent
 * 带着用户逛网站，像产品经理做演示
 * 
 * 核心能力：
 * 1. 深度分析页面结构，识别所有重要模块
 * 2. 用 LLM 规划完整的产品演示路径（开场→核心功能→交互演示→亮点→结尾）
 * 3. 自动执行交互（点击、滚动、悬停、输入），每步停留足够时间
 * 4. 每步动作带视觉反馈（高亮、光圈、缩放）
 * 5. 支持多页签/导航跳转的完整演示
 */

import { LLMClient, Config } from 'coze-coding-dev-sdk';

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
          50% { box-shadow: 0 0 0 12px rgba(139,92,246,0.15); }
          100% { box-shadow: 0 0 0 0 rgba(139,92,246,0); }
        }
        @keyframes dv-cursor-ring {
          0% { transform: translate(-50%,-50%) scale(0.5); opacity: 0; }
          20% { transform: translate(-50%,-50%) scale(1); opacity: 1; }
          80% { transform: translate(-50%,-50%) scale(1); opacity: 0.6; }
          100% { transform: translate(-50%,-50%) scale(1.5); opacity: 0; }
        }
        @keyframes dv-focus-zoom {
          0% { transform: scale(1); }
          50% { transform: scale(1.02); }
          100% { transform: scale(1); }
        }
        .dv-highlight {
          outline: 3px solid rgba(139,92,246,0.9) !important;
          outline-offset: 4px !important;
          animation: dv-highlight-pulse 1.5s ease-out !important;
          transition: outline 0.15s ease !important;
          z-index: 99998 !important;
          position: relative !important;
        }
        .dv-cursor {
          position: fixed !important;
          width: 44px !important;
          height: 44px !important;
          border-radius: 50% !important;
          background: rgba(139,92,246,0.25) !important;
          border: 2px solid rgba(139,92,246,0.8) !important;
          pointer-events: none !important;
          z-index: 99999 !important;
          animation: dv-cursor-ring 1.5s ease-out forwards !important;
        }
        .dv-focus-area {
          animation: dv-focus-zoom 0.8s ease-in-out !important;
          transform-origin: center center !important;
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
   * 深度提取页面可交互元素和内容结构
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
          text: el.textContent?.trim().slice(0, 80) || '',
          selector: getSelector(el),
          href: el.href || '',
        });
      });

      // CTA / 主要按钮
      document.querySelectorAll('button, [role="button"], a[class*="btn"], a[class*="cta"], a[class*="button"], [class*="cta"], [class*="hero"] a').forEach(el => {
        if (!isVisible(el) || seen.has(el)) return;
        seen.add(el);
        const text = el.textContent?.trim().slice(0, 80) || '';
        if (text.length < 2) return;
        elements.push({
          type: 'button',
          text,
          selector: getSelector(el),
          href: el.href || '',
        });
      });

      // 功能区域/章节
      document.querySelectorAll('section, [class*="feature"], [class*="section"], [id*="feature"], [id*="section"], [class*="pricing"], [id*="pricing"], [class*="testimonial"], [class*="faq"]').forEach(el => {
        if (!isVisible(el) || seen.has(el)) return;
        seen.add(el);
        const heading = el.querySelector('h1, h2, h3, h4');
        elements.push({
          type: 'section',
          text: heading?.textContent?.trim().slice(0, 120) || el.id || '',
          selector: getSelector(el),
        });
      });

      // 表单输入
      document.querySelectorAll('input[type="text"], input[type="email"], input[type="search"], input[type="url"], input:not([type]), textarea, select').forEach(el => {
        if (!isVisible(el) || seen.has(el)) return;
        seen.add(el);
        elements.push({
          type: 'input',
          text: el.placeholder || el.getAttribute('aria-label') || el.name || '',
          selector: getSelector(el),
        });
      });

      // Tab / 切换 / Toggle
      document.querySelectorAll('[role="tab"], [class*="tab"], [class*="toggle"], [role="switch"]').forEach(el => {
        if (!isVisible(el) || seen.has(el)) return;
        seen.add(el);
        elements.push({
          type: 'tab',
          text: el.textContent?.trim().slice(0, 80) || '',
          selector: getSelector(el),
        });
      });

      // 卡片 / 链接组
      document.querySelectorAll('[class*="card"] a, article a, [class*="item"] a').forEach(el => {
        if (!isVisible(el) || seen.has(el)) return;
        seen.add(el);
        const text = el.textContent?.trim().slice(0, 80) || '';
        if (text.length < 3) return;
        elements.push({
          type: 'link',
          text,
          selector: getSelector(el),
          href: el.href || '',
        });
      });

      // 页面内容概要
      const headings = [];
      document.querySelectorAll('h1, h2, h3').forEach(h => {
        if (isVisible(h)) headings.push(h.textContent?.trim().slice(0, 150));
      });

      const bodyClone = document.body.cloneNode(true);
      bodyClone.querySelectorAll('script, style, noscript, svg, img').forEach(el => el.remove());
      const textContent = bodyClone.innerText?.replace(/\n{3,}/g, '\n\n').slice(0, 5000) || '';

      // 页面元信息
      const meta = {};
      document.querySelectorAll('meta[name], meta[property]').forEach(el => {
        const key = el.getAttribute('name') || el.getAttribute('property');
        const val = el.getAttribute('content');
        if (key && val) meta[key] = val.slice(0, 200);
      });

      return {
        title: document.title || '',
        url: window.location.href,
        elements: elements.slice(0, 40),
        headings: headings.slice(0, 20),
        textContent,
        meta,
      };
    });
  }

  /**
   * 使用 LLM 规划完整的智能浏览路径
   * 要求：像产品演示视频一样，开场→核心功能→交互→亮点→结尾
   */
  async planBrowsingPath(pageStructure, customHeaders = {}) {
    const elementsList = pageStructure.elements
      .map((el, i) => `[${i}] ${el.type}: "${el.text}" → ${el.selector}${el.href ? ` (href: ${el.href.slice(0, 80)})` : ''}`)
      .join('\n');

    const headingsList = pageStructure.headings
      .map((h, i) => `${i + 1}. ${h}`)
      .join('\n');

    const styleGuide = {
      professional: '专业简洁，像一个资深产品经理在做正式演示，语气沉稳有力',
      casual: '轻松亲切，像在给朋友展示一个好用的工具，自然口语化',
      energetic: '充满激情，像发布会演讲者，短句有力，节奏明快',
    }[this.style] || '专业简洁';

    const prompt = `你是一位顶尖的 Demo 视频导演。你需要根据以下网页的结构和内容，规划一条完整的产品演示浏览路径，让观众看完后完全了解这个产品是什么、能做什么、怎么用。

## 网页信息
标题：${pageStructure.title}
地址：${pageStructure.url}
描述：${pageStructure.meta?.description || pageStructure.meta?.['og:description'] || '无'}

## 页面内容摘要
${pageStructure.textContent.slice(0, 3000)}

## 页面标题结构
${headingsList}

## 可交互元素（带编号）
${elementsList}

## 演示路径规划要求（极其重要）

你必须规划一条完整、专业、引人入胜的产品演示路径，就像苹果发布会或顶级 SaaS 产品的 Demo 视频：

### 结构要求（必须严格遵守）
1. **开场（1步 wait）**：展示首页全貌 4-5 秒，让观众对产品有第一印象
2. **核心功能展示（3-5 步）**：逐个展示产品的主要功能区域，每步停留 4-6 秒
   - 滚动到每个功能区域并停留讲解
   - 点击 Tab/按钮切换展示不同功能
   - 对重要交互进行实际点击演示
3. **交互演示（2-3 步）**：实际操作产品，展示真实使用场景
   - 在输入框填入示例内容（type 类型）
   - 点击 CTA 按钮触发功能
   - 切换 Tab 展示不同视图
4. **亮点展示（1-2 步）**：展示产品最有吸引力的特色
   - 悬停展示动态效果
   - 滚动到定价/案例/评价区
5. **结尾（1步 wait）**：展示最终画面 4-5 秒

### 关键规则
- 总步骤 10-16 步（确保 60-90 秒完整演示）
- 每步 duration: wait 4000-5000ms, scroll 3000-4000ms, click 4000-5000ms, hover 3500-4500ms, type 4000-5000ms
- description 必须是产品级的解说词，不是"我点击了XX"
  - 好的示例："这里展示了智能数据分析功能，可以实时监控业务关键指标"
  - 坏的示例："点击了这个按钮" / "往下滚动页面"
- 优先使用元素编号（elementIndex）来精确定位
- 如果有表单输入框，必须包含 type 步骤来演示填写
- style: ${styleGuide}

请严格返回 JSON 数组，不要加 \`\`\` 标记：
[
  {"type":"wait","description":"这是 XXX 产品，一个帮助用户实现 YYY 的强大工具","duration":5000},
  {"type":"scroll","elementIndex":2,"description":"这里展示了产品的核心功能区，包含 A、B、C 三大能力","duration":4000},
  {"type":"click","elementIndex":5,"description":"点击数据分析 Tab，可以看到实时的业务数据看板","duration":4500},
  {"type":"type","elementIndex":8,"description":"在搜索框输入关键词，快速定位目标内容","duration":4000,"inputText":"智能分析"},
  ...
]`;

    try {
      const response = await this.llmClient.invoke(
        [{ role: 'user', content: prompt }],
        { model: 'doubao-seed-2-0-lite-260215', temperature: 0.5 }
      );

      let text = response.content || '';
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
        duration: Math.max(step.duration || 3000, 2500), // 保证每步至少2.5秒
        inputText: step.inputText || '',
      }));
    } catch (error) {
      console.error('LLM 规划浏览路径失败:', error);
      return this.getDefaultPlan(pageStructure);
    }
  }

  /**
   * 降级：默认完整浏览路径
   */
  getDefaultPlan(pageStructure) {
    const steps = [];
    const elements = pageStructure.elements;

    // 开场
    steps.push({
      type: 'wait', elementIndex: null,
      description: `欢迎了解${pageStructure.title || '这款产品'}，让我们一起看看它的核心功能`,
      duration: 5000,
    });

    // 滚动到各个 section
    const sections = elements.filter(e => e.type === 'section');
    sections.slice(0, 4).forEach((sec) => {
      const idx = elements.indexOf(sec);
      steps.push({
        type: 'scroll', elementIndex: idx,
        description: sec.text ? `这里展示了${sec.text}模块` : '继续探索产品功能',
        duration: 4000,
      });
    });

    // 点击 CTA
    const buttons = elements.filter(e => e.type === 'button');
    buttons.slice(0, 2).forEach((btn) => {
      const idx = elements.indexOf(btn);
      steps.push({
        type: 'click', elementIndex: idx,
        description: `点击${btn.text}，体验实际交互效果`,
        duration: 4500,
      });
    });

    // Tab 切换
    const tabs = elements.filter(e => e.type === 'tab');
    if (tabs.length > 0) {
      const idx = elements.indexOf(tabs[0]);
      steps.push({
        type: 'click', elementIndex: idx,
        description: `切换到${tabs[0].text}视图，查看更多功能`,
        duration: 4000,
      });
    }

    // 输入演示
    const inputs = elements.filter(e => e.type === 'input');
    if (inputs.length > 0) {
      const idx = elements.indexOf(inputs[0]);
      steps.push({
        type: 'type', elementIndex: idx,
        description: `在输入框中输入示例内容，演示实际操作流程`,
        duration: 4000,
        inputText: 'Demo',
      });
    }

    // 悬停效果
    const hoverable = elements.filter(e => e.type === 'nav' || e.type === 'link');
    if (hoverable.length > 0) {
      const idx = elements.indexOf(hoverable[0]);
      steps.push({
        type: 'hover', elementIndex: idx,
        description: '悬停查看交互细节',
        duration: 3500,
      });
    }

    // 结尾
    steps.push({
      type: 'wait', elementIndex: null,
      description: `以上就是${pageStructure.title || '这款产品'}的主要功能展示，期待你的体验`,
      duration: 5000,
    });

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
            await this.executeWait(page, 3000, frameCapture);
        }
      } catch (err) {
        console.error(`步骤 ${i} 执行失败:`, err.message);
        await delay(2000);
      }

      executedStep.endTime = Date.now();
      executedStep.duration = executedStep.endTime - executedStep.startTime;

      // 捕获步骤后的页面内容片段（用于生成精准解说）
      try {
        executedStep.visibleText = await page.evaluate(() => {
          const clone = document.body.cloneNode(true);
          clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
          const text = clone.innerText || '';
          return text.replace(/\n{3,}/g, '\n\n').slice(0, 800);
        });
      } catch {
        executedStep.visibleText = '';
      }

      this.executedSteps.push(executedStep);
    }

    return this.executedSteps;
  }

  /**
   * 执行等待步骤 - 展示当前画面，捕获多帧保持流畅
   */
  async executeWait(page, duration, frameCapture) {
    // 捕获多帧保持流畅
    const frames = Math.max(2, Math.ceil(duration / 1500));
    const frameDuration = duration / frames / 1000;
    for (let i = 0; i < frames; i++) {
      await frameCapture.capture(page, frameDuration);
    }
  }

  /**
   * 执行平滑滚动 - 带视觉指示器和连续帧捕获
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
      setTimeout(() => { indicator.remove(); arrow.remove(); }, 4000);
    }).catch(() => {});

    if (element?.selector) {
      try {
        const exists = await page.$(element.selector);
        if (exists) {
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, element.selector);
        } else {
          await page.evaluate(() => window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' }));
        }
      } catch {
        await page.evaluate(() => window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' }));
      }
    } else {
      await page.evaluate(() => window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' }));
    }

    // 滚动过程中持续捕获帧（更密集，保证流畅）
    const scrollDuration = Math.min(duration, 3000);
    const frameCount = Math.ceil(scrollDuration / 150);
    for (let i = 0; i < frameCount; i++) {
      await delay(150);
      await frameCapture.capture(page, 0.15);
    }

    // 滚动到位后停留，捕获稳定画面
    await frameCapture.capture(page, 2.5);
  }

  /**
   * 执行点击 - 带高亮、光圈和聚焦效果
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
        // 捕获点击前画面
        await frameCapture.capture(page, 0.5);

        // 添加高亮 + 光圈效果
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) { el.classList.add('dv-highlight'); el.classList.add('dv-focus-area'); }
        }, element.selector);

        await page.evaluate((cx, cy) => {
          const cursor = document.createElement('div');
          cursor.className = 'dv-cursor';
          cursor.style.left = cx + 'px';
          cursor.style.top = cy + 'px';
          document.body.appendChild(cursor);
          setTimeout(() => cursor.remove(), 1500);
        }, rect.cx, rect.cy);

        // 捕获高亮帧
        await frameCapture.capture(page, 1.2);

        // 执行点击，检测是否触发页面导航
        let navigated = false;
        try {
          const [response] = await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => null),
            page.click(element.selector, { timeout: 3000 }),
          ]);
          if (response) navigated = true;
        } catch {
          try {
            await page.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (el) el.click();
            }, element.selector);
            await delay(1500);
          } catch {}
        }

        // 等待页面响应
        if (navigated) {
          await delay(2000);
        } else {
          await delay(1000);
        }

        // 移除高亮（安全调用，忽略导航后的 frame 失效）
        try {
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) { el.classList.remove('dv-highlight'); el.classList.remove('dv-focus-area'); }
          }, element.selector);
        } catch {}

        // 捕获点击后画面（多帧保持流畅）
        const remainingDuration = Math.max(duration / 1000 - 2.7, 1.5);
        const frames = Math.ceil(remainingDuration / 1.2);
        for (let i = 0; i < frames; i++) {
          await frameCapture.capture(page, remainingDuration / frames);
        }
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
      await frameCapture.capture(page, 0.8);

      // 执行悬停
      await page.hover(element.selector);
      await delay(600);

      // 添加高亮
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.classList.add('dv-highlight');
      }, element.selector).catch(() => {});

      // 捕获悬停效果（多帧）
      const hoverDuration = Math.max(duration / 1000 - 1.4, 2.0);
      const frames = Math.ceil(hoverDuration / 1.2);
      for (let i = 0; i < frames; i++) {
        await frameCapture.capture(page, hoverDuration / frames);
      }

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
   * 执行输入 - 模拟填写表单
   */
  async executeType(page, element, step, frameCapture) {
    if (!element?.selector) {
      await this.executeWait(page, step.duration, frameCapture);
      return;
    }

    try {
      const exists = await page.$(element.selector);
      if (!exists) {
        await this.executeWait(page, step.duration, frameCapture);
        return;
      }

      // 点击聚焦输入框
      await frameCapture.capture(page, 0.5);

      // 添加高亮
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.classList.add('dv-highlight');
      }, element.selector).catch(() => {});

      await frameCapture.capture(page, 0.8);

      // 点击输入框
      try {
        await page.click(element.selector, { timeout: 3000 });
      } catch {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.focus();
        }, element.selector);
      }

      await delay(300);

      // 清除已有内容并逐字输入
      const inputText = step.inputText || 'Demo';
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
      }, element.selector);

      // 逐字输入模拟（每个字符间短暂停顿）
      for (let i = 0; i < inputText.length; i++) {
        await page.keyboard.type(inputText[i], { delay: 80 });
        if (i % 2 === 0) {
          await frameCapture.capture(page, 0.2);
        }
      }

      await delay(500);

      // 移除高亮
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.classList.remove('dv-highlight');
      }, element.selector).catch(() => {});

      // 捕获输入后画面
      await frameCapture.capture(page, Math.max(step.duration / 1000 - 2.5, 1.5));
    } catch (err) {
      console.error('输入执行失败:', err.message);
      await this.executeWait(page, step.duration, frameCapture);
    }
  }
}
