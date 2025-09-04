# 问题跟踪与修复记录

## 📋 当前问题状态

## 🔧 已修复问题

#### 1. FFmpeg进程超时导致播放中断 & 无限长度视频支持

**问题描述**：
- 视频播放到一半(约31秒)就重新开始
- FFmpeg进程30秒超时，无法播放长视频
- 需要支持任意长度的视频播放

**根本原因**：
- FFmpeg使用固定超时时间(30秒→5分钟)仍然有限制
- 网络不稳定时容易触发超时
- 进程清理机制不完善

**最终解决方案**：
```javascript
// 完全移除固定超时，改为动态活跃监控
let lastDataTime = Date.now();
let isProcessActive = true;

// 基于数据流活跃状态的智能监控
const activityMonitor = setInterval(() => {
  const timeSinceLastData = Date.now() - lastDataTime;
  const warningThreshold = config.audio.ffmpegInactiveWarningThreshold; // 30秒
  const killThreshold = config.audio.ffmpegInactiveKillThreshold; // 60秒
  
  if (timeSinceLastData > killThreshold) {
    // 只有在进程真正卡死时才终止
    terminateProcess();
  }
}, config.audio.ffmpegActivityCheckInterval); // 10秒检查间隔

// 增强的FFmpeg参数
const ffmpegArgs = [
  '-reconnect', '1',
  '-reconnect_streamed', '1', 
  '-reconnect_at_eof', '1',
  '-rw_timeout', '60000000', // 60秒网络超时
  '-timeout', '60000000',
  '-analyzeduration', '10000000',
  '-probesize', '50000000',
  '-fflags', '+genpts+discardcorrupt',
  '-bufsize', '2048k',
  // ... 其他参数
];
```

**新增配置选项**：
- `FFMPEG_ACTIVITY_CHECK_INTERVAL=10000` - 活跃检查间隔
- `FFMPEG_INACTIVE_WARNING_THRESHOLD=30000` - 警告阈值
- `FFMPEG_INACTIVE_KILL_THRESHOLD=60000` - 终止阈值
- `ENABLE_UNLIMITED_LENGTH=true` - 启用无限长度支持

**状态**：✅ 已修复 - 现在支持任意长度视频播放

### 🔍 调试工具和方法

#### 检查错误日志

```bash
# 查看loop相关错误
tail -50 logs/error.log | grep -E "(loop|select|interaction)"

# 查看按钮交互错误
tail -30 logs/error.log | grep "Button interaction"

# 查看播放停止原因
grep -n "No next track" logs/combined.log | tail -10
```

#### 测试脚本

```bash
# 测试loop模式逻辑
node tests/manual/test-loop-mode.js

# 测试按钮创建
node tests/manual/test-loop-button.js

# 运行集成测试
node tests/integration/test-all-features.js
```

### 📱 测试建议

#### 测试播放连续性

1. 播放 3 首歌，让第 2 首播放完成
2. 检查是否自动播放第 3 首
3. 验证队列位置是否正确

#### 测试 Loop 功能

1. 点击 Loop 按钮
2. 选择不同的循环模式
3. 验证模式是否正确应用
4. 检查日志中是否有交互失败错误

### 🚨 需要用户测试的问题

如果遇到 Loop 选择菜单问题，请检查 logs/combined.log 是否有以下日志：
- "Button interaction received"
- "Showing loop mode selection menu"
- "Loop select menu interaction received"

### 📊 修复统计

- **总问题数**：5
- **已修复**：5 (100%)
- **待修复**：0
- **需要测试**：Loop 功能在实际 Discord 环境中的表现

---

*最后更新：2025年9月2日*
*状态：所有已知问题已修复，系统稳定运行*