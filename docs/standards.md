# AI 项目管理标准

## 🚨 核心原则：优先使用官方工具

### ⚡ 最高优先级规则

**AI 助手必须优先使用现有的官方命令、工具和框架，绝对禁止自己生成替代实现！**

#### 项目初始化

- ✅ **必须使用**: `git init`, `npm init`, `create-react-app`, `vue create`, `npx create-next-app` 等官方脚手架
- ❌ **绝对禁止**: 手动创建 `.git/` 目录、手动生成 `package.json`、自制项目模板

#### 配置文件生成

- ✅ **必须使用**: `npm init @eslint/config`, `jest --init`, 官方配置生成器
- ❌ **绝对禁止**: 手动编写配置文件内容，除非官方工具不存在

#### 依赖管理

- ✅ **必须使用**: `npm install`, `yarn add`, `pnpm add` 等包管理器命令
- ❌ **绝对禁止**: 手动修改 `package.json` 添加依赖，手动创建 `node_modules`

#### 项目结构

- ✅ **必须使用**: 框架推荐的目录结构，官方最佳实践
- ❌ **绝对禁止**: 自创非标准目录结构，忽略官方约定

**违反此规则将导致项目难以维护、不符合行业标准、增加学习成本！**

---

## 文件创建规范

### 必须遵循的规则

1. **环境变量文件**

   - 永远不要创建包含真实敏感信息的 `.env` 文件
   - 只创建 `.env.example` 或 `.env.template` 作为模板
   - 所有敏感信息使用占位符（如 `YOUR_TOKEN_HERE`）

2. **依赖管理**

   - 永远不要将 `node_modules/` 目录添加到 Git
   - 只提交 `package.json` 和 `package-lock.json`
   - 让用户通过 `npm install` 安装依赖

3. **日志和临时文件**

   - 不要提交任何 `.log` 文件
   - 不要提交 `temp/`、`tmp/`、`logs/` 目录
   - 不要提交任何临时或缓存文件

4. **IDE 和系统文件**
   - 不要提交 `.vscode/`、`.idea/` 等 IDE 配置
   - 不要提交 `.DS_Store`、`Thumbs.db` 等系统文件

### .gitignore 检查清单

在创建任何文件之前，确保 `.gitignore` 包含以下规则：

```gitignore
# 环境变量
.env
.env.local
.env.*.local

# 依赖
node_modules/

# 日志
*.log
logs/

# 临时文件
temp/
tmp/

# IDE
.vscode/
.idea/

# 系统文件
.DS_Store
Thumbs.db
```

### 创建文件时的验证步骤

1. 检查文件是否应该被 Git 跟踪
2. 如果不应该被跟踪，确保 `.gitignore` 包含相应规则
3. 对于敏感文件，只创建模板版本
4. 提交前运行 `git status` 检查是否有不应该被跟踪的文件

### 紧急修复流程

如果意外提交了不应该被跟踪的文件：

1. 立即使用 `git rm --cached <file>` 从跟踪中移除
2. 更新 `.gitignore`
3. 如果包含敏感信息，需要重写 Git 历史
4. 强制推送到远程仓库
5. 更新所有敏感信息（如 API 密钥）

## 项目结构标准

### 推荐的目录结构

```
project/
├── .env.example          # 环境变量模板
├── .gitignore           # Git忽略规则
├── .ai-project-standards.md  # 本文档
├── package.json         # 项目依赖
├── README.md           # 项目说明
├── src/                # 源代码
├── tests/              # 测试文件
├── docs/               # 文档
└── scripts/            # 脚本文件
```

### 不应该存在的文件/目录

- `.env`（包含真实敏感信息）
- `node_modules/`
- `*.log`
- `temp/`、`tmp/`
- `.DS_Store`
- IDE 配置文件

## 安全检查

### 定期执行的命令

```bash
# 检查是否有不应该被跟踪的文件
git ls-files | grep -E '(node_modules|\.log$|\.env$|temp/)'

# 检查.gitignore是否生效
git check-ignore node_modules/ .env *.log
```

### 提交前检查

```bash
# 查看即将提交的文件
git status

# 确保没有敏感信息
git diff --cached | grep -i 'token\|password\|secret\|key'
```

---

## 🤖 AI 助手行为检查清单

### 每次协助开发前必须检查

#### ✅ 项目初始化检查

- [ ] 是否使用了 `git init` 而不是手动创建 `.git/`？
- [ ] 是否使用了 `npm init` 或官方脚手架而不是手动创建 `package.json`？
- [ ] 是否使用了框架官方的项目生成器？

#### ✅ 配置文件检查

- [ ] 是否使用了官方配置生成命令（如 `eslint --init`）？
- [ ] 是否查找了官方文档推荐的配置方式？
- [ ] 是否避免了手动编写复杂配置文件？

#### ✅ 依赖管理检查

- [ ] 是否使用了 `npm install` 而不是手动修改 `package.json`？
- [ ] 是否让用户通过包管理器安装依赖？
- [ ] 是否避免了提交 `node_modules/` 目录？

#### ✅ 项目结构检查

- [ ] 是否遵循了框架的官方目录约定？
- [ ] 是否参考了官方最佳实践？
- [ ] 是否避免了创建非标准的自定义结构？

### 🚨 违规行为警告

如果发现以下行为，**立即停止并使用官方工具**：

- 手动创建 Git 仓库结构
- 手动编写 `package.json` 内容
- 自制项目模板而不使用官方脚手架
- 忽略框架官方约定
- 重新发明已有的官方工具功能

---

**重要提醒**: 这个文档应该在每次 AI 协助项目开发时被参考，确保不会重复出现文件管理问题和非标准实现。
