/**
 * DemoVerse - AI 解说模块
 * 产品级解说脚本生成 + 分段 TTS + SRT/ASS 字幕
 * 
 * 解说结构：开场（产品定位）→ 中间（功能详解）→ 结尾（价值总结+引导）
 * 每步解说与画面完全同步
 */

import fs from 'fs';
import path from 'path';
import { LLMClient, TTSClient, Config } from 'coze-coding-dev-sdk';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// TTS speaker 映射
const VOICE_MAP = {
  yunxi_male: 'zh_male_dayi_saturn_bigtts',
  xiaoxiao_female: 'zh_female_xiaohe_uranus_bigtts',
};

export class Narrator {
  constructor(customHeaders = {}, options = {}) {
    const config = new Config();
    this.llmClient = new LLMClient(config, customHeaders);
    this.tts = new TTSClient(config, customHeaders);
    this.style = options.style || 'professional';
    this.voice = options.voice || 'yunxi_male';
    this.options = options;
  }

  /**
   * 为每个浏览步骤生成产品级解说词
   * 
   * 解说词结构要求：
   * - 开场步：产品名+一句话定位+解决什么痛点
   * - 功能展示步：功能的作用和亮点，不只是"我点击了XX"
   * - 交互演示步：操作的意义和效果
   * - 结尾步：总结产品价值，引导行动
   */
  async generateStepNarrations(browsingSteps, executedSteps, pageData, onProgress = () => {}) {
    onProgress({ step: 'generating_script', message: 'AI 生成产品级解说脚本...' });

    const stepDetails = executedSteps.map((step, i) => {
      const planStep = browsingSteps[i] || {};
      return `步骤${i + 1} [${step.type}]: ${planStep.description || step.description || '浏览页面'}
${step.visibleText?.slice(0, 300) || '(无可见文本)'}`.trim();
    }).join('\n\n');

    const styleGuide = {
      professional: `你是资深产品经理，正在做正式的产品演示。语气沉稳有力，用词精准专业。
- 用"这个功能"而非"我点击了"
- 每句解说要传递信息：这个功能是什么、为什么重要、怎么用
- 避免空话，每句话都有实质内容`,
      casual: `你是在给朋友展示一个好用的工具，语气自然亲切、口语化但不啰嗦。
- 用"你看这里"而非"现在我点击"
- 用日常语言解释功能，避免过于技术化
- 偶尔加"特别好用""很方便"之类的口语评价`,
      energetic: `你是发布会演讲者，充满激情！短句有力，节奏明快。
- 用感叹号传递热情："这就是核心功能！"
- 短句为主，3-5秒一句
- 突出亮点和震撼效果`,
    }[this.style] || '专业简洁';

    const prompt = `你是一位顶尖的 Demo 视频解说员。请为以下网页演示的每个步骤，生成专业、引人入胜的解说词。

## 产品信息
标题：${pageData.title || '未知产品'}
地址：${pageData.url}
描述：${pageData.meta?.description || pageData.meta?.['og:description'] || ''}

## 演示步骤及页面内容
${stepDetails}

## 解说词写作要求（极其重要）

${styleGuide}

### 结构要求
1. **第一步（开场）**：必须包含——产品名称、一句话定位、解决什么痛点。例如："这是 DemoVerse，一个用 AI 自动生成产品 Demo 视频的智能工具，让你的项目展示不再费力。"
2. **中间步骤（功能展示）**：每步解说 2-3 句话（50-90 字），要讲清楚：
   - 这个功能/区域是干什么的
   - 它的亮点或独特价值
   - 观众为什么要关注它
3. **最后一步（结尾）**：总结产品价值 + 引导行动。例如："DemoVerse 让 Demo 视频制作从数小时缩短到几分钟，立即试试吧！"

### 质量标准
- 每步解说时长控制在 3-6 秒（50-90 字中文）
- 绝对不要说"我现在点击了XX""我往下滚动"这类无意义描述
- 每句话必须传递实质信息（功能是什么/为什么重要/怎么用）
- 步骤之间要有自然的衔接和递进
- 用"这里""这个功能""接下来"等过渡词串联

请返回 JSON 数组，每项包含 text 字段，不要加 \`\`\` 标记：
[
  {"text": "这是 XXX，一个帮助开发者实现 YYY 的智能平台，让你从此告别 ZZZ 的烦恼。"},
  {"text": "这里是核心功能区，包含智能分析和实时监控两大能力，所有数据一目了然。"},
  ...
]`;

    try {
      const response = await this.llmClient.invoke(
        [{ role: 'user', content: prompt }],
        { model: 'doubao-seed-2-0-lite-260215', temperature: 0.6 }
      );

      let text = response.content || '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('LLM 返回格式异常，使用默认解说');
        return this.getDefaultNarrations(executedSteps, pageData);
      }

      const narrations = JSON.parse(jsonMatch[0]);

      // 合并步骤信息
      return narrations.map((n, i) => ({
        ...n,
        stepIndex: i,
        stepType: executedSteps[i]?.type || 'wait',
        stepDuration: executedSteps[i]?.duration || 3000,
      }));
    } catch (error) {
      console.error('LLM 解说生成失败:', error);
      return this.getDefaultNarrations(executedSteps, pageData);
    }
  }

  /**
   * 降级：默认解说词
   */
  getDefaultNarrations(executedSteps, pageData) {
    const productName = pageData.title || '这款产品';
    const stepCount = executedSteps.length;

    return executedSteps.map((step, i) => {
      let text;
      if (i === 0) {
        text = `这是${productName}，一个强大的智能工具，帮助你更高效地完成工作。`;
      } else if (i === stepCount - 1) {
        text = `以上就是${productName}的主要功能展示，期待你的体验！`;
      } else {
        text = step.description || `继续探索${productName}的更多功能。`;
      }
      return {
        text,
        stepIndex: i,
        stepType: step.type || 'wait',
        stepDuration: step.duration || 3000,
      };
    });
  }

  /**
   * 分段 TTS 合成 - 每步解说独立合成音频
   */
  async synthesizeStepAudio(stepNarrations, jobId, onProgress = () => {}) {
    onProgress({ step: 'generating_audio', message: 'AI 合成语音...' });

    const audioSegments = [];
    let cumulativeTime = 0;

    for (let i = 0; i < stepNarrations.length; i++) {
      const narration = stepNarrations[i];
      const audioFilename = `step_${i}_${jobId}.mp3`;
      const audioPath = path.join('/tmp', `demoverse_${jobId}`, audioFilename);

      try {
        const ttsResult = await this.tts.synthesize({
          uid: jobId,
          text: narration.text,
          speaker: VOICE_MAP[this.voice] || 'zh_male_dayi_saturn_bigtts',
          audioFormat: 'mp3',
          sampleRate: 24000,
        });

        // Download audio from URI
        const axios = (await import('axios')).default;
        const audioResponse = await axios.get(ttsResult.audioUri, { responseType: 'arraybuffer' });
        fs.writeFileSync(audioPath, Buffer.from(audioResponse.data));

        const stats = fs.statSync(audioPath);
        const audioDuration = stats.size > 0 ? Math.max(stats.size / 16000, 0.5) : narration.stepDuration / 1000;

        audioSegments.push({
          text: narration.text,
          audioPath,
          audioStartTime: cumulativeTime,
          audioDuration,
          stepIndex: i,
        });

        cumulativeTime += audioDuration + 0.3; // 步骤间 0.3s 停顿
        onProgress({ step: 'audio_generated', message: `语音合成 ${i + 1}/${stepNarrations.length}` });
      } catch (err) {
        console.error(`步骤 ${i} TTS 失败:`, err.message);
        audioSegments.push({
          text: narration.text,
          audioPath: null,
          audioStartTime: cumulativeTime,
          audioDuration: narration.stepDuration / 1000,
          stepIndex: i,
        });
        cumulativeTime += narration.stepDuration / 1000;
        onProgress({ step: 'audio_failed', message: `步骤 ${i} 语音合成失败，跳过` });
      }
    }

    return audioSegments;
  }

  /**
   * 生成 SRT 字幕文件
   */
  async generateSRT(audioSegments, jobId) {
    const srtPath = path.join('/tmp', `demoverse_${jobId}`, 'subtitles.srt');

    const entries = audioSegments.map((seg, i) => {
      const start = this.formatSRTTime(seg.audioStartTime);
      const end = this.formatSRTTime(seg.audioStartTime + seg.audioDuration);
      return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
    });

    fs.writeFileSync(srtPath, entries.join('\n'));
    return srtPath;
  }

  formatSRTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  /**
   * 生成 ASS 字幕文件（更高质量的渲染效果）
   */
  async generateASS(audioSegments, jobId) {
    const assPath = path.join('/tmp', `demoverse_${jobId}`, 'subtitles.ass');
    const header = `[Script Info]
Title: DemoVerse Subtitles
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Inter,18,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,1,2,1,2,10,10,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const events = [];
    for (const seg of audioSegments) {
      const start = this.formatASSTime(seg.audioStartTime);
      const end = this.formatASSTime(seg.audioStartTime + seg.audioDuration);
      const text = seg.text.replace(/\n/g, '\\N');
      events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
    }

    fs.writeFileSync(assPath, header + events.join('\n') + '\n');
    return assPath;
  }

  formatASSTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.round((seconds % 1) * 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  /**
   * 完整解说流程：步骤解说 + TTS + 字幕
   */
  async createStepNarration(browsingSteps, executedSteps, pageData, jobId, onProgress = () => {}) {
    // Step 1: 生成每步解说文本
    const stepNarrations = await this.generateStepNarrations(
      browsingSteps, executedSteps, pageData, onProgress
    );

    // 拼接完整脚本
    const fullScript = stepNarrations.map(n => n.text).join('\n');

    // Step 2: TTS 合成
    const audioSegments = await this.synthesizeStepAudio(stepNarrations, jobId, onProgress);

    // Step 3: 生成字幕文件
    let srtPath = null;
    let assPath = null;
    try {
      srtPath = await this.generateSRT(audioSegments, jobId);
      assPath = await this.generateASS(audioSegments, jobId);
    } catch (err) {
      console.error('字幕生成失败:', err.message);
    }

    return {
      script: fullScript,
      stepNarrations,
      audioSegments,
      srtPath,
      assPath,
    };
  }
}
