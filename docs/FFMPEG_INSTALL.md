# FFmpeg 安装指南

FFmpeg 是音频播放的必需依赖。如果没有安装 FFmpeg，机器人可以提取视频信息但无法播放音频。

## 🍎 macOS 安装方法

### 方法 1: 使用 Homebrew (推荐)

```bash
# 如果网络正常
brew install ffmpeg

# 如果网络有问题，可以尝试更换源
export HOMEBREW_BOTTLE_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles
brew install ffmpeg
```

### 方法 2: 使用 MacPorts

```bash
sudo port install ffmpeg
```

### 方法 3: 下载预编译版本

1. 访问：https://ffmpeg.org/download.html#build-mac
2. 下载静态构建版本
3. 解压到 `/usr/local/bin/` 或添加到 PATH

## 🐧 Linux 安装方法

### Ubuntu/Debian

```bash
sudo apt update
sudo apt install ffmpeg
```

### CentOS/RHEL

```bash
sudo yum install ffmpeg
# 或
sudo dnf install ffmpeg
```

## 🪟 Windows 安装方法

### 方法 1: 使用 Chocolatey

```bash
choco install ffmpeg
```

### 方法 2: 手动安装

1. 访问：https://ffmpeg.org/download.html#build-windows
2. 下载 Windows 构建版本
3. 解压并添加到系统 PATH

## ✅ 验证安装

安装完成后，验证 FFmpeg 是否可用：

```bash
ffmpeg -version
```

应该显示 FFmpeg 版本信息。

## 🔄 安装后操作

安装 FFmpeg 后：

1. **重启机器人**：

   ```bash
   ./debug-tools.sh restart
   ```

2. **验证系统状态**：

   ```bash
   ./debug-tools.sh
   ```

3. **测试播放**：
   在 Discord 中使用 `/play url:https://www.bilibili.com/video/BV1uv4y1q7Mv`

## 🛠️ 故障排除

### 如果仍然无法播放：

1. **检查 FFmpeg 路径**：

   ```bash
   which ffmpeg
   ```

2. **查看详细日志**：

   ```bash
   tail -f logs/error.log
   ```

3. **重新启动机器人**：
   ```bash
   pkill -f 'src/index.js'
   npm start
   ```

### 常见问题：

**Q: 机器人显示"FFmpeg not available"**
A: FFmpeg 未正确安装或不在 PATH 中

**Q: 播放开始但立即停止**
A: 可能是音频格式或网络问题，查看 error.log

**Q: 机器人无法连接语音频道**
A: 检查机器人权限：Connect + Speak

## 📞 获取帮助

如果安装过程中遇到问题：

1. 运行诊断工具：`./debug-tools.sh`
2. 查看错误日志：`./debug-tools.sh errors`
3. 提供详细的错误信息以获得帮助

安装成功后，您的 Bilibili Discord Bot 就能完美播放 B 站视频音频了！🎵
