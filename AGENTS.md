# AGENTS.md - DemoVerse 项目规范

## 项目概览

DemoVerse 是一个 AI 驱动的 Demo 视频生成器。用户输入项目链接，系统自动使用 Puppeteer 录制页面、LLM 生成解说脚本、TTS 合成语音、FFmpeg 编译视频，最终输出带有 AI 解说的 MP4 演示视频。

**技术栈**: Node.js + Express + Puppeteer + FFmpeg + coze-coding-dev-sdk (LLM/TTS/Storage)

## 项目结构

```
├── server.js              # Express 主服务器，API 路由 + 视频生成调度
├── lib/
│   ├── recorder.js        # Puppeteer 页面录制（截图+交互）
│   ├── video.js           # FFmpeg 视频编译（截图→视频，音视频合并）
│   ├── narrator.js        # AI 解说模块（LLM 脚本 + TTS 音频）
│   ├── storage.js         # 对象存储（S3Storage 封装）
│   └── queue.js           # 内存任务队列（Job 生命周期管理）
├── public/
│   ├── index.html         # 前端主页面
│   ├── css/style.css      # 样式（暗色主题，荧光青绿强调色）
│   └── js/app.js          # 前端交互逻辑
├── package.json           # 依赖管理（pnpm）
├── .coze                  # 部署配置
├── DESIGN.md              # 设计规范
└── AGENTS.md              # 本文件
```

## 构建和运行命令

- **安装依赖**: `pnpm install`
- **开发启动**: `node server.js`（端口从 `DEPLOY_RUN_PORT` 环境变量读取，默认 5000）
- **生产启动**: 同上

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/generate` | 创建视频生成任务，body: `{url: string}` |
| GET | `/api/status/:id` | 查询任务状态和进度 |
| GET | `/api/jobs` | 获取所有任务列表 |
| DELETE | `/api/jobs/:id` | 删除指定任务 |
| GET | `/api/download/:id` | 获取视频签名下载链接 |

## 视频生成管线

1. **页面录制** (`lib/recorder.js`): Puppeteer 启动 Chromium → 加载 URL → 截取首屏 → 滚动截图 → 模拟点击交互
2. **AI 解说** (`lib/narrator.js`): LLM 分析页面文本内容 → 生成 30-60 秒解说脚本 → TTS 合成 MP3 音频
3. **视频合成** (`lib/video.js`): FFmpeg 将截图序列编码为 H.264 视频 → 可选合并音频轨道
4. **云端存储** (`lib/storage.js`): 上传 MP4 到 S3 对象存储 → 生成签名 URL

## 环境依赖

- **Chromium**: `/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome`（Puppeteer-core 使用）
- **FFmpeg**: 系统 `/usr/bin/ffmpeg`（6.1.1）
- **环境变量**: `DEPLOY_RUN_PORT`(服务端口), `COZE_BUCKET_ENDPOINT_URL`(对象存储), `COZE_BUCKET_NAME`(桶名)

## 代码风格指南

- ESM 模块 (`"type": "module"` in package.json)
- 异步优先：所有 IO 操作使用 async/await
- 错误处理：try/catch 包裹外部调用，降级策略保证核心流程不中断
- 前端：原生 HTML/CSS/JS，Tailwind 风格的 CSS 变量体系，Lucide 图标

## 设计规范

详见 `DESIGN.md`：深空蓝黑背景 + 荧光青绿强调色 + 专业剪辑室气质
