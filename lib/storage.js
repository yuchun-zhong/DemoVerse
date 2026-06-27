import { S3Storage } from 'coze-coding-dev-sdk';
import fs from 'fs';

/**
 * 对象存储模块 - 用于上传和获取生成的视频文件
 */
export class VideoStorage {
  constructor() {
    this.storage = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: '',
      secretKey: '',
      bucketName: process.env.COZE_BUCKET_NAME,
      region: 'cn-beijing',
    });
  }

  /**
   * 上传视频到对象存储
   * @param {string} filePath - 本地视频文件路径
   * @param {string} fileName - 目标文件名
   * @returns {Promise<{key: string, url: string}>}
   */
  async uploadVideo(filePath, fileName) {
    const fileBuffer = fs.readFileSync(filePath);
    
    const key = await this.storage.uploadFile({
      fileContent: fileBuffer,
      fileName: `videos/${fileName}`,
      contentType: 'video/mp4',
    });

    const url = await this.storage.generatePresignedUrl({
      key,
      expireTime: 86400, // 24小时有效期
    });

    return { key, url };
  }

  /**
   * 获取视频的签名 URL
   * @param {string} key - 存储的 key
   * @param {number} expireTime - 有效期（秒）
   * @returns {Promise<string>}
   */
  async getVideoUrl(key, expireTime = 3600) {
    return await this.storage.generatePresignedUrl({ key, expireTime });
  }
}
