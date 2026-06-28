/**
 * DemoVerse - 前端交互逻辑
 * Vercel 极简黑 + Linear 科技感风格
 * 智能浏览录制 Agent 版本
 */

(function () {
  'use strict';

  // ==================== DOM 引用 ====================
  const urlInput = document.getElementById('urlInput');
  const generateBtn = document.getElementById('generateBtn');
  const progressSection = document.getElementById('progressSection');
  const resultSection = document.getElementById('resultSection');
  const progressBar = document.getElementById('progressBar');
  const progressPercent = document.getElementById('progressPercent');
  const progressMessage = document.getElementById('progressMessage');
  const videoPlayer = document.getElementById('videoPlayer');
  const redoBtn = document.getElementById('redoBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const scriptSection = document.getElementById('scriptSection');
  const scriptToggle = document.getElementById('scriptToggle');
  const scriptContent = document.getElementById('scriptContent');
  const errorToast = document.getElementById('errorToast');
  const errorMessage = document.getElementById('errorMessage');

  // ==================== 状态 ====================
  let currentJobId = null;
  let pollTimer = null;

  const selectedOptions = {
    style: 'professional',
    voice: 'yunxi_male',
    platform: 'bilibili',
  };

  // ==================== URL 输入控制 ====================
  urlInput.addEventListener('input', function () {
    const hasValue = this.value.trim().length > 0;
    generateBtn.disabled = !hasValue;
  });

  urlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !generateBtn.disabled) {
      startGeneration();
    }
  });

  generateBtn.addEventListener('click', startGeneration);

  // ==================== 自定义下拉选择 ====================
  document.querySelectorAll('.custom-select').forEach(function (select) {
    const trigger = select.querySelector('.select-trigger');
    const items = select.querySelectorAll('.select-item');
    const valueEl = trigger.querySelector('.select-value');
    const optionKey = select.dataset.option;

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      document.querySelectorAll('.custom-select.open').forEach(function (s) {
        if (s !== select) s.classList.remove('open');
      });
      select.classList.toggle('open');
    });

    items.forEach(function (item) {
      item.addEventListener('click', function () {
        items.forEach(function (i) { i.classList.remove('selected'); });
        item.classList.add('selected');
        valueEl.textContent = item.textContent;
        selectedOptions[optionKey] = item.dataset.value;
        select.classList.remove('open');
      });
    });
  });

  document.addEventListener('click', function () {
    document.querySelectorAll('.custom-select.open').forEach(function (s) {
      s.classList.remove('open');
    });
  });

  // ==================== 生成流程 ====================
  async function startGeneration() {
    const url = urlInput.value.trim();
    if (!url) return;

    resultSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    resetProgress();
    updateStepState('recording', 'active');

    generateBtn.disabled = true;
    generateBtn.querySelector('.generate-btn-text').textContent = '生成中...';

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          style: selectedOptions.style,
          voice: selectedOptions.voice,
          platform: selectedOptions.platform,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '生成失败');
      }

      currentJobId = data.jobId;
      startPolling();

    } catch (err) {
      showError(err.message);
      resetUI();
    }
  }

  // ==================== 轮询状态 ====================
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollStatus, 1500);
    pollStatus();
  }

  async function pollStatus() {
    if (!currentJobId) return;

    try {
      const res = await fetch('/api/status/' + currentJobId);
      const job = await res.json();

      if (!res.ok) {
        throw new Error(job.error || '查询失败');
      }

      updateProgress(job);

      if (job.status === 'completed') {
        clearInterval(pollTimer);
        pollTimer = null;
        showResult(job);
      } else if (job.status === 'failed') {
        clearInterval(pollTimer);
        pollTimer = null;
        showError(job.error || '视频生成失败');
        resetUI();
      }
    } catch (err) {
      console.error('轮询错误:', err);
    }
  }

  // ==================== 更新进度 ====================
  function updateProgress(job) {
    const pct = job.progress || 0;
    progressBar.style.width = pct + '%';
    progressPercent.textContent = pct + '%';
    progressMessage.textContent = job.message || '';

    // 智能浏览 Agent 步骤映射
    const stepMap = {
      // 浏览录制阶段（智能探索 + 录屏）
      launch: { step: 'recording', state: 'active' },
      loading: { step: 'recording', state: 'active' },
      analyzing: { step: 'recording', state: 'active' },
      planning: { step: 'recording', state: 'active' },
      exploring: { step: 'recording', state: 'active' },
      recording: { step: 'recording', state: 'active' },
      recorded: { step: 'recording', state: 'completed' },
      // AI 脚本阶段（按步骤生成解说）
      narrating: { step: 'script', state: 'active' },
      generating_script: { step: 'script', state: 'active' },
      script_generated: { step: 'script', state: 'completed' },
      // AI 配音阶段
      generating_audio: { step: 'voiceover', state: 'active' },
      audio_generated: { step: 'voiceover', state: 'completed' },
      audio_failed: { step: 'voiceover', state: 'completed' },
      // 合成阶段
      compiling: { step: 'compositing', state: 'active' },
      encoding: { step: 'compositing', state: 'active' },
      adding_subtitles: { step: 'compositing', state: 'active' },
      encoded: { step: 'compositing', state: 'completed' },
      uploading: { step: 'compositing', state: 'active' },
    };

    const info = stepMap[job.currentStep];
    if (info) {
      const stepOrder = ['recording', 'script', 'voiceover', 'compositing'];
      const currentIdx = stepOrder.indexOf(info.step);

      stepOrder.forEach(function (stepName, idx) {
        if (idx < currentIdx) {
          updateStepState(stepName, 'completed');
        } else if (idx === currentIdx) {
          updateStepState(stepName, info.state);
        } else {
          updateStepState(stepName, '');
        }
      });

      updateStepLines(currentIdx, info.state === 'completed');
    }
  }

  function updateStepState(stepName, state) {
    const stepEl = document.querySelector('.step[data-step="' + stepName + '"]');
    if (!stepEl) return;

    stepEl.classList.remove('active', 'completed');
    if (state) {
      stepEl.classList.add(state);
    }

    const statusEl = stepEl.querySelector('.step-status');
    if (statusEl) {
      if (state === 'active') statusEl.textContent = '进行中';
      else if (state === 'completed') statusEl.textContent = '已完成';
      else statusEl.textContent = '等待中';
    }
  }

  function updateStepLines(currentIdx, currentCompleted) {
    const lines = document.querySelectorAll('.step-line');
    lines.forEach(function (line, idx) {
      if (idx < currentIdx || (idx === currentIdx && currentCompleted)) {
        line.classList.add('completed');
      } else {
        line.classList.remove('completed');
      }
    });
  }

  function resetProgress() {
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    progressMessage.textContent = '准备中...';

    document.querySelectorAll('.step').forEach(function (step) {
      step.classList.remove('active', 'completed');
      var s = step.querySelector('.step-status');
      if (s) s.textContent = '等待中';
    });
    document.querySelectorAll('.step-line').forEach(function (line) {
      line.classList.remove('completed');
    });
  }

  // ==================== 显示结果 ====================
  async function showResult(job) {
    progressSection.classList.add('hidden');
    resultSection.classList.remove('hidden');

    if (job.videoUrl) {
      videoPlayer.src = job.videoUrl;
    }

    if (job.script) {
      scriptSection.classList.remove('hidden');
      // 支持新的分步脚本格式
      if (typeof job.script === 'object' && job.script.steps) {
        var html = '';
        job.script.steps.forEach(function (step, idx) {
          html += '<div class="script-step">';
          html += '<span class="script-step-num">' + (idx + 1) + '</span>';
          html += '<div class="script-step-body">';
          html += '<p class="script-step-action">' + escapeHtml(step.action) + '</p>';
          html += '<p class="script-step-narration">' + escapeHtml(step.narration) + '</p>';
          html += '</div></div>';
        });
        scriptContent.innerHTML = html;
      } else {
        scriptContent.textContent = typeof job.script === 'string' ? job.script : JSON.stringify(job.script, null, 2);
      }
    }

    generateBtn.disabled = false;
    generateBtn.querySelector('.generate-btn-text').textContent = '开始生成';

    downloadBtn.onclick = async function () {
      try {
        const res = await fetch('/api/download/' + job.id);
        const data = await res.json();
        if (data.downloadUrl) {
          const response = await fetch(data.downloadUrl);
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'demoverse_' + job.id + '.mp4';
          a.click();
          window.URL.revokeObjectURL(url);
        }
      } catch (err) {
        showError('下载失败');
      }
    };

    redoBtn.onclick = function () {
      resultSection.classList.add('hidden');
      if (job.videoUrl) {
        videoPlayer.src = '';
      }
      urlInput.focus();
    };
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ==================== 脚本折叠 ====================
  scriptToggle.addEventListener('click', function () {
    scriptToggle.classList.toggle('open');
    scriptContent.classList.toggle('open');
  });

  // ==================== 错误提示 ====================
  function showError(msg) {
    errorMessage.textContent = msg;
    errorToast.classList.remove('hidden');
    requestAnimationFrame(function () {
      errorToast.classList.add('visible');
    });
    setTimeout(function () {
      errorToast.classList.remove('visible');
      setTimeout(function () {
        errorToast.classList.add('hidden');
      }, 200);
    }, 4000);
  }

  // ==================== 重置 UI ====================
  function resetUI() {
    progressSection.classList.add('hidden');
    generateBtn.disabled = false;
    generateBtn.querySelector('.generate-btn-text').textContent = '开始生成';
  }

})();
