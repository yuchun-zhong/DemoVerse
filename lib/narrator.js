/**
 * DemoVerse - 智能解说模块
 * 从整体脚本升级为按步骤生成、音画同步的解说
 * 
 * 核心改造：
 * 1. 根据每个浏览步骤的实际内容生成对应解说
 * 2. 每步独立 TTS，确保音画同步
 * 3. 生成 SRT 字幕文件
 */

import { LLMClient, TTSClient, Config } from 'coze-coding-dev-sdk';
import axios from 'axios';
import path from 'path';
import fs from 'fs';

/**
 * 风格对应的系统提示词
 */
const STYLE_PROMPTS = {
  professional: `你是一位专业的产品 Demo 解说员。你的解说精准克制，像一个资深产品经理在做演示。
规则：
1. 每段解说只描述当前操作展示的内容
2. 语言简洁专业，不说废话
3. 自然过渡，不要说"接下来我们来看"这种套话
4. 每段控制在 2-4 句话（约 30-60 字）
5. 不要使用 Markdown 格式，直接输出纯文本`,

  casual: `你是一位轻松亲切的产品解说员，像在给朋友展示一个酷产品。
规则：
1. 口语化表达，像聊天一样自然
2. 可以适当加语气词，但不要过多
3. 每段 2-4 句话（约 30-60 字）
4. 不要使用 Markdown 格式，直接输出纯文本`,

  energetic: `你是一位充满活力的产品解说员，像发布会的演讲者。
规则：
1. 用有力的短句，充满激情
2. 强调震撼效果和独特价值
3. 每段 2-4 句话（约 30-60 字）
4. 不要使用 Markdown 格式，直接输出纯文本`,
};

/**
 * 配音选项对应的 TTS speaker ID
 */
const VOICE_SPEAKERS = {
  yunxi_male: 'zh_male_dayi_saturn_bigtts',
  xiaoxiao_female: 'zh_female_bawudou_mars_bigtts',
};

/**
 * AI 解说模块 - 按步骤生成同步解说
 */
export class Narrator {
  constructor(customHeaders = {}, options = {}) {
    const config = new Config();
    this.llmClient = new LLMClient(config, customHeaders);
    this.ttsClient = new TTSClient(config, customHeaders);
    this.style = options.style || 'professional';
    this.voice = options.voice || 'yunxi_male';
  }

