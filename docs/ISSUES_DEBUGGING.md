# 问题调试记录

## 📋 当前问题总结

### 1. Loop 选择菜单显示"interaction failed"

- **症状**：点击 loop 按钮后，选择菜单出现但选择后显示失败
- **原因**：Discord 交互 3 秒超时限制
- **状态**：已添加 deferReply 但问题仍存在

### 2. 播放自动停止

- **症状**：播放一段时间后自动停止，bot 不退出
- **原因**：
  - `playbackDuration`在 Raw PCM 模式下始终为 0
  - 系统误判为播放失败，触发重试机制
  - 达到最大重试次数(2 次)后停止
- **修复**：使用实际播放时间(startTime)替代 playbackDuration

### 3. Loop 模式未生效

- **症状**：所有日志显示 loopMode 为"none"
- **原因**：用户无法成功选择 loop 模式

## 🔍 调试步骤

### 检查错误日志

```bash
# 查看loop相关错误
tail -50 error.log | grep -E "(loop|select|interaction)"

# 查看按钮交互错误
tail -30 error.log | grep "Button interaction"

# 查看播放停止原因
grep -n "No next track" bot.log | tail -10
```

### 测试脚本

```bash
# 测试loop模式逻辑
node tests/manual/test-loop-mode.js

# 测试按钮创建
node tests/manual/test-loop-button.js

# 运行集成测试
node tests/integration/test-all-features.js
```

## 🛠️ 已应用的修复

### 1. 播放时长检测改进

```javascript
// 使用实际播放时间而不是playbackDuration
const actualPlaybackDuration = this.startTime ? Date.now() - this.startTime : 0;

if (
  actualPlaybackDuration > 3000 ||
  (this.currentTrack?.duration &&
    actualPlaybackDuration >= (this.currentTrack.duration - 2) * 1000)
) {
  // 正常结束
  this.handleTrackEnd();
}
```

### 2. Loop 选择菜单优化

```javascript
// 立即defer响应避免超时
await interaction.deferReply({ ephemeral: true });
// 处理后使用editReply
await interaction.editReply({ embeds: [successEmbed] });
```

### 3. 调试日志增强

- 添加按钮交互调试日志
- 记录实际播放时长
- 跟踪 loop 模式变化

## 🎯 下一步行动

1. **验证修复效果**

   - 测试播放是否能持续超过 3 秒
   - 检查 loop 选择是否成功保存

2. **可能的额外修复**

   - 检查 FFmpeg "Broken pipe"错误原因
   - 优化音频资源创建流程
   - 考虑使用不同的音频格式

3. **长期改进**
   - 实现更智能的重试机制
   - 添加播放状态监控
   - 改进错误恢复策略
