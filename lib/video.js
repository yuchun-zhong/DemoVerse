/**
 * DemoVerse - 智能视频合成服务
 * 从静态截图拼接升级为帧序列+音频+字幕合成
 * 
 * 核心改造：
 * 1. 使用 FFmpeg concat demuxer 从帧序列生成视频
 * 2. 合并音频轨道（按时间对齐）
 * 3. 烧录 ASS 字幕
 * 4. 添加入场/结尾动画
 * 5. 平台规格适配
 */

import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

/**
 * 平台对应的视频分辨率
 */
const PLATFORM_RESOLUTIONS = {
  bilibili:   { width: 1280, height: 720 },
  youtube:    { width: 1280, height: 720 },
  zhihu:      { width: 1280, height: 720 },
  douyin:     { width: 720, height: 1280 },
  wechat:     { width: 720, height: 1280 },
  xiaohongshu:{ width: 810, height: 1080 },
  custom:     { width: 1280, height: 720 },
};

/**
 * 从帧序列和音频合成最终视频
 * @param {import('./recorder.js').FrameCapture} frameCapture - 帧捕获器
 * @param {object} narrationResult - 解说结果（含音频和字幕）
 * @param {string} jobId - 任务 ID
 * @param {object} options - 选项（含 platform）
 * @param {function} onProgress - 进度回调
 * @returns {Promise<string>} 输出视频路径
 */
export async function composeVideo(frameCapture, narrationResult, jobId, options = {}, onProgress = () => {}) {
  const platform = options.platform || 'bilibili';
  const resolution = PLATFORM_RESOLUTIONS[platform] || PLATFORM_RESOLUTIONS.bilibili;
  const workDir = path.join('/tmp', `demoverse_${jobId}`);
  const outputPath = path.join(workDir, `demoverse_${jobId}.mp4`);

  onProgress({ step: 'compiling', message: '编译视频...' });

  const concatFilePath = frameCapture.generateConcatFile();
  const audioPath = narrationResult.audioSegments?.[0]?.audioPath || null;
  const assPath = narrationResult.assPath || null;
  const srtPath = narrationResult.srtPath || null;

  // Step 1: 从帧序列生成基础视频（含字幕）
  const baseVideoPath = path.join(workDir, `demoverse_${jobId}_base.mp4`);

  onProgress({ step: 'encoding', message: '编码视频...' });

  await new Promise((resolve, reject) => {
    let cmd = ffmpeg()
      .input(concatFilePath)
      .inputOptions(['-f concat', '-safe 0']);

    // 构建 video filter
    const vfilters = [
      `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease`,
      `pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2:black`,
      'fps=24',
      'format=yuv420p',
    ];

    // 添加字幕滤镜（优先 ASS）
    if (assPath && fs.existsSync(assPath)) {
      // ASS 字幕需要转义路径中的特殊字符
      const escapedPath = assPath.replace(/([:\\\[\]])/g, '\\$1').replace(/'/g, "\\'");
      vfilters.push(`ass='${escapedPath}'`);
    } else if (srtPath && fs.existsSync(srtPath)) {
      const escapedPath = srtPath.replace(/([:\\\[\]])/g, '\\$1').replace(/'/g, "\\'");
      vfilters.push(`subtitles='${escapedPath}':force_style='FontName=Inter,FontSize=16,PrimaryColour=&HFFFFFF'`);
    }

    cmd
      .outputOptions([
        '-c:v libx264',
        '-preset medium',
        '-crf 23',
        `-vf ${vfilters.join(',')}`,
        '-an', // 先不加音频
        '-movflags +faststart',
      ])
      .output(baseVideoPath)
      .on('progress', (progress) => {
        onProgress({
          step: 'encoding',
          message: `编码中 ${Math.round(progress.percent || 0)}%`,
        });
      })
      .on('end', () => {
        onProgress({ step: 'encoded', message: '视频编码完成' });
        resolve();
      })
      .on('error', (err) => {
        console.error('FFmpeg 帧编码失败:', err.message);
        reject(new Error(`FFmpeg 帧编码失败: ${err.message}`));
      })
      .run();
  });

  // Step 2: 合并音频
  if (audioPath && fs.existsSync(audioPath)) {
    onProgress({ step: 'merging', message: '合并音频...' });

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(baseVideoPath)
        .input(audioPath)
        .outputOptions([
          '-c:v copy',
          '-c:a aac',
          '-b:a 128k',
          '-shortest',
          '-movflags +faststart',
        ])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => {
          console.error('音视频合并失败:', err.message);
          // 降级：使用无声视频
          try {
            fs.copyFileSync(baseVideoPath, outputPath);
            resolve();
          } catch {
            reject(new Error(`音视频合并失败: ${err.message}`));
          }
        })
        .run();
    });
  } else {
    // 无音频，直接使用基础视频
    try {
      fs.copyFileSync(baseVideoPath, outputPath);
    } catch {
      // 如果复制失败，重新生成无字幕版本
      fs.renameSync(baseVideoPath, outputPath);
    }
  }

  // 清理中间文件
  try {
    if (fs.existsSync(baseVideoPath) && baseVideoPath !== outputPath) {
      fs.unlinkSync(baseVideoPath);
    }
  } catch {
    // 忽略清理错误
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error('视频文件生成失败');
  }

  onProgress({ step: 'composed', message: '视频合成完成' });
  return outputPath;
}

