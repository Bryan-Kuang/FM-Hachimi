# 技术架构文档

## Discord Bilibili 音频机器人

### 1. 技术栈

#### 1.1 核心技术

- **运行环境**: Node.js 18.x+
- **编程语言**: JavaScript (ES2022)
- **Discord 库**: Discord.js v14.14+
- **音频库**: @discordjs/voice v0.16+
- **包管理器**: npm

#### 1.2 音频处理

- **音频提取**: yt-dlp (通过 child_process 调用的 Python 工具)
- **音频处理**: FFmpeg
- **音频编码**: @discordjs/opus 用于 Discord 兼容性
- **流媒体**: Node.js 流用于实时音频传输

#### 1.3 外部依赖

```json
{
  "discord.js": "^14.14.1",
  "@discordjs/voice": "^0.16.1",
  "@discordjs/opus": "^0.9.0",
  "axios": "^1.6.0",
  "yt-dlp-wrap": "^2.3.12",
  "ffmpeg-static": "^5.2.0",
  "node-opus": "^0.3.3",
  "winston": "^3.11.0",
  "dotenv": "^16.3.1",
  "canvas": "^2.11.2",
  "moment": "^2.29.4"
}
```

### 2. 系统架构

#### 2.1 高级架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│                 │    │                 │    │                 │
│   Discord API   │◄──►│   机器人服务   │◄──►│   音频处理器   │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                ▼                       ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │                 │    │                 │
                       │   队列管理器   │    │   Bilibili API  │
                       │                 │    │                 │
                       └─────────────────┘    └─────────────────┘
```

#### 2.2 模块结构

```
src/
├── bot/
│   ├── client.js           # Discord客户端初始化
│   ├── commands/           # 斜杠命令处理器
│   └── events/             # 事件处理器
├── bilibili/
│   ├── extractor.js        # Bilibili音频提取
│   ├── api.js              # Bilibili API交互
│   └── validator.js        # B站URL验证
├── playback/
│   └── audio_player.js     # 音频播放管理（状态机实现）
├── session/
│   ├── session_manager.js  # 会话调度器
│   ├── guild_session.js    # 单个公会会话封装
│   └── audio_manager.js    # 音频生命周期管理
├── services/
│   ├── playback_service.js # 播放服务层
│   ├── queue_service.js    # 队列服务层
│   └── logger_service.js   # 日志中心
├── models/
│   └── track.js            # 音分轨数据模型
├── ui/
│   ├── embeds.js           # 富嵌入生成器
│   ├── buttons.js          # 交互式按钮组件
│   └── progress_tracker.js # 进度条可视化
├── utils/
│   ├── cleanup.js          # 进程退出清理
│   ├── debug.js            # 调试辅助
│   ├── formatters.js       # 格式化工具
│   └── ...                 # 其他工具
├── config/
│   └── config.js           # 配置管理
└── index.js                # 应用程序入口点
```

### 3. 音频处理流程

#### 3.1 音频提取流程

```
Bilibili URL → URL验证 → yt-dlp → 音频流 → FFmpeg → Opus → Discord
```

#### 3.2 处理步骤

1. **URL 解析**: 从各种 Bilibili URL 格式中提取视频 ID
2. **元数据获取**: 获取视频标题、时长和流信息
3. **音频提取**: 使用 yt-dlp 提取音频流 URL
4. **格式转换**: 使用 FFmpeg 转换为 Discord 兼容格式
5. **Opus 编码**: 为 Discord 语音传输编码音频
6. **流媒体**: 将处理后的音频流式传输到 Discord 语音频道

#### 3.3 支持的 URL 格式

- `https://www.bilibili.com/video/BV*`
- `https://www.bilibili.com/video/av*`
- `https://b23.tv/*` (短链接)
- `https://m.bilibili.com/video/*` (移动端链接)

### 4. 队列管理系统

#### 4.1 队列结构

```javascript
class AudioQueue {
  constructor() {
    this.items = []; // QueueItem对象数组
    this.currentIndex = -1; // 当前播放项目的索引
    this.isPlaying = false; // 播放状态
    this.isPaused = false; // 暂停状态
  }
}

class QueueItem {
  constructor(url, title, duration, requestedBy) {
    this.url = url;
    this.title = title;
    this.duration = duration;
    this.requestedBy = requestedBy;
    this.addedAt = new Date();
  }
}
```

#### 4.2 队列操作

- **添加**: 向队列添加新项目
- **下一首**: 移动到队列中的下一项
- **上一首**: 移动到队列中的上一项
- **移除**: 从队列中移除特定项目
- **清空**: 清空整个队列
- **随机播放**: 随机化队列顺序（未来功能）

### 5. Discord 集成与 UI

#### 5.1 斜杠命令实现

```javascript
// 命令结构
{
  name: 'play',
  description: '播放Bilibili视频的音频',
  options: [{
    name: 'url',
    description: 'Bilibili视频URL',
    type: ApplicationCommandOptionType.String,
    required: true
  }]
}
```

#### 5.2 富嵌入系统

```javascript
// 播放嵌入结构
const playbackEmbed = new EmbedBuilder()
  .setTitle("🎵 正在播放")
  .setDescription(`**${videoTitle}**`)
  .setThumbnail(videoThumbnail)
  .addFields(
    { name: "⏱️ 时长", value: formatTime(duration), inline: true },
    { name: "👤 请求者", value: user.displayName, inline: true },
    {
      name: "📊 进度",
      value: generateProgressBar(currentTime, duration),
      inline: false,
    }
  )
  .setColor(0x00ae86)
  .setTimestamp();
```

