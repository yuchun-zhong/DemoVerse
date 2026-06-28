/**
 * DemoVerse - FFmpeg 视频编译模块
 * 
 * 逐帧截图 → H.264 视频 + 音频合并 + ASS 字幕烧录
 * 支持：标题页 + 正文 + 结尾页 的完整视频合成
 */

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// 平台输出分辨率映射
const OUTPUT_SIZE_MAP = {
  bilibili:    { width: 1920, height: 1080 },
  youtube:     { width: 1920, height: 1080 },
  zhihu:       { width: 1920, height: 1080 },
  douyin:      { width: 1080, height: 1920 },
  wechat:      { width: 1080, height: 1920 },
  xiaohongshu: { width: 1080, height: 1440 },
  custom:      { width: 1920, height: 1080 },
};

/**
 * 执行 FFmpeg 命令
 */
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = execFile('ffmpeg', args, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`FFmpeg 失败: ${stderr?.slice(-500) || error.message}`));
      } else {
        resolve(stdout);
      }
    });
    // 静默 stderr
    proc.stderr?.on('data', () => {});
  });
}

/**
 * 合并多个音频文件为一个
 */
async function concatAudioFiles(audioSegments, jobId) {
  const workDir = path.join('/tmp', `demoverse_${jobId}`);
  const concatListPath = path.join(workDir, 'audio_concat.txt');
  const mergedAudioPath = path.join(workDir, 'merged_audio.m4a');

  // 获取有音频的段
  const validSegments = audioSegments.filter(seg => seg.audioPath && fs.existsSync(seg.audioPath));

  if (validSegments.length === 0) {
    return null;
  }

  // 如果只有一个音频文件，直接返回
  if (validSegments.length === 1) {
    return validSegments[0].audioPath;
  }

  // 写入 concat 列表
  const concatContent = validSegments.map(seg => {
    // 需要转义特殊字符
    const escapedPath = seg.audioPath.replace(/'/g, "\\'");
    return `file '${escapedPath}'`;
  }).join('\n');

  fs.writeFileSync(concatListPath, concatContent);

  // 先将每个 MP3 转为 WAV（避免 MP3 concat 兼容问题），再合并
  const wavFiles = [];
  for (let i = 0; i < validSegments.length; i++) {
    const wavPath = path.join(workDir, `seg_${i}.wav`);
    try {
      await runFFmpeg([
        '-y', '-i', validSegments[i].audioPath,
        '-ar', '24000', '-ac', '1', '-sample_fmt', 's16',
        wavPath,
      ]);
      wavFiles.push(wavPath);
    } catch (e) {
      console.error(`[video] 转换音频段 ${i} 失败:`, e.message);
    }
  }

  if (wavFiles.length === 0) return null;
  if (wavFiles.length === 1) {
    // 单个 WAV 直接转 AAC
    await runFFmpeg(['-y', '-i', wavFiles[0], '-c:a', 'aac', '-b:a', '128k', mergedAudioPath]);
    return mergedAudioPath;
  }

  // 写入 WAV concat 列表
  const wavConcatContent = wavFiles.map(f => {
    const escapedPath = f.replace(/'/g, "\\'");
    return `file '${escapedPath}'`;
  }).join('\n');
  const wavConcatPath = path.join(workDir, 'wav_concat.txt');
  fs.writeFileSync(wavConcatPath, wavConcatContent);

  await runFFmpeg([
    '-y', '-f', 'concat', '-safe', '0',
    '-i', wavConcatPath,
    '-c:a', 'aac', '-b:a', '128k',
    mergedAudioPath,
  ]);

  return mergedAudioPath;
}

/**
 * 将帧序列编码为 H.264 视频
 */
async function encodeFramesToVideo(frameCapture, jobId, options = {}) {
  const workDir = path.join('/tmp', `demoverse_${jobId}`);
  const framesDir = path.join(workDir, 'frames');

  // 创建帧目录
  fs.mkdirSync(framesDir, { recursive: true });

  // 重命名帧为连续编号
  const frames = frameCapture.getFrames();
  const concatInfo = [];

  for (let i = 0; i < frames.length; i++) {
    const srcFile = frames[i].file;
    const dstFile = path.join(framesDir, `frame_${String(i).padStart(8, '0')}.png`);
    
    if (srcFile !== dstFile && fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, dstFile);
    } else if (fs.existsSync(srcFile)) {
      // already in place
    }

    // 记录每帧的持续时间（用于 concat demuxer）
    const duration = Math.max(frames[i].duration, 0.04); // 最小 40ms = 25fps
    concatInfo.push({ file: dstFile, duration });
  }

  // 生成 concat 文件
  const concatPath = path.join(workDir, 'frames_concat.txt');
  const concatContent = concatInfo.map(f => {
    const escapedPath = f.file.replace(/'/g, "\\'");
    return `file '${escapedPath}'\nduration ${f.duration.toFixed(4)}`;
  }).join('\n') + `\nfile '${concatInfo[concatInfo.length - 1].file.replace(/'/g, "\\'")}'`;

  fs.writeFileSync(concatPath, concatContent);

  const outputPath = path.join(workDir, 'video_only.mp4');
  const outputSize = OUTPUT_SIZE_MAP[options.platform] || OUTPUT_SIZE_MAP.bilibili;

  await runFFmpeg([
    '-y',
    '-f', 'concat', '-safe', '0',
    '-i', concatPath,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'medium',
    '-crf', '23',
    '-vf', `scale=${outputSize.width}:${outputSize.height}:force_original_aspect_ratio=decrease,pad=${outputSize.width}:${outputSize.height}:(ow-iw)/2:(oh-ih)/2:black,fps=24`,
    '-movflags', '+faststart',
    outputPath,
  ]);

  return outputPath;
}

/**
 * 合并音频到视频
 */
async function mergeAudioToVideo(videoPath, audioPath, jobId) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    return videoPath;
  }

  const workDir = path.join('/tmp', `demoverse_${jobId}`);
  const outputPath = path.join(workDir, 'video_with_audio.mp4');

  await runFFmpeg([
    '-y',
    '-i', videoPath,
    '-i', audioPath,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest',
    '-movflags', '+faststart',
    outputPath,
  ]);

  return outputPath;
}

