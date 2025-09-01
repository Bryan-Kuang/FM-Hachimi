# 📚 Bilibili Discord Bot 文档目录

## 📋 主要文档

### 🎯 项目规划

- [PRD.md](./PRD.md) - 产品需求文档
- [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md) - 项目总结

### 🏗️ 技术文档

- [QUICK_SETUP.txt](../QUICK_SETUP.txt) - 快速设置指南
- [.env.example](../.env.example) - 环境变量模板

### 🧪 测试相关

- [tests/](../tests/) - 测试文件目录
- [scripts/](../scripts/) - 工具脚本

## 📁 归档文档

存放在 `archive/` 目录中的历史文档：

- [FFMPEG_SOLUTIONS.md](./archive/FFMPEG_SOLUTIONS.md) - FFmpeg 安装解决方案（已过时）

## 🚀 快速开始

1. **环境配置**

   ```bash
   cp .env.example .env
   # 编辑 .env 文件，填入你的 Discord Token
   ```

2. **安装依赖**

   ```bash
   npm install
   ```

3. **启动机器人**

   ```bash
   npm start
   ```

4. **测试功能**
   ```bash
   npm run test:all
   ```

## 📞 常用命令

- `npm start` - 启动机器人
- `npm run quick` - 快速启动（跳过初始化检查）
- `npm run test:playback` - 播放功能测试
- `npm run tools` - 开发工具
- `/play url:视频链接` - 在 Discord 中播放 B 站视频

## 🐛 故障排除

如果遇到问题，请按顺序检查：

1. **依赖安装** - `npm install`
2. **FFmpeg 安装** - `ffmpeg -version`
3. **Discord Token** - 检查 `.env` 文件
4. **运行测试** - `npm run test:playback`

## 📊 项目状态

✅ **已完成功能：**

- B 站视频音频提取
- Discord 机器人集成
- 基础播放控制
- 队列管理
- 错误处理

🔄 **正在修复：**

- 音频播放稳定性
- 重试机制优化

💡 **计划功能：**

- 高级可视化
- 用户偏好设置
