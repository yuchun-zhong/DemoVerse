import { LLMClient, TTSClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import axios from 'axios';
import path from 'path';
import fs from 'fs';

/**
 * AI 解说模块 - 使用 LLM 分析页面内容并生成 TTS 音频
 */
export class Narrator {
  constructor(customHeaders = {}) {
    const config = new Config();
    this.llmClient = new LLMClient(config, customHeaders);
    this.ttsClient = new TTSClient(config, customHeaders);
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

    const messages = [
      {
        role: 'system',
        content: `你是一位专业的产品 Demo 解说员，擅长用简洁生动的语言介绍产品功能。
你的解说风格：
1. 开头用一句话吸引注意力
2. 按页面布局顺序介绍核心功能
3. 每个功能点用 1-2 句话概括
4. 结尾给出有力的号召或总结
5. 总时长控制在 30-60 秒（约 100-200 字）
6. 语言风格专业但不枯燥，像在给朋友展示一个酷产品
7. 不要使用 Markdown 格式，直接输出纯文本`,
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
      const response = await this.ttsClient.synthesize({
        uid: `demoverse_${jobId}`,
        text: script,
        speaker: 'zh_male_dayi_saturn_bigtts',
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
