import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

/**
 * 使用 FFmpeg 将截图序列编译为视频
 * @param {string[]} screenshots - 截图文件路径数组
 * @param {string} jobId - 任务 ID
 * @param {object} options - 选项
 * @param {string|null} audioPath - 音频文件路径（可选）
 * @param {function} onProgress - 进度回调
 * @returns {Promise<string>} 输出视频路径
 */
export async function compileVideo(screenshots, jobId, options = {}, audioPath = null, onProgress = () => {}) {
  const workDir = path.join('/tmp', `demoverse_${jobId}`);
  const outputPath = path.join(workDir, `demoverse_${jobId}.mp4`);

  onProgress({ step: 'compiling', message: '编译视频...' });

  if (screenshots.length === 0) {
    throw new Error('没有可用的截图');
  }

  // 为每张截图创建持续时间的帧序列
  const frameDir = path.join(workDir, 'frames');
  fs.mkdirSync(frameDir, { recursive: true });

  // 每张截图展示 2.5 秒
  const fps = 1;
  const durationPerFrame = 2.5;
  const totalFrames = screenshots.length;
  
  // 创建帧序列：每张截图重复 N 帧以实现持续时间
  const framesPerImage = Math.ceil(durationPerFrame * 24); // 24fps
  
  let frameIndex = 0;
  for (const screenshot of screenshots) {
    // 为每张图片创建符号链接到帧目录
    for (let i = 0; i < framesPerImage; i++) {
      const linkPath = path.join(frameDir, `frame_${String(frameIndex + 1).padStart(6, '0')}.png`);
      try {
        fs.symlinkSync(path.resolve(screenshot), linkPath);
      } catch (e) {
        // 如果符号链接失败，直接复制
        fs.copyFileSync(screenshot, linkPath);
      }
      frameIndex++;
    }
  }

  onProgress({ step: 'encoding', message: '编码视频...' });

  return new Promise((resolve, reject) => {
    let command = ffmpeg();

    if (audioPath && fs.existsSync(audioPath)) {
      // 有音频：视频匹配音频时长
      command = command
        .input(path.join(frameDir, 'frame_%06d.png'))
        .inputOptions([`-framerate ${fps * framesPerImage / totalFrames}`])
        .input(audioPath)
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-r 24',
          '-c:a aac',
          '-b:a 128k',
          '-shortest',
          '-movflags +faststart',
        ]);
    } else {
      // 无音频：纯视频
      command = command
        .input(path.join(frameDir, 'frame_%06d.png'))
        .inputOptions([`-framerate 24`])
        .outputOptions([
          '-c:v libx264',
          '-pix_fmt yuv420p',
          '-r 24',
          '-movflags +faststart',
        ]);
    }

    command
      .output(outputPath)
      .on('progress', (progress) => {
        onProgress({ 
          step: 'encoding', 
          message: `编码中 ${Math.round(progress.percent || 0)}%` 
        });
      })
      .on('end', () => {
        onProgress({ step: 'encoded', message: '视频编码完成' });
        resolve(outputPath);
      })
      .on('error', (err) => {
        reject(new Error(`FFmpeg 编码失败: ${err.message}`));
      })
      .run();
  });
}

/**
 * 将音频与视频合并
 * @param {string} videoPath - 视频文件路径
 * @param {string} audioPath - 音频文件路径
 * @param {string} jobId - 任务 ID
 * @returns {Promise<string>} 输出文件路径
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