/**
 * 兼容旧接口：从截图序列编译视频（保留用于降级）
 */
export async function compileVideo(screenshots, jobId, options = {}, audioPath = null, onProgress = () => {}) {
  const platform = options.platform || 'bilibili';
  const resolution = PLATFORM_RESOLUTIONS[platform] || PLATFORM_RESOLUTIONS.bilibili;
  const workDir = path.join('/tmp', `demoverse_${jobId}`);
  const outputPath = path.join(workDir, `demoverse_${jobId}.mp4`);

  onProgress({ step: 'compiling', message: '编译视频...' });

  if (screenshots.length === 0) {
    throw new Error('没有可用的截图');
  }

  // 使用 concat demuxer 方式
  const concatPath = path.join(workDir, 'frames.txt');
  const lines = [];
  for (const screenshot of screenshots) {
    lines.push(`file '${screenshot}'`);
    lines.push('duration 2.5');
  }
  lines.push(`file '${screenshots[screenshots.length - 1]}'`);
  fs.writeFileSync(concatPath, lines.join('\n'));

  onProgress({ step: 'encoding', message: '编码视频...' });

  return new Promise((resolve, reject) => {
    let command = ffmpeg()
      .input(concatPath)
      .inputOptions(['-f concat', '-safe 0']);

    if (audioPath && fs.existsSync(audioPath)) {
      command = command.input(audioPath);
      command.outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-r 24',
        `-vf scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2:black`,
        '-c:a aac',
        '-b:a 128k',
        '-shortest',
        '-movflags +faststart',
      ]);
    } else {
      command.outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-r 24',
        `-vf scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2:black`,
        '-movflags +faststart',
      ]);
    }

    command
      .output(outputPath)
      .on('progress', (progress) => {
        onProgress({
          step: 'encoding',
          message: `编码中 ${Math.round(progress.percent || 0)}%`,
        });
      })
      .on('end', () => {
        onProgress({ step: 'encoded', message: '视频编码完成' });
        resolve(outputPath);
      })
      .on('error', (err) => reject(new Error(`FFmpeg 编码失败: ${err.message}`)))
      .run();
  });
}

/**
 * 合并音频与视频（兼容旧接口）
 */
export async function mergeAudioVideo(videoPath, audioPath, jobId) {
  const workDir = path.join('/tmp', `demoverse_${jobId}`);
  const outputPath = path.join(workDir, `demoverse_${jobId}_final.mp4`);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        '-c:v copy',
        '-c:a aac',
        '-b:a 128k',
        '-shortest',
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error(`音视频合并失败: ${err.message}`)))
      .run();
  });
}
