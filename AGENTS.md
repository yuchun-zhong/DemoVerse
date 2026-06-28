# AGENTS.md - DemoVerse 项目规范

## 项目概览

DemoVerse 是一个 AI 驱动的智能 Demo 视频生成器。用户输入项目链接，系统自动使用智能浏览 Agent 探索页面、LLM 同步生成解说脚本、TTS 合成语音、FFmpeg 编译视频，最终输出带有 AI 解说和字幕的 MP4 演示视频。

**技术栈**: Node.js + Express + Puppeteer + FFmpeg + coze-coding-dev-sdk (LLM/TTS/Storage)

## 项目结构

```
├── server.js              # Express 主服务器，API 路由 + 视频生成调度
├── lib/
│   ├── agent.js           # 智能浏览 Agent（页面分析+路径规划+交互执行+录屏注入）
│   ├── recorder.js        # Puppeteer 全程录屏录制（ScreencastSession + 逐帧截图）
│   ├── narrator.js        # AI 解说模块（分步 LLM 脚本 + 分段 TTS 音频 + SRT 字幕）
│   ├── video.js           # FFmpeg 视频编译（逐帧截图→视频 + 音频合并 + SRT 字幕烧录）
│   ├── storage.js         # 对象存储（S3Storage 封装）
│   └── queue.js           # 内存任务队列（Job 生命周期管理 + 选项参数）
├── public/
│   ├── index.html         # 前端主页面（Vercel 极简黑风格）
│   ├── css/style.css      # 样式（纯黑背景+紫色光晕+紫色强调色）
│   └── js/app.js          # 前端交互逻辑（4步进度+视频预览+脚本展示）
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
| POST | `/api/generate` | 创建视频生成任务，body: `{url, style?, voice?, platform?}` |
| GET | `/api/status/:id` | 查询任务状态和进度 |
| GET | `/api/jobs` | 获取所有任务列表 |
| DELETE | `/api/jobs/:id` | 删除指定任务 |
| GET | `/api/download/:id` | 获取视频签名下载链接 |

### 选项参数

| 参数 | 字段 | 可选值 |
|------|------|--------|
| 风格 | `style` | `professional`(专业简洁) / `casual`(轻松亲切) / `energetic`(活力激情) |
| 配音 | `voice` | `yunxi_male`(云希男声) / `xiaoxiao_female`(晓晓女声) |
| 平台 | `platform` | `bilibili`(16:9) / `douyin`(9:16) / `xiaohongshu`(3:4) / `youtube`(16:9) / `wechat`(9:16) / `zhihu`(16:9) / `custom` |

## 智能浏览视频生成管线

1. **智能浏览** (`lib/agent.js` + `lib/recorder.js`):
   - Agent 打开页面 → 提取可交互元素（导航、按钮、Tab、链接等）
   - LLM 分析页面结构 → 规划浏览路径（点击导航→滚动→悬停→点击功能→填表单）
   - 执行每个动作时停留 3-5 秒，注入视觉增强（高亮光圈、平滑滚动、缩放效果）
   - 录屏模式：ScreencastSession 逐帧截图 + 关键帧截图双轨并行
2. **AI 解说** (`lib/narrator.js`):
   - 分步生成：每个浏览步骤独立调用 LLM 生成对应解说词
   - 解说与画面完全同步：操作A → 解说A，操作B → 解说B
   - 分段 TTS：每段解说独立合成音频
   - 自动生成 SRT 字幕文件
3. **视频合成** (`lib/video.js`):
   - FFmpeg 将逐帧截图编码为 H.264 视频
   - 分段合并音频轨道，确保音画同步
   - SRT 字幕烧录到视频
   - 入场动画（标题页）+ 结尾总结画面
4. **云端存储** (`lib/storage.js`): 上传 MP4 到 S3 对象存储 → 生成签名 URL

## 环境依赖

- **Chromium**: `/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome`（Puppeteer-core 使用）
- **FFmpeg**: 系统 `/usr/bin/ffmpeg`（6.1.1+，需支持 libass 字幕烧录）
- **环境变量**: `DEPLOY_RUN_PORT`(服务端口), `COZE_BUCKET_ENDPOINT_URL`(对象存储), `COZE_BUCKET_NAME`(桶名)

## 代码风格指南

- ESM 模块 (`"type": "module"` in package.json)
- 异步优先：所有 IO 操作使用 async/await
- 错误处理：try/catch 包裹外部调用，降级策略保证核心流程不中断
- 前端：原生 HTML/CSS/JS，CSS 变量体系，SVG 内联图标

## 设计规范

详见 `DESIGN.md`：纯黑背景 + 微弱紫色光晕 + Vercel 极简黑设计语言
