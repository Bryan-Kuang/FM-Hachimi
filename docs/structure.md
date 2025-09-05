# 项目结构说明

## 📁 目录组织

```
Bilibili Player/
├── 📄 README.md                 # 项目主要说明文档
├── 📄 .gitignore                # Git忽略规则
├── 📄 package.json              # 项目依赖和脚本配置
├── 📄 package-lock.json         # 依赖版本锁定
├── 📄 .env                      # 环境变量（本地，不提交）
│
├── 📂 src/                      # 源代码目录
│   ├── 📂 audio/               # 音频处理模块
│   ├── 📂 bot/                 # Discord机器人核心
│   ├── 📂 config/              # 配置管理
│   ├── 📂 ui/                  # 用户界面组件
│   ├── 📂 utils/               # 工具函数
│   └── 📄 index.js             # 应用入口点
│
├── 📂 tests/                    # 测试文件
│   ├── 📂 unit/                # 单元测试
│   ├── 📂 integration/         # 集成测试
│   ├── 📂 e2e/                 # 端到端测试
│   ├── 📂 manual/              # 手动测试脚本
│   └── 📂 utils/               # 测试工具
│
├── 📂 docs/                     # 项目文档
│   ├── 📄 PROJECT_SUMMARY.md   # 项目概述
│   ├── 📄 TECHNICAL_ARCHITECTURE.md # 技术架构
│   ├── 📄 DEPLOYMENT_GUIDE.md  # 部署指南
│   ├── 📄 .ai-project-standards.md # AI开发标准
│   └── 📂 archive/             # 归档文档
│
├── 📂 scripts/                  # 脚本文件
│   ├── 📄 deploy-commands.js   # 部署Discord命令
│   ├── 📄 debug-tools.sh       # 调试工具
│   └── 📂 tools/               # 其他工具脚本
│
├── 📂 setup/                    # 安装和配置
│   ├── 📄 FFMPEG_INSTALL.md    # FFmpeg安装指南
│   ├── 📄 QUICK_SETUP.txt      # 快速设置说明
│   ├── 📄 .env.example         # 环境变量模板
│   └── 📄 .env.template        # 环境变量模板（备用）
│
├── 📂 planning/                 # 项目规划
│   ├── 📄 REFACTOR_PLAN.md     # 重构计划
│   └── 📄 TEST_PLAN.md         # 测试计划
│
├── 📂 config/                   # 配置文件
│   └── 📄 jest.config.js       # Jest测试配置
│
├── 📂 logs/                     # 日志文件
│   ├── 📄 combined.log         # 综合日志
│   └── 📄 error.log            # 错误日志
│
└── 📂 tools/                    # 开发工具
    └── 📄 refactor.js           # 重构工具脚本
```

## 🎯 目录说明

### 核心目录

- **`src/`**: 所有源代码，按功能模块组织
- **`tests/`**: 完整的测试套件，包含各种类型的测试
- **`docs/`**: 项目文档，包括技术文档和用户指南

### 配置和设置

- **`setup/`**: 新用户快速开始所需的所有文件
- **`config/`**: 各种工具的配置文件
- **`scripts/`**: 自动化脚本和工具

### 开发和规划

- **`planning/`**: 项目规划和计划文档
- **`tools/`**: 开发过程中使用的工具脚本
- **`logs/`**: 应用程序日志文件，包含运行时日志和错误日志

## 📋 文件命名规范

### 文档文件

- 使用大写字母和下划线：`PROJECT_SUMMARY.md`
- 描述性名称，便于理解用途

### 代码文件

- 使用小写字母和连字符：`audio-player.js`
- 或使用驼峰命名：`audioPlayer.js`

### 配置文件

- 保持工具的标准命名：`jest.config.js`
- 环境文件使用点前缀：`.env.example`

## 🔄 维护指南

### 添加新功能

1. 代码放在 `src/` 对应模块
2. 测试放在 `tests/` 对应目录
3. 文档更新到 `docs/`

### 添加新工具

1. 脚本放在 `scripts/` 或 `tools/`
2. 配置放在 `config/`
3. 说明文档放在 `docs/`

### 项目规划

1. 计划文档放在 `planning/`
2. 完成后归档到 `docs/archive/`

## ⚠️ 注意事项

- **不要**在根目录放置临时文件
- **确保**新文件放在合适的目录
- **更新**相关文档当结构改变时
- **遵循**既定的命名规范

---

_此文档反映了项目的当前组织结构，应随项目发展保持更新。_
