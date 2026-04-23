# Bilibili Discord Audio Bot

一个功能完整的 Discord 机器人，支持从 Bilibili 视频播放音频，具有丰富的可视化界面和交互式控制功能。

## 📁 项目结构

项目采用分层架构，以 `src/playback/AudioPlayer` 为中心的命令式实现为主，
周边 `src/domain/`、`src/app/`、`src/infra/` 是正在渐进引入的
Clean Architecture 切片（当前仅承载部分类型/工具，未替换主播放路径）：

- `src/` - 源代码
- `tests/` - 测试套件（unit / integration / regression / manual）
- `docs/` - 项目文档
- `scripts/` - 部署与开发辅助脚本

详细结构说明请查看 [directory-structure.md](docs/directory-structure.md)

## 🎯 功能概览

- **Bilibili 音频提取**：支持 BV/av/b23.tv/移动端等所有主流 URL，带参数（`?p=`、`?t=`）亦可
- **Discord 语音播放**：通过 `@discordjs/voice` + FFmpeg 串流
- **队列管理**：顺序/单曲循环/列表循环三种模式，支持上一首/下一首/跳过/停止
- **可视化界面**：Rich Embed + 交互按钮，进度条实时更新
- **CDN 异常自愈**：签名 URL 过期或 403/5xx 自动重拉 + 指数退避重试
- **空闲自动断开**：无人播放时自动退出语音频道

## 🤖 Discord 命令

共 11 个斜杠命令：

| 命令 | 说明 |
|------|------|
| `/play <url \| 关键字>` | 播放或加入队列 |
| `/pause` | 暂停 |
| `/resume` | 继续 |
| `/skip` | 跳到下一首 |
| `/prev` | 返回上一首 |
| `/stop` | 停止并清空队列 |
| `/queue` | 显示当前队列 |
| `/nowplaying` | 显示当前播放信息 |
| `/search <关键字>` | Bilibili 搜索并加入队列 |
| `/hachimi` | 随机哈基米相关视频 |
| `/help` | 显示帮助 |

## 🎨 UI

- **Rich Embed**：标题、封面缩略图、上传者、时长、当前位置
- **实时进度条**：`██████████░░░░░░░░░░ 2:34 / 5:12`（20 格，`█` 已播放 / `░` 剩余）
- **交互按钮**（6 个）：⏮️ 上一首 · ⏯️ 暂停/继续 · ⏹️ 停止 · ⏭️ 下一首 · 🔁 循环 · 📋 队列
- **自适应刷新**：ProgressTracker 使用自驱动 setTimeout 链（而非固定 setInterval），
  当 Discord 响应慢时自动补齐节奏，避免长时间运行后进度条变慢或失准

## 🛠 安装和配置

### 前置要求

- Node.js 18.x+
- Python 3.8+（用于 yt-dlp）
- **FFmpeg**（必需，用于音频转码）
- yt-dlp（`pip install yt-dlp`）

### 安装步骤

```bash
# 1. 克隆项目
git clone <repository-url>
cd bilibili-discord-bot

# 2. 安装依赖
npm install
pip install yt-dlp

# 3. 配置环境
cp .env.example .env
# 编辑 .env 文件，至少填入 DISCORD_TOKEN / CLIENT_ID

# 4. 部署命令到 Discord
npm run deploy:commands

# 5. 启动机器人
npm start
```

### 环境变量配置

常用变量（完整清单以 `.env.example` 为准）：

```env
# Discord
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_application_id_here
GUILD_ID=                      # 可选，仅用于 guild-scoped 命令部署

# 运行环境
NODE_ENV=production
LOG_LEVEL=info                 # error | warn | info | debug | verbose | silly
LOG_TO_FILE=true               # 容器内建议设 false（只写 stdout）
LOG_FILE=bot.log

# 播放 / 队列
MAX_QUEUE_SIZE=50
EXTRACTION_TIMEOUT=30000
INACTIVITY_TIMEOUT=300000
ENABLE_UNLIMITED_LENGTH=true

# FFmpeg 活跃度监控
FFMPEG_ACTIVITY_CHECK_INTERVAL=10000
FFMPEG_INACTIVE_WARNING_THRESHOLD=30000
FFMPEG_INACTIVE_KILL_THRESHOLD=60000

# CDN 重试（指数退避：base * multiplier^(N-1)，上限 max）
RETRY_CDN_BACKOFF_BASE_MS=3000
RETRY_CDN_BACKOFF_MULTIPLIER=5
RETRY_CDN_BACKOFF_MAX_MS=30000

# Bilibili 鉴权（云端/风控环境需要）
BILIBILI_COOKIES_FILE=/app/cookies.txt   # Netscape 格式 cookies 文件路径

# 可观测性（可选）
METRICS_ENABLED=false
# METRICS_HOST=127.0.0.1
# METRICS_PORT=9090
```

## 🚢 生产环境部署

### Docker 部署

```bash
# 1. 配置环境变量
cp .env.example .env
nano .env  # 至少填入 DISCORD_TOKEN

# 2. 构建并启动
npm run docker:build
docker compose up -d

# 3. 查看日志
docker compose logs -f
```

完整部署指南见 [docs/deployment-guide.md](./docs/deployment-guide.md)。

### 本地运行

```bash
npm run dev     # 开发模式（nodemon）
npm start       # 生产模式
```

## 🧪 测试

```bash
# Jest 单元 / 集成 / 回归测试
npm test
npm run test:coverage

# Lint
npm run lint
npm run lint:fix

# 手动脚本测试（针对真实 URL / 真实 Bot）
npm run test:audio       # 音频提取
npm run test:extractor
npm run test:discord
npm run test:player
npm run test:system      # 端到端
```

目录结构：

```
tests/
├── unit/            # 纯单元测试
├── integration/     # 模块间集成
├── regression/      # 历史 bug 回归网（CDN 重试、暂停恢复、监听器泄漏等）
├── manual/          # 针对真实服务的手动脚本
├── utils/           # 共享 mock 与测试工具
└── setup.js         # Jest 全局配置 / mock
```

## 📦 源码结构

```
src/
├── bilibili/      # Bilibili URL 解析、API、校验
├── bot/           # Discord client 外壳、command handler、事件
├── config/        # 配置加载与校验
├── models/        # Track 等数据模型
├── playback/      # AudioPlayer / CDN 重试（当前播放主路径）
├── services/      # 日志、队列、播放门面等服务层
├── session/       # 每 guild 会话状态
├── ui/            # Embed、按钮、进度追踪
├── utils/         # 通用工具
├── domain/        # 新架构切片（类型 / 纯逻辑，渐进接入中）
├── app/           # 新架构切片（协调层，渐进接入中）
├── infra/         # 新架构切片（基础设施，渐进接入中）
└── index.js       # 组装和入口

scripts/
├── deploy/        # 部署脚本（release、build、cookie 更新）
├── tools/         # 开发辅助（bot-tools 等）
├── setup/         # 首次安装辅助
└── deploy-commands.js  # 斜杠命令注册
```

## 🤝 贡献

欢迎提交 Issues 和 Pull Requests。

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

---

**版本**: 1.0.0
