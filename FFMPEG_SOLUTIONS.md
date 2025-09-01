# FFmpeg 安装解决方案

由于网络问题，这里提供多种 FFmpeg 安装方法。

## 🚨 **网络问题诊断**

您遇到的错误是：

```
curl: (35) LibreSSL SSL_connect: SSL_ERROR_SYSCALL
```

这通常是网络/DNS/防火墙问题。

## 🛠️ **解决方案 (按推荐顺序)**

### 方案 1: 修复 Homebrew 网络问题

```bash
# 清理Homebrew缓存
brew cleanup

# 使用国内镜像源
export HOMEBREW_BOTTLE_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles
export HOMEBREW_API_DOMAIN=https://mirrors.ustc.edu.cn/homebrew-bottles/api
export HOMEBREW_BREW_GIT_REMOTE=https://mirrors.ustc.edu.cn/brew.git
export HOMEBREW_CORE_GIT_REMOTE=https://mirrors.ustc.edu.cn/homebrew-core.git

# 重新尝试安装
brew install ffmpeg
```

### 方案 2: 使用 MacPorts (如果有)

```bash
# 检查是否安装了MacPorts
which port

# 如果有MacPorts，使用它安装
sudo port install ffmpeg
```

### 方案 3: 手动下载预编译版本

```bash
# 创建临时目录
mkdir -p ~/ffmpeg-install
cd ~/ffmpeg-install

# 下载预编译版本 (替换架构)
# For ARM64 (M1/M2 Mac):
curl -L -o ffmpeg.zip "https://evermeet.cx/ffmpeg/ffmpeg-6.0.zip"

# For Intel Mac:
# curl -L -o ffmpeg.zip "https://evermeet.cx/ffmpeg/ffmpeg-6.0.zip"

# 解压并安装
unzip ffmpeg.zip
sudo cp ffmpeg /usr/local/bin/
chmod +x /usr/local/bin/ffmpeg
```

### 方案 4: 使用静态构建版本

```bash
# 下载静态构建版本
cd ~/Downloads

# ARM64版本
curl -L -o ffmpeg-static.tar.xz "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz"

# 解压
tar xf ffmpeg-static.tar.xz

# 找到ffmpeg二进制文件并复制
find . -name "ffmpeg" -type f -exec sudo cp {} /usr/local/bin/ \;
sudo chmod +x /usr/local/bin/ffmpeg
```

### 方案 5: 使用 Conda (如果有)

```bash
# 如果安装了Anaconda或Miniconda
conda install -c conda-forge ffmpeg
```

### 方案 6: 手动编译 (最后手段)

```bash
# 安装依赖
xcode-select --install

# 下载源代码
git clone https://git.ffmpeg.org/ffmpeg.git
cd ffmpeg

# 配置和编译
./configure --enable-shared --disable-static
make -j$(nproc)
sudo make install
```

## ✅ **验证安装**

```bash
# 检查FFmpeg是否可用
ffmpeg -version

# 检查路径
which ffmpeg

# 测试基本功能
ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=1 -f null -
```

## 🎯 **快速测试脚本**

```bash
#!/bin/bash
echo "🔍 FFmpeg安装检测..."

if command -v ffmpeg &> /dev/null; then
    echo "✅ FFmpeg已安装: $(ffmpeg -version | head -1)"

    # 测试音频处理能力
    echo "🧪 测试音频处理..."
    if ffmpeg -f lavfi -i "sine=frequency=1000:duration=1" -f null - 2>/dev/null; then
        echo "✅ 音频处理正常"
    else
        echo "❌ 音频处理有问题"
    fi
else
    echo "❌ FFmpeg未安装"
fi
```

## 🚀 **建议的安装顺序**

1. **首先尝试方案 1** (修复 Homebrew 网络)
2. **如果失败，使用方案 3** (手动下载)
3. **如果还是不行，使用方案 4** (静态构建)

## 📞 **需要帮助？**

运行我们的诊断工具：

```bash
./debug-tools.sh
```

或者告诉我您的具体情况，我会提供针对性的解决方案！

## 🎵 **安装成功后**

记得重启机器人：

```bash
./debug-tools.sh restart
```

然后测试播放功能：

```
/play url:https://www.bilibili.com/video/BV1uv4y1q7Mv
```