  /**
   * 根据浏览步骤生成每步的解说文本
   * @param {Array} browsingSteps - 规划的浏览步骤
   * @param {Array} executedSteps - 实际执行的步骤（含页面内容）
   * @param {object} pageData - 页面基本数据
   * @param {function} onProgress - 进度回调
   * @returns {Promise<Array<{index: number, text: string, duration: number}>>}
   */
  async generateStepNarrations(browsingSteps, executedSteps, pageData, onProgress = () => {}) {
    onProgress({ step: 'generating_script', message: 'AI 生成步骤解说...' });

    // 构建步骤上下文
    const stepsContext = browsingSteps.map((step, i) => {
      const executed = executedSteps[i] || {};
      const elementText = step.elementIndex != null
        ? (executed.elementText || '')
        : '';
      const visibleText = (executed.visibleText || '').slice(0, 200);

      return `步骤${i + 1} [${step.type}]: ${step.description}${elementText ? ` (元素: ${elementText})` : ''}${visibleText ? `\n当前页面内容: ${visibleText.slice(0, 150)}` : ''}`;
    }).join('\n\n');

    const systemPrompt = STYLE_PROMPTS[this.style] || STYLE_PROMPTS.professional;

    const prompt = `根据以下浏览步骤，为每一步生成对应的解说词。

## 产品信息
标题：${pageData.title || '未知'}
地址：${pageData.url || ''}

## 浏览步骤
${stepsContext}

## 要求
为每个步骤生成一段自然流畅的解说词，确保：
1. 解说内容和画面操作完全对应
2. 步骤之间自然衔接
3. 开头第一段要有吸引力，概括产品核心价值
4. 最后一段要有总结感
5. 每段 30-60 字

请严格返回 JSON 数组，不要加 \`\`\` 标记：
[
  {"index":0,"text":"解说文本..."},
  {"index":1,"text":"解说文本..."},
  ...
]`;

    try {
      const response = await this.llmClient.invoke(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        { model: 'doubao-seed-2-0-lite-260215', temperature: 0.7 }
      );

      let text = response.content || '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return this.getDefaultNarrations(browsingSteps, pageData);
      }

      const narrations = JSON.parse(jsonMatch[0]);
      return narrations.map((n, i) => ({
        index: n.index ?? i,
        text: n.text || browsingSteps[i]?.description || '浏览页面',
        duration: executedSteps[i]?.duration || 3000,
      }));
    } catch (error) {
      console.error('LLM 生成步骤解说失败:', error);
      return this.getDefaultNarrations(browsingSteps, pageData);
    }
  }

  /**
   * 降级：基于浏览步骤描述生成默认解说
   */
  getDefaultNarrations(browsingSteps, pageData) {
    const title = pageData.title || '这款产品';
    return browsingSteps.map((step, i) => {
      let text = step.description;
      if (i === 0) text = `欢迎体验${title}。${text}`;
      if (i === browsingSteps.length - 1) text = `${text}。以上就是${title}的主要功能展示`;
      return {
        index: i,
        text,
        duration: step.duration || 3000,
      };
    });
  }

  /**
   * 为每个步骤生成 TTS 音频
   * @param {Array} stepNarrations - 步骤解说数组
   * @param {string} jobId - 任务 ID
   * @param {function} onProgress - 进度回调
   * @returns {Promise<Array<{index: number, text: string, audioPath: string, audioDuration: number}>>}
   */
  async synthesizeStepAudio(stepNarrations, jobId, onProgress = () => {}) {
    onProgress({ step: 'generating_audio', message: '生成步骤配音...' });

    const workDir = path.join('/tmp', `demoverse_${jobId}`);
    const audioDir = path.join(workDir, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });

    const speaker = VOICE_SPEAKERS[this.voice] || VOICE_SPEAKERS.yunxi_male;
    const results = [];

    // 合并所有步骤文本为一次 TTS 调用（提高效率）
    // 用分隔符标记每段
    const SEPARATOR = '---STEP---';
    const fullText = stepNarrations.map(n => n.text).join(` ${SEPARATOR} `);

    try {
      const response = await this.ttsClient.synthesize({
        uid: `demoverse_${jobId}`,
        text: fullText,
        speaker: speaker,
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      // 下载完整音频
      const fullAudioPath = path.join(audioDir, 'full_narration.mp3');
      const audioResponse = await axios.get(response.audioUri, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      fs.writeFileSync(fullAudioPath, audioResponse.data);

      // 获取音频总时长
      const totalAudioDuration = await this.getAudioDuration(fullAudioPath);

      // 按文本比例估算每段音频时长
      const textLengths = stepNarrations.map(n => n.text.length);
      const totalTextLength = textLengths.reduce((a, b) => a + b, 0);

      let currentTime = 0;
      for (let i = 0; i < stepNarrations.length; i++) {
        const ratio = textLengths[i] / totalTextLength;
        const segmentDuration = totalAudioDuration * ratio;

        results.push({
          index: i,
          text: stepNarrations[i].text,
          audioPath: fullAudioPath,
          audioStartTime: currentTime,
          audioDuration: segmentDuration,
        });

        currentTime += segmentDuration;
      }

      onProgress({ step: 'audio_generated', message: '步骤配音生成完成' });
    } catch (error) {
      console.error('TTS 生成音频失败:', error);
      onProgress({ step: 'audio_failed', message: '音频生成失败，将生成无声视频' });

      // 降级：无音频
      for (let i = 0; i < stepNarrations.length; i++) {
        results.push({
          index: i,
          text: stepNarrations[i].text,
          audioPath: null,
          audioStartTime: 0,
          audioDuration: stepNarrations[i].duration / 1000,
        });
      }
    }

    return results;
  }

  /**
   * 获取音频文件时长（秒）
   */
  async getAudioDuration(audioPath) {
    const ffmpeg = (await import('fluent-ffmpeg')).default;
    return new Promise((resolve) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err || !metadata?.format?.duration) {
          console.error('获取音频时长失败:', err?.message);
          resolve(30); // 默认 30 秒
          return;
        }
        resolve(metadata.format.duration);
      });
    });
  }

  /**
   * 生成 SRT 字幕文件
   * @param {Array} audioSegments - 音频分段数组
   * @returns {string} SRT 文件路径
   */
  async generateSRT(audioSegments, jobId) {
    const workDir = path.join('/tmp', `demoverse_${jobId}`);
    const srtPath = path.join(workDir, 'subtitles.srt');

    const lines = [];
    for (let i = 0; i < audioSegments.length; i++) {
      const seg = audioSegments[i];
      const startTime = this.formatSRTTime(seg.audioStartTime);
      const endTime = this.formatSRTTime(seg.audioStartTime + seg.audioDuration);

      lines.push(`${i + 1}`);
      lines.push(`${startTime} --> ${endTime}`);
      lines.push(seg.text);
      lines.push('');
    }

    fs.writeFileSync(srtPath, lines.join('\n'));
    return srtPath;
  }

  /**
   * 格式化 SRT 时间戳
   */
  formatSRTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  /**
   * 生成 ASS 字幕文件（支持样式控制）
   */
  async generateASS(audioSegments, jobId) {
    const workDir = path.join('/tmp', `demoverse_${jobId}`);
    const assPath = path.join(workDir, 'subtitles.ass');

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

  /**
   * 格式化 ASS 时间戳
   */
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
