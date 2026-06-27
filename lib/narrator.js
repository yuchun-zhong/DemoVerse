import { LLMClient, TTSClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import axios from 'axios';
import path from 'path';
import fs from 'fs';

/**
 * 风格对应的系统提示词
 */
const STYLE_PROMPTS = {
  professional: `你是一位专业的产品 Demo 解说员，擅长用简洁精准的语言介绍产品功能。
你的解说风格：
1. 开头用一句话概括产品核心价值
2. 按页面布局顺序介绍核心功能
3. 每个功能点用 1-2 句话概括，用语专业准确
4. 结尾给出有力的号召或总结
5. 总时长控制在 30-60 秒（约 100-200 字）
6. 语言风格专业克制，像一个严谨的产品经理在做演示
7. 不要使用 Markdown 格式，直接输出纯文本`,

  casual: `你是一位轻松亲切的产品解说员，像在给朋友展示一个酷产品。
你的解说风格：
1. 开头用轻松的方式吸引注意力，比如"嘿，来看看这个"
2. 像聊天一样介绍功能，口语化表达
3. 可以适当加一些感叹和语气词，但不要过多
4. 结尾自然地鼓励大家去试试
5. 总时长控制在 30-60 秒（约 100-200 字）
6. 语言轻松友好，像一个热心的朋友在安利
7. 不要使用 Markdown 格式，直接输出纯文本`,

  energetic: `你是一位充满活力的产品解说员，像发布会的演讲者一样激情澎湃。
你的解说风格：
1. 开头用强有力的感叹吸引注意力
2. 介绍功能时充满激情，用有力的短句
3. 强调每个功能的震撼效果和独特价值
4. 结尾用号召式的语言激发行动
5. 总时长控制在 30-60 秒（约 100-200 字）
6. 语言充满能量和感染力，像一个激情的演讲者
7. 不要使用 Markdown 格式，直接输出纯文本`,
};

/**
 * 配音选项对应的 TTS speaker ID
 */
const VOICE_SPEAKERS = {
  yunxi_male: 'zh_male_dayi_saturn_bigtts',
  xiaoxiao_female: 'zh_female_bawudou_mars_bigtts',
};

/**
 * AI 解说模块 - 使用 LLM 分析页面内容并生成 TTS 音频
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
   * 使用 LLM 生成 Demo 解说脚本
   * @param {object} pageData - 页面数据（title, textContent, url）
   * @param {string[]} screenshotPaths - 截图路径
   * @param {function} onProgress - 进度回调
   * @returns {Promise<string>} 解说脚本文本
   */
  async generateScript(pageData, screenshotPaths = [], onProgress = () => {}) {
    onProgress({ step: 'generating_script', message: 'AI 生成解说脚本...' });

    const contextInfo = `
页面标题: ${pageData.title || '未知'}
页面地址: ${pageData.url || '未知'}
页面内容摘要:
${(pageData.textContent || '').slice(0, 2000)}
`.trim();

    const systemPrompt = STYLE_PROMPTS[this.style] || STYLE_PROMPTS.professional;

    const messages = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: `请根据以下页面信息，生成一段 30-60 秒的 Demo 解说词：\n\n${contextInfo}`,
      },
    ];

    try {
      const response = await this.llmClient.invoke(messages, {
        model: 'doubao-seed-2-0-lite-260215',
        temperature: 0.7,
      });
      
      onProgress({ step: 'script_generated', message: '解说脚本生成完成' });
      return response.content;
    } catch (error) {
      console.error('LLM 生成脚本失败:', error);
      // 降级：生成基础解说
      return `欢迎体验${pageData.title || '这款产品'}。让我带你快速了解它的核心功能。这是一个精心设计的产品界面，提供了丰富的交互体验。感谢观看，快来亲自试试吧！`;
    }
  }

  /**
   * 使用 TTS 将解说脚本转换为音频
   * @param {string} script - 解说脚本
   * @param {string} jobId - 任务 ID
   * @param {function} onProgress - 进度回调
   * @returns {Promise<string|null>} 音频文件路径，失败返回 null
   */
  async generateAudio(script, jobId, onProgress = () => {}) {
    onProgress({ step: 'generating_audio', message: '生成解说音频...' });

    try {
      const speaker = VOICE_SPEAKERS[this.voice] || VOICE_SPEAKERS.yunxi_male;

      const response = await this.ttsClient.synthesize({
        uid: `demoverse_${jobId}`,
        text: script,
        speaker: speaker,
        audioFormat: 'mp3',
        sampleRate: 24000,
      });

      // 下载音频文件
      const workDir = path.join('/tmp', `demoverse_${jobId}`);
      fs.mkdirSync(workDir, { recursive: true });
      const audioPath = path.join(workDir, `narration_${jobId}.mp3`);

      const audioResponse = await axios.get(response.audioUri, {
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      fs.writeFileSync(audioPath, audioResponse.data);

      onProgress({ step: 'audio_generated', message: '解说音频生成完成' });
      return audioPath;
    } catch (error) {
      console.error('TTS 生成音频失败:', error);
      onProgress({ step: 'audio_failed', message: '音频生成失败，将生成无声视频' });
      return null;
    }
  }

  /**
   * 完整解说流程：生成脚本 + 生成音频
   * @param {object} pageData - 页面数据
   * @param {string[]} screenshotPaths - 截图路径
   * @param {string} jobId - 任务 ID
   * @param {function} onProgress - 进度回调
   * @returns {Promise<{script: string, audioPath: string|null}>}
   */
  async createNarration(pageData, screenshotPaths, jobId, onProgress = () => {}) {
    const script = await this.generateScript(pageData, screenshotPaths, onProgress);
    const audioPath = await this.generateAudio(script, jobId, onProgress);
    return { script, audioPath };
  }
}
