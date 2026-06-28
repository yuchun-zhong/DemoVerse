<div align="center">

# DemoVerse

**AI 驱动的智能 Demo 视频生成器**

输入项目链接，自动生成带 AI 解说和字幕的产品演示视频

[功能特性](#-功能特性) · [快速开始](#-快速开始) · [技术架构](#-技术架构) · [部署](#-部署) · [FAQ](#-faq)

</div>

---

## ✨ 功能特性

- 🤖 **智能浏览 Agent** — 自动分析页面结构，规划演示路径，模拟真实用户操作（点击、滚动、悬停、填表）
- 🎙️ **AI 解说配音** — LLM 分析页面内容生成专业解说词，TTS 合成自然语音，音画完全同步
- 🎬 **产品级视频结构** — 开场标题页 → 功能演示 → 亮点总结 → 结尾页，60-90秒标准时长
- 📱 **多平台适配** — 哔哩哔哩 16:9 / 抖音 9:16 / 小红书 3:4 / YouTube / 视频号 / 知乎
- 🎨 **三种风格** — 专业简洁 / 轻松亲切 / 活力激情
- 👥 **双声道配音** — 云希男声 / 晓晓女声
- 🔤 **自动字幕** — SRT/ASS 双格式，支持字幕烧录
- ☁️ **云端存储** — 视频自动上传 S3 对象存储，签名 URL 预览下载
- ⚡ **实时进度** — 4步进度追踪（智能浏览 / AI 解说 / AI 配音 / 合成视频）

## 🚀 快速开始

### 环境要求

- Node.js 18+
- FFmpeg 6.0+（需支持 libass 字幕烧录）
- Chromium / Chrome 浏览器

### 3步启动

```bash
# 1. 克隆项目
git clone https://github.com/zhongyuchun/demoverse.git
cd demoverse

# 2. 安装依赖
pnpm install

# 3. 启动服务
node server.js
```

服务默认运行在 `http://localhost:5000`

### 环境变量

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `DEPLOY_RUN_PORT` | 服务监听端口 | 否（默认 5000） |
| `COZE_API_KEY` | AI 服务 API Key | 是 |
| `COZE_BUCKET_ENDPOINT_URL` | 对象存储 Endpoint | 是 |
| `COZE_BUCKET_NAME` | 对象存储桶名 | 是 |

## 🏗️ 技术架构

```
┌──────────────────────────────────────────────────────┐
│                    DemoVerse 架构                     │
├──────────────────────────────────────────────────────┤
│                                                      │
│  用户输入 URL ──→ Express API ──→ 任务队列            │
│                                    │                 │
│                    ┌───────────────┼───────────────┐ │
│                    ▼               ▼               ▼ │
│              ┌─────────┐   ┌─────────┐   ┌───────┐ │
│              │  Agent   │   │Recorder │   │Narrator│ │
│              │ 页面分析  │   │ 全程录屏 │   │AI解说  │ │
│              │ 路径规划  │   │ 帧截图   │   │TTS配音 │ │
│              │ 交互执行  │   │ 视觉增强 │   │SRT字幕 │ │
│              └────┬─────┘   └────┬────┘   └───┬───┘ │
│                   │              │            │      │
│                   └──────┬───────┘            │      │
│                          ▼                    │      │
│                    ┌──────────┐               │      │
│                    │  Video   │◄──────────────┘      │
│                    │ FFmpeg   │                      │
│                    │ 合成+字幕 │                      │
│                    └────┬─────┘                      │
│                         ▼                            │
│                    ┌──────────┐                      │
│                    │ Storage  │                      │
│                    │ S3 上传   │                      │
│                    └──────────┘                      │
└──────────────────────────────────────────────────────┘
```

### 核心模块

| 文件 | 说明 |
|------|------|
| `server.js` | Express 主服务器，API 路由 + 视频生成调度 |
| `lib/agent.js` | 智能浏览 Agent（页面分析 + 路径规划 + 交互执行） |
| `lib/recorder.js` | Puppeteer 全程录屏录制（帧截图 + 标题页/结尾页） |
| `lib/narrator.js` | AI 解说模块（分步 LLM 脚本 + 分段 TTS + SRT/ASS 字幕） |
| `lib/video.js` | FFmpeg 视频编译（帧→视频 + 音频合并 + 字幕烧录） |
| `lib/storage.js` | 对象存储（S3Storage 封装） |
| `lib/queue.js` | 内存任务队列（Job 生命周期管理） |

### 智能浏览视频生成管线

1. **智能浏览** (`agent.js` + `recorder.js`)
   - Agent 打开页面 → 提取可交互元素（导航、按钮、Tab、链接等）
   - LLM 分析页面结构 → 规划完整演示路径
   - 执行每个动作时停留 3-5 秒，注入视觉增强（高亮光圈、平滑滚动、缩放效果）
   - 录屏模式：逐帧截图 + 关键帧截图双轨并行
   - 开场标题页 + 结尾页自动生成

2. **AI 解说** (`narrator.js`)
   - 产品级解说结构：开头定位痛点 → 中间功能讲解 → 结尾价值总结
   - 每步独立 LLM 生成，解说与画面完全同步
   - 分段 TTS 合成 + 自动生成 SRT/ASS 字幕

3. **视频合成** (`video.js`)
   - FFmpeg 逐帧编码为 H.264 视频
   - 分段音频合并，确保音画同步
   - ASS 字幕烧录

4. **云端存储** (`storage.js`)
   - 上传 MP4 到 S3 对象存储 → 生成签名 URL

### 技术栈

- **后端**: Node.js + Express
- **页面录制**: Puppeteer-core
- **视频合成**: FFmpeg (H.264 + AAC + ASS)
- **AI 能力**: coze-coding-dev-sdk (LLM + TTS + S3Storage)
- **前端**: 原生 HTML/CSS/JS

## 🌐 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/generate` | 创建视频生成任务 |
| `GET` | `/api/status/:id` | 查询任务状态和进度 |
| `GET` | `/api/jobs` | 获取所有任务列表 |
| `DELETE` | `/api/jobs/:id` | 删除指定任务 |
| `GET` | `/api/download/:id` | 获取视频签名下载链接 |

### 请求示例

```bash
# 生成视频
curl -X POST http://localhost:5000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://your-project.com",
    "style": "professional",
    "voice": "yunxi_male",
    "platform": "bilibili"
  }'

# 查询进度
curl http://localhost:5000/api/status/<job-id>
```

### 选项参数

| 参数 | 字段 | 可选值 |
|------|------|--------|
| 风格 | `style` | `professional`(专业简洁) / `casual`(轻松亲切) / `energetic`(活力激情) |
| 配音 | `voice` | `yunxi_male`(云希男声) / `xiaoxiao_female`(晓晓女声) |
| 平台 | `platform` | `bilibili`(16:9) / `douyin`(9:16) / `xiaohongshu`(3:4) / `youtube`(16:9) / `wechat`(9:16) / `zhihu`(16:9) / `custom` |

## 📦 部署

### Docker 部署

```dockerfile
FROM node:18-slim
RUN apt-get update && apt-get install -y ffmpeg chromium && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install
COPY . .
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV DEPLOY_RUN_PORT=5000
EXPOSE 5000
CMD ["node", "server.js"]
```

### 环境变量部署

设置以下环境变量后直接运行 `node server.js`：

- `COZE_API_KEY` — AI 服务密钥
- `COZE_BUCKET_ENDPOINT_URL` — S3 存储 Endpoint
- `COZE_BUCKET_NAME` — S3 存储桶名
- `PUPPETEER_EXECUTABLE_PATH` — Chromium 路径（默认自动检测）

## ❓ FAQ

**Q: 支持哪些网站？**
A: 支持所有可公开访问的网站。SPA 单页应用也能正常录制，Agent 会等待页面加载完成后再分析。

**Q: 生成的视频多长？**
A: 标准时长 60-90 秒，根据页面复杂度自动调整。简单页面约 40-60 秒，复杂页面可达 2 分钟。

**Q: 为什么视频没有声音？**
A: 请检查 `COZE_API_KEY` 是否正确配置。TTS 服务需要有效的 API Key。

**Q: 支持自定义分辨率吗？**
A: 支持。选择 `custom` 平台后默认输出 1920×1080，可在代码中修改 `OUTPUT_SIZE_MAP`。

**Q: 可以批量生成吗？**
A: 可以。通过 API 循环调用 `/api/generate`，系统内置任务队列管理。

## 📄 许可证

[MIT License](LICENSE)

---

<div align="center">
Made with ❤️ by DemoVerse Team
</div>