#### 5.3 交互式组件

```javascript
// 控制按钮
const controlRow = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId("prev")
    .setLabel("⏮️")
    .setStyle(ButtonStyle.Secondary),
  new ButtonBuilder()
    .setCustomId("pause_resume")
    .setLabel(isPlaying ? "⏸️" : "▶️")
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId("skip")
    .setLabel("⏭️")
    .setStyle(ButtonStyle.Secondary),
  new ButtonBuilder()
    .setCustomId("queue")
    .setLabel("📋")
    .setStyle(ButtonStyle.Secondary)
);
```

#### 5.4 进度条可视化

```javascript
// Unicode进度条生成
function generateProgressBar(current, total, length = 20) {
  const progress = Math.round((current / total) * length);
  const emptyProgress = length - progress;

  const progressText = "█".repeat(progress);
  const emptyProgressText = "░".repeat(emptyProgress);

  const percentage = Math.round((current / total) * 100);
  const currentFormatted = formatTime(current);
  const totalFormatted = formatTime(total);

  return `${progressText}${emptyProgressText} ${percentage}% | ${currentFormatted} / ${totalFormatted}`;
}
```

#### 5.5 实时更新

- **自动刷新**: 播放期间每 15 秒更新嵌入
- **事件驱动**: 播放/暂停/跳过事件时立即更新
- **状态同步**: 将视觉状态与实际播放状态同步
- **错误显示**: 显示连接问题和失败

#### 5.6 语音连接管理

- **连接建立**: 连接到用户的语音频道
- **连接持久性**: 在播放期间保持连接
- **自动断开**: 在不活动超时后断开连接
- **重连逻辑**: 优雅地处理连接中断

### 6. 错误处理策略

#### 6.1 错误类别

- **网络错误**: 连接失败，超时
- **API 错误**: Bilibili API 变更，速率限制
- **音频错误**: 提取失败，格式问题
- **Discord 错误**: 语音连接问题，权限错误

#### 6.2 错误恢复

```javascript
class ErrorHandler {
  static async handleAudioError(error, context) {
    switch (error.type) {
      case "EXTRACTION_FAILED":
        return this.retryExtraction(context);
      case "CONNECTION_LOST":
        return this.reconnectVoice(context);
      case "FORMAT_UNSUPPORTED":
        return this.fallbackFormat(context);
      default:
        return this.logAndNotify(error, context);
    }
  }
}
```

### 7. 性能优化

#### 7.1 内存管理

- **流处理**: 分块处理音频以最小化内存使用
- **垃圾回收**: 播放后正确释放资源
- **连接池**: 尽可能重用连接

#### 7.2 缓存策略

- **元数据缓存**: 缓存视频信息 1 小时
- **流 URL 缓存**: 缓存直接流 URL 30 分钟
- **用户偏好**: 缓存用户设置（未来功能）

#### 7.3 速率限制

- **命令速率限制**: 每用户每分钟最多 5 个命令
- **队列大小限制**: 每队列最多 50 个项目
- **并发处理**: 最多 3 个同时音频提取

### 8. 安全考虑

#### 8.1 输入验证

- **URL 清理**: 验证并清理所有输入 URL
- **命令验证**: 验证命令参数
- **权限检查**: 确保用户有语音频道访问权限

#### 8.2 资源保护

- **进程隔离**: 在隔离的子进程中运行 yt-dlp
- **超时限制**: 为所有外部操作设置超时
- **资源监控**: 监控 CPU 和内存使用

### 9. 部署架构

#### 9.1 环境配置

```javascript
// config/config.js
module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
  },
  audio: {
    maxQueueSize: 50,
    extractionTimeout: 30000,
    inactivityTimeout: 300000,
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: process.env.LOG_FILE || "bot.log",
  },
};
```

#### 9.2 进程管理

- **PM2**: 用于生产部署的进程管理器
- **健康检查**: 定期健康监控
- **自动重启**: 崩溃时自动重启
- **日志轮转**: 防止日志文件过大

### 10. 开发工作流

#### 10.1 开发设置

1. 安装 Node.js 18.x+
2. 安装 Python 3.8+（用于 yt-dlp）
3. 安装 FFmpeg
4. 克隆仓库并安装依赖
5. 配置环境变量
6. 启动开发服务器

#### 10.2 测试策略

- **单元测试**: 测试单个模块
- **集成测试**: 测试 Discord API 集成
- **音频测试**: 测试音频提取和播放
- **错误测试**: 测试错误处理场景

#### 10.3 构建过程

```bash
# 开发
npm run dev

# 生产构建
npm run build

# 部署
npm run deploy
```

### 11. 监控和日志

#### 11.1 日志级别

- **ERROR**: 需要立即关注的关键错误
- **WARN**: 应该被监控的非关键问题
- **INFO**: 关于机器人操作的一般信息
- **DEBUG**: 详细的调试信息（仅开发）

#### 11.2 指标跟踪

- **命令使用**: 跟踪命令频率和成功率
- **音频质量**: 监控提取成功和失败率
- **性能**: 跟踪响应时间和资源使用
- **用户活动**: 监控活跃用户和队列使用

---

**文档版本:** 1.1  
**最后更新:** 2026 年 4 月 7 日  
**审核状态:** 已审核  
**依赖:** PRD v1.1
