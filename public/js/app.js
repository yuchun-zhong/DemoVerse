/**
 * DemoVerse 前端应用逻辑
 */

// 状态管理
let currentJobId = null;
let pollingTimer = null;

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', () => {
  // 初始化 Lucide 图标
  if (window.lucide) {
    lucide.createIcons();
  }
  // 加载历史记录
  loadHistory();

  // 回车触发生成
  document.getElementById('urlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startGeneration();
  });
});

// ==================== 生成流程 ====================

async function startGeneration() {
  const urlInput = document.getElementById('urlInput');
  const url = urlInput.value.trim();

  if (!url) {
    shakeElement(urlInput);
    return;
  }

  // 验证 URL
  try {
    new URL(url);
  } catch {
    shakeElement(urlInput);
    return;
  }

  // 切换到进度界面
  showProgress();
  setProgress(0, '正在提交任务...');

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '提交失败');
    }

    currentJobId = data.jobId;
    startPolling();
  } catch (error) {
    showError(error.message);
  }
}

// ==================== 轮询状态 ====================

function startPolling() {
  if (pollingTimer) clearInterval(pollingTimer);

  pollingTimer = setInterval(async () => {
    try {
      const response = await fetch(`/api/status/${currentJobId}`);
      const job = await response.json();

      if (!response.ok) {
        throw new Error(job.error || '查询失败');
      }

      updateProgressUI(job);

      if (job.status === 'completed') {
        stopPolling();
        showResult(job);
      } else if (job.status === 'failed') {
        stopPolling();
        showError(job.error || '视频生成失败');
      }
    } catch (error) {
      stopPolling();
      showError(error.message);
    }
  }, 1500);
}

function stopPolling() {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

// ==================== UI 更新 ====================

function updateProgressUI(job) {
  setProgress(job.progress || 0, job.message || '处理中...');

  // 更新步骤状态
  const steps = document.querySelectorAll('.step');
  const stepMap = {
    recording: 0,
    narrating: 1,
    compiling: 2,
    uploading: 3,
  };

  const currentStepIndex = stepMap[job.currentStep] ?? -1;

  steps.forEach((step, index) => {
    step.classList.remove('active', 'done');
    if (index < currentStepIndex) {
      step.classList.add('done');
    } else if (index === currentStepIndex) {
      step.classList.add('active');
    }
  });
}

function setProgress(percent, message) {
  document.getElementById('progressBarFill').style.width = `${percent}%`;
  document.getElementById('progressPercent').textContent = `${Math.round(percent)}%`;
  if (message) {
    document.getElementById('progressMessage').textContent = message;
  }
}

function showProgress() {
  document.getElementById('inputArea').classList.add('hidden');
  document.getElementById('progressArea').classList.remove('hidden');
  document.getElementById('resultArea').classList.add('hidden');
  document.getElementById('errorArea').classList.add('hidden');
}

function showResult(job) {
  document.getElementById('progressArea').classList.add('hidden');
  document.getElementById('resultArea').classList.remove('hidden');

  document.getElementById('resultUrl').textContent = job.url;

  // 设置视频源
  if (job.videoUrl) {
    const video = document.getElementById('resultVideo');
    video.src = job.videoUrl;
  }

  // 显示解说脚本
  if (job.script) {
    const scriptArea = document.getElementById('resultScriptArea');
    scriptArea.classList.remove('hidden');
    document.getElementById('scriptContent').textContent = job.script;
  }

  // 重新创建图标
  if (window.lucide) lucide.createIcons();

  loadHistory();
}

function showError(message) {
  document.getElementById('progressArea').classList.add('hidden');
  document.getElementById('errorArea').classList.remove('hidden');
  document.getElementById('errorMessage').textContent = message || '未知错误';

  if (window.lucide) lucide.createIcons();
  loadHistory();
}

function resetGeneration() {
  stopPolling();
  currentJobId = null;

  document.getElementById('inputArea').classList.remove('hidden');
  document.getElementById('progressArea').classList.add('hidden');
  document.getElementById('resultArea').classList.add('hidden');
  document.getElementById('errorArea').classList.add('hidden');

  // 重置进度
  setProgress(0, '正在处理...');
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active', 'done'));

  // 清空视频
  const video = document.getElementById('resultVideo');
  video.src = '';
}

// ==================== 下载 ====================

async function downloadVideo() {
  if (!currentJobId) return;

  try {
    const response = await fetch(`/api/download/${currentJobId}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '获取下载链接失败');
    }

    // 使用 fetch + blob 模式下载
    const fileResponse = await fetch(data.downloadUrl);
    const blob = await fileResponse.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `demoverse_${currentJobId}.mp4`;
    link.click();
    URL.revokeObjectURL(blobUrl);
  } catch (error) {
    alert('下载失败: ' + error.message);
  }
}

// ==================== 解说脚本展开/收起 ====================

function toggleScript() {
  const content = document.getElementById('scriptContent');
  content.classList.toggle('collapsed');
  const chevron = document.getElementById('scriptChevron');
  if (content.classList.contains('collapsed')) {
    chevron.style.transform = 'rotate(0deg)';
  } else {
    chevron.style.transform = 'rotate(180deg)';
  }
}

// ==================== 历史记录 ====================

async function loadHistory() {
  try {
    const response = await fetch('/api/jobs');
    const jobs = await response.json();

    const container = document.getElementById('historyList');

    if (jobs.length === 0) {
      container.innerHTML = '<div class="history-empty">暂无生成记录</div>';
      return;
    }

    container.innerHTML = jobs.slice(0, 10).map(job => `
      <div class="history-item">
        <div class="history-item-info">
          <div class="history-item-status ${job.status}"></div>
          <span class="history-item-url">${escapeHtml(job.url)}</span>
        </div>
        <div class="history-item-actions">
          ${job.status === 'completed' ? `
            <button class="btn btn-ghost" onclick="viewJobResult('${job.id}')">查看</button>
          ` : ''}
          <button class="btn btn-ghost" onclick="deleteJob('${job.id}')">删除</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    // 忽略
  }
}

async function viewJobResult(jobId) {
  const response = await fetch(`/api/status/${jobId}`);
  const job = await response.json();
  if (job.status === 'completed') {
    currentJobId = job.id;
    showResult(job);
  }
}

async function deleteJob(jobId) {
  await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
  loadHistory();
}

// ==================== 工具函数 ====================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function shakeElement(el) {
  el.style.animation = 'none';
  el.offsetHeight; // 触发重绘
  el.style.animation = 'shake 0.4s ease';
  setTimeout(() => { el.style.animation = ''; }, 400);
}

// 添加 shake 动画
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-6px); }
    75% { transform: translateX(6px); }
  }
`;
document.head.appendChild(style);