/**
 * 烧录 ASS 字幕到视频
 */
async function burnSubtitles(videoPath, assPath, jobId) {
  if (!assPath || !fs.existsSync(assPath)) {
    return videoPath;
  }

  const workDir = path.join('/tmp', `demoverse_${jobId}`);
  const outputPath = path.join(workDir, 'video_with_subs.mp4');

  // FFmpeg 的 subtitles 滤镜需要转义特殊字符
  const escapedAssPath = assPath.replace(/([:\\'])/g, '\\$1').replace(/(\[)/g, '\\$1').replace(/(\])/g, '\\$1');

  await runFFmpeg([
    '-y',
    '-i', videoPath,
    '-vf', `subtitles='${escapedAssPath}'`,
    '-c:v', 'libx264',
    '-c:a', 'copy',
    '-preset', 'medium',
    '-crf', '23',
    '-movflags', '+faststart',
    outputPath,
  ]);

  return outputPath;
}

/**
 * 主合成函数 - 完整视频编译管线
 */
export async function composeVideo(frameCapture, narrationResult, jobId, options = {}, onProgress = () => {}) {
  // Step 1: 帧序列编码为视频
  onProgress({ step: 'compiling', message: '编译帧序列为视频...' });
  let videoPath = await encodeFramesToVideo(frameCapture, jobId, options);

  // Step 2: 合并音频
  onProgress({ step: 'encoding', message: '合并音频轨道...' });
  if (narrationResult?.audioSegments?.length > 0) {
    try {
      const mergedAudioPath = await concatAudioFiles(narrationResult.audioSegments, jobId);
      if (mergedAudioPath) {
        videoPath = await mergeAudioToVideo(videoPath, mergedAudioPath, jobId);
      }
    } catch (err) {
      console.error('音频合并失败，使用无声视频:', err.message);
    }
  }

  // Step 3: 烧录字幕
  onProgress({ step: 'merging', message: '烧录字幕...' });
  if (narrationResult?.assPath) {
    try {
      videoPath = await burnSubtitles(videoPath, narrationResult.assPath, jobId);
    } catch (err) {
      console.error('字幕烧录失败:', err.message);
      // 尝试使用 SRT
      if (narrationResult.srtPath) {
        try {
          const escapedSrtPath = narrationResult.srtPath.replace(/([:\\'])/g, '\\$1').replace(/(\[)/g, '\\$1').replace(/(\])/g, '\\$1');
          const workDir = path.join('/tmp', `demoverse_${jobId}`);
          const outputPath = path.join(workDir, 'video_with_srt.mp4');
          await runFFmpeg([
            '-y', '-i', videoPath,
            '-vf', `subtitles='${escapedSrtPath}'`,
            '-c:v', 'libx264', '-c:a', 'copy',
            '-preset', 'medium', '-crf', '23',
            '-movflags', '+faststart',
            outputPath,
          ]);
          videoPath = outputPath;
        } catch (srtErr) {
          console.error('SRT 字幕烧录也失败:', srtErr.message);
        }
      }
    }
  }

  onProgress({ step: 'composed', message: '视频合成完成' });

  return videoPath;
}
