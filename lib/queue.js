import { v4 as uuidv4 } from 'uuid';

/**
 * 任务队列管理器
 * 管理视频生成任务的生命周期和状态
 */
class JobQueue {
  constructor() {
    /** @type {Map<string, Job>} */
    this.jobs = new Map();
  }

  /**
   * 创建新任务
   * @param {string} url - 目标 URL
   * @param {object} options - 生成选项（style, voice, platform）
   * @returns {Job}
   */
  create(url, options = {}) {
    const id = uuidv4();
    const job = {
      id,
      url,
      options,
      status: 'pending',
      progress: 0,
      currentStep: '',
      message: '等待处理...',
      videoUrl: null,
      videoKey: null,
      script: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(id, job);
    return job;
  }

  /**
   * 获取任务
   * @param {string} id
   * @returns {Job|undefined}
   */
  get(id) {
    return this.jobs.get(id);
  }

  /**
   * 更新任务进度
   * @param {string} id
   * @param {Partial<Job>} updates
   */
  update(id, updates) {
    const job = this.jobs.get(id);
    if (job) {
      Object.assign(job, updates, { updatedAt: new Date().toISOString() });
    }
  }

  /**
   * 获取所有任务列表
   * @returns {Job[]}
   */
  list() {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  /**
   * 删除任务
   * @param {string} id
   */
  delete(id) {
    this.jobs.delete(id);
  }
}

// 单例导出
export const jobQueue = new JobQueue();
