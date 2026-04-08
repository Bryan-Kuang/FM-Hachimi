# 项目结构说明

## 📁 目录组织

```
Bilibili Player/
├── 📄 README.md                 # 项目主要说明文档
├── 📄 .gitignore                # Git忽略规则
├── 📄 docker-compose.yml        # Docker服务配置
├── 📄 package.json              # 项目依赖和脚本配置
├── 📄 package-lock.json         # 依赖版本锁定
├── 📄 .env                      # 环境变量（本地，不提交）
│
├── 📂 src/                      # 源代码目录
│   ├── 📂 bilibili/             # B站交互层（解析器、API、验证）
│   ├── 📂 bot/                  # Discord机器人逻辑（客户端、中间件、命令）
│   ├── 📂 config/               # 全局配置管理
│   ├── 📂 models/               # 数据模型
│   ├── 📂 playback/             # 媒体流播放器
│   ├── 📂 services/             # 业务服务层（服务定位器、日志等）
│   ├── 📂 session/              # 公会特定会话管理
│   ├── 📂 ui/                   # 可视化UI组件（UI、Embeds、按钮控件）
│   ├── 📂 utils/                # 通用工具函数模块
│   └── 📄 index.js              # 应用入口点
│
├── 📂 tests/                    # 测试用例目录
│   └── 📂 manual/               # 手动测试脚本
│
├── 📂 docs/                     # 项目文档
│   ├── 📄 ai-development-standards.md # AI开发标准规范
│   ├── 📄 deployment-guide.md   # 服务器部署指南（含Docker）
│   ├── 📄 directory-structure.md # 目录结构说明 (当前文件)
│   ├── 📄 feature-hachimi.md    # 特定功能逻辑说明
│   ├── 📄 project-roadmap.md    # 路线规划与产品需求文档
│   └── 📄 system-architecture.md # 系统核心架构解析
│
├── 📂 scripts/                  # 脚本文件目录
│   ├── 📂 deploy/               # 运维部署相关的Shell脚本
│   └── 📂 tools/                # 开发辅助工具
│
└── 📂 logs/                     # 历史或运行时日志存储目录
```

## 🎯 系统架构概览

- **bilibili 层**: 负责与Bilibili进行外部交互提取下载链接。
- **bot 层**: 纯粹处理 Discord.js 事件机制和交互。
- **services 层**: 解耦并独立出特定逻辑，如队列管理、日志、事件发布。
- **session 层**: 管理不同公会 (Guild) 独立存在的运行时状态。
- **playback 层**: 本地音频流引擎实现状态机。
- **ui 层**: 提供丰富且模块化的消息、交互组件集。

---

_此文档反映了项目的当前组织结构，应随项目发展保持更新。_
