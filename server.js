import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { jobQueue } from './lib/queue.js';
import { recordPage } from './lib/recorder.js';
import { compileVideo, mergeAudioVideo } from './lib/video.js';
import { Narrator } from './lib/narrator.js';
import { VideoStorage } from './lib/storage.js';
import { HeaderUtils } from 'coze-coding-dev-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.DEPLOY_RUN_PORT || 5000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== API 路由 ====================

/**
 * POST /api/generate - 创建视频生成任务
 */
app.post('/api/generate', async (req, res) => {
  const { url, style, voice, platform } = req.body;

  if (!url) {
    return res.status(400).json({ error: '请提供项目链接 URL' });
  }

  // 验证 URL 格式
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'URL 格式无效' });
  }

  const options = {
    style: style || 'professional',
    voice: voice || 'yunxi_male',
    platform: platform || 'bilibili',
  };

  const job = jobQueue.create(url, options);
  
  // 异步执行视频生成
  processVideoGeneration(job.id, url, options, req).catch(err => {
    console.error(`任务 ${job.id} 执行失败:`, err);
    jobQueue.update(job.id, {
      status: 'failed',
      error: err.message || '视频生成失败',
      message: '生成失败',
    });
  });

  res.json({ jobId: job.id, status: 'pending' });
});

/**
 * GET /api/status/:id - 查询任务状态
 */
app.get('/api/status/:id', (req, res) => {
  const job = jobQueue.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: '任务不存在' });
  }
  res.json(job);
});

/**
 * GET /api/jobs - 获取所有任务列表
 */
app.get('/api/jobs', (req, res) => {
  res.json(jobQueue.list());
});

/**
 * DELETE /api/jobs/:id - 删除任务
 */
app.delete('/api/jobs/:id', (req, res) => {
  const job = jobQueue.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: '任务不存在' });
  }
  jobQueue.delete(req.params.id);
  res.json({ success: true });
});

/**
 * GET /api/download/:id - 获取视频下载链接
 */
app.get('/api/download/:id', async (req, res) => {
  const job = jobQueue.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: '任务不存在' });
  }
  if (job.status !== 'completed') {
    return res.status(400).json({ error: '视频尚未生成完成' });
  }

  try {
    const storage = new VideoStorage();
    const url = await storage.getVideoUrl(job.videoKey, 3600);
    res.json({ downloadUrl: url });
  } catch (err) {
    res.status(500).json({ error: '获取下载链接失败' });
  }
});

// SPA 兜底路由
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== 视频生成核心流程 ====================

async function processVideoGeneration(jobId, url, options, req) {
  const customHeaders = HeaderUtils.extractForwardHeaders(
    req.headers instanceof Map 
      ? Object.fromEntries(req.headers) 
      : req.headers
  );

  const updateProgress = (step, progress, message) => {
    jobQueue.update(jobId, {
      status: 'processing',
      currentStep: step,
      progress,
      message,
    });
  };

  try {
    // Step 1: 录制页面
    updateProgress('recording', 10, '正在录制页面...');
    const { screenshots, pageData, workDir } = await recordPage(url, jobId, options, (info) => {
      const progressMap = {
        launch: 10,
        loading: 15,
        analyzing: 20,
        capturing: 25,
        scrolling: 30,
        interacting: 40,
        captured: 45,
      };
      updateProgress(info.step, progressMap[info.step] || 30, info.message);
    });

    if (screenshots.length === 0) {
      throw new Error('未能捕获任何页面截图');
    }

    // Step 2: AI 解说
    updateProgress('narrating', 50, 'AI 生成解说...');
    const narrator = new Narrator(customHeaders, options);
    const { script, audioPath } = await narrator.createNarration(
      pageData, screenshots, jobId, (info) => {
        const progressMap = {
          generating_script: 55,
          script_generated: 60,
          generating_audio: 65,
          audio_generated: 70,
          audio_failed: 70,
        };
        updateProgress(info.step, progressMap[info.step] || 60, info.message);
      }
    );

    jobQueue.update(jobId, { script });

    // Step 3: 编译视频
    updateProgress('compiling', 75, '编译视频...');
    const videoPath = await compileVideo(
      screenshots, jobId, { platform: options.platform }, audioPath, (info) => {
        const progressMap = {
          compiling: 75,
          encoding: 80,
          encoded: 90,
        };
        updateProgress(info.step, progressMap[info.step] || 80, info.message);
      }
    );

    // Step 4: 上传到对象存储
    updateProgress('uploading', 92, '上传视频...');
    const storage = new VideoStorage();
    const { key, url: videoUrl } = await storage.uploadVideo(
      videoPath,
      `demoverse_${jobId}.mp4`
    );

    // 完成
    jobQueue.update(jobId, {
      status: 'completed',
      progress: 100,
      currentStep: 'done',
      message: '视频生成完成',
      videoUrl,
      videoKey: key,
    });

    // 清理临时文件
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (e) {
      // 忽略清理错误
    }

  } catch (error) {
    console.error(`视频生成失败 [${jobId}]:`, error);
    jobQueue.update(jobId, {
      status: 'failed',
      error: error.message,
      message: `生成失败: ${error.message}`,
    });
  }
}

// ==================== 启动服务器 ====================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`DemoVerse 服务已启动: http://0.0.0.0:${PORT}`);
  console.log(`Chrome 路径: /root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome`);
  console.log(`FFmpeg 版本: 系统 ffmpeg`);
});
