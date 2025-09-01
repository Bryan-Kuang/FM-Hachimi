#!/bin/bash

# Bilibili Discord Bot - Debug Tools
# 用于调试机器人问题的工具集

echo "🔧 Bilibili Discord Bot - Debug Tools"
echo "=================================="

# 检查机器人状态
echo "📊 检查机器人进程状态:"
if pgrep -f "src/index.js" > /dev/null; then
    echo "✅ 机器人正在运行 (PID: $(pgrep -f 'src/index.js'))"
else
    echo "❌ 机器人未运行"
fi

# 检查依赖
echo -e "\n🛠️ 检查依赖:"

# 检查yt-dlp
if command -v yt-dlp &> /dev/null; then
    echo "✅ yt-dlp: $(yt-dlp --version)"
else
    echo "❌ yt-dlp: 未安装"
fi

# 检查FFmpeg
if command -v ffmpeg &> /dev/null; then
    echo "✅ FFmpeg: $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f3)"
else
    echo "❌ FFmpeg: 未安装 - 这是播放失败的主要原因!"
fi

# 检查Node.js
echo "✅ Node.js: $(node --version)"

# 检查日志文件
echo -e "\n📋 日志文件状态:"
if [ -d "logs" ]; then
    for log in logs/*.log; do
        if [ -f "$log" ]; then
            size=$(du -h "$log" | cut -f1)
            echo "✅ $log ($size)"
        fi
    done
else
    echo "❌ 未找到logs目录"
fi

# 检查配置文件
echo -e "\n⚙️ 配置检查:"
if [ -f ".env" ]; then
    echo "✅ .env文件存在"
    echo "📝 Token配置: $(grep -c "DISCORD_TOKEN=" .env) 个"
    echo "📝 Client ID配置: $(grep -c "CLIENT_ID=" .env) 个"
else
    echo "❌ .env文件不存在"
fi

echo -e "\n🚀 快速操作:"
echo "查看实时日志: tail -f logs/combined.log"
echo "查看错误日志: tail -f logs/error.log" 
echo "重启机器人: npm start"
echo "停止机器人: pkill -f 'src/index.js'"

# 如果有参数，执行对应操作
case "$1" in
    "logs")
        echo -e "\n📊 最新日志 (最后10行):"
        if [ -f "logs/combined.log" ]; then
            tail -10 logs/combined.log
        else
            echo "没有找到日志文件"
        fi
        ;;
    "errors")
        echo -e "\n🚨 最新错误 (最后10行):"
        if [ -f "logs/error.log" ]; then
            tail -10 logs/error.log
        else
            echo "没有找到错误日志"
        fi
        ;;
    "restart")
        echo -e "\n🔄 重启机器人..."
        pkill -f 'src/index.js' 2>/dev/null
        sleep 2
        NODE_ENV=development LOG_LEVEL=debug npm start &
        echo "机器人已重启"
        ;;
    "test")
        echo -e "\n🧪 运行系统测试:"
        npm run test:system
        ;;
esac
