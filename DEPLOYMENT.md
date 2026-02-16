# Bilibili Discord Bot - Oracle Cloud 部署指南

本指南将帮助你在 Oracle Cloud Free Tier 上使用 Docker 容器部署 Discord 机器人。

## 📋 前置要求

1. **Oracle Cloud 账户**
   - 注册免费账户：https://www.oracle.com/cloud/free/
   - 获得 Always Free 资源（包括 2 个 VM 实例）

2. **Discord Bot Token**
   - 在 [Discord Developer Portal](https://discord.com/developers/applications) 创建应用
   - 复制 Bot Token

3. **本地工具**（可选，用于测试）
   - Git
   - Docker Desktop（本地测试用）

---

## 🚀 快速部署步骤

### 步骤 1: 创建 Oracle Cloud 实例

1. 登录 [Oracle Cloud Console](https://cloud.oracle.com/)

2. 创建计算实例：
   - 导航到：**Compute** → **Instances** → **Create Instance**
   - **Name**: `bilibili-discord-bot`
   - **Image**: `Canonical Ubuntu 22.04`（推荐）或 `Oracle Linux 8`
   - **Shape**: `VM.Standard.E2.1.Micro`（Always Free）
   - **Network**: 使用默认 VCN，确保分配公网 IP
   - **SSH Keys**: 上传你的 SSH 公钥或生成新的密钥对

3. 记录实例的**公网 IP 地址**

### 步骤 2: 连接到服务器

```bash
# SSH 连接到你的 Oracle Cloud 实例
ssh ubuntu@<你的公网IP>

# 如果使用 Oracle Linux，用户名是 opc
ssh opc@<你的公网IP>
```

### 步骤 3: 在服务器上部署

#### 3.1 克隆项目

```bash
# 安装 Git（如果尚未安装）
sudo apt update && sudo apt install -y git

# 克隆你的项目仓库
git clone <你的仓库地址>
cd Bilibili-Player
```

如果你还没有 Git 仓库，可以使用 `scp` 上传文件：

```bash
# 在本地运行（上传整个项目）
scp -r "/Users/bryan/Desktop/Projects/Discord Bot/Bilibili Player" ubuntu@<公网IP>:~/bilibili-bot
```

#### 3.2 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件
nano .env
```

**必须设置的环境变量**：

```env
# Discord 配置
DISCORD_TOKEN=你的_Discord_Bot_Token
DISCORD_CLIENT_ID=你的_Client_ID

# 日志配置（可选）
LOG_LEVEL=info
LOG_TO_FILE=true

# 音频配置（可选）
MAX_QUEUE_SIZE=50
```

保存文件：`Ctrl + O`，回车，`Ctrl + X`

#### 3.3 运行部署脚本

```bash
# 运行一键部署脚本
./deploy.sh
```

脚本会自动：
- ✅ 检查并安装 Docker
- ✅ 检查并安装 Docker Compose
- ✅ 构建 Docker 镜像
- ✅ 启动容器
- ✅ 验证部署状态

### 步骤 4: 验证部署

```bash
# 查看容器状态
docker-compose ps

# 查看实时日志
docker-compose logs -f bilibili-bot

# 查看最近 50 行日志
docker-compose logs --tail=50 bilibili-bot
```

如果看到类似以下输出，说明部署成功：

```
[2026-02-08 15:30:00][INFO][Discord bot is ready!][{"username":"哈基米","guilds":3}]
```

---

## 🔧 常用管理命令

### 查看日志

```bash
# 实时查看日志
docker-compose logs -f

# 查看最近 100 行
docker-compose logs --tail=100

# 查看特定时间的日志
docker-compose logs --since 30m  # 最近 30 分钟
```

### 重启 Bot

```bash
# 重启容器
docker-compose restart

# 完全停止后重新启动
docker-compose down && docker-compose up -d
```

### 更新 Bot

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker-compose up -d --build
```

### 停止 Bot

```bash
# 停止容器
docker-compose down

# 停止并删除所有数据
docker-compose down -v
```

### 查看资源使用

```bash
# 查看容器资源占用
docker stats bilibili-discord-bot
```

---

## 🔐 安全配置（重要！）

### 1. 配置防火墙

Oracle Cloud 默认有严格的防火墙规则。由于 Discord Bot 只需要**出站**连接，无需开放入站端口。

### 2. 保护 .env 文件

```bash
# 确保 .env 权限正确
chmod 600 .env

# 添加到 .gitignore（如果使用 Git）
echo ".env" >> .gitignore
```

### 3. 定期更新系统

```bash
# 更新系统包
sudo apt update && sudo apt upgrade -y

# 更新 Docker 镜像
docker-compose pull
docker-compose up -d
```

---

## 🎯 自动启动配置

为了确保服务器重启后 Bot 自动启动：

### 方法 1: 使用 systemd（推荐）

创建 systemd 服务文件：

```bash
sudo nano /etc/systemd/system/bilibili-bot.service
```

添加以下内容：

```ini
[Unit]
Description=Bilibili Discord Bot
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ubuntu/bilibili-bot
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
User=ubuntu
Group=ubuntu

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable bilibili-bot.service
sudo systemctl start bilibili-bot.service

# 查看状态
sudo systemctl status bilibili-bot.service
```

### 方法 2: 使用 Docker restart policy（已配置）

Docker Compose 配置中已设置 `restart: unless-stopped`，容器会在系统重启后自动启动。

---

## 📊 监控和维护

### 设置日志轮转

防止日志文件占用过多空间：

```bash
# 编辑 Docker daemon 配置
sudo nano /etc/docker/daemon.json
```

添加：

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

重启 Docker：

```bash
sudo systemctl restart docker
docker-compose up -d
```

### 定期清理磁盘空间

```bash
# 清理未使用的 Docker 资源
docker system prune -a -f

# 查看磁盘使用
df -h
du -sh ~/bilibili-bot/logs/*
```

---

## ⚠️ 故障排除

### Bot 无法启动

**检查日志**：
```bash
docker-compose logs --tail=100 bilibili-bot
```

**常见问题**：

1. **Discord Token 无效**
   ```
   Error: An invalid token was provided
   ```
   - 解决：检查 `.env` 中的 `DISCORD_TOKEN` 是否正确

2. **内存不足**
   ```
   Error: Cannot allocate memory
   ```
   - 解决：释放内存或增加 swap
   ```bash
   sudo fallocate -l 1G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```

3. **端口占用**
   ```
   Error: Port already in use
   ```
   - 解决：检查是否有其他容器在运行
   ```bash
   docker ps -a
   docker-compose down
   ```

### 容器无法访问网络

```bash
# 重启 Docker 网络
docker network prune -f
docker-compose down && docker-compose up -d
```

### ffmpeg 或 yt-dlp 找不到

```bash
# 重新构建镜像
docker-compose build --no-cache
docker-compose up -d
```

---

## 💡 性能优化建议

### Oracle Cloud Free Tier 配置

- **CPU**: 1 核心
- **内存**: 1 GB
- **存储**: 47 GB
- **流量**: 10 TB/月

### 资源限制配置

已在 `docker-compose.yml` 中配置：
```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'
      memory: 512M
    reservations:
      cpus: '0.25'
      memory: 256M
```

---

## 📞 获取帮助

如果遇到问题：

1. 查看日志：`docker-compose logs -f`
2. 查看 GitHub Issues
3. 确保 Discord Bot 有正确的权限

---

## 📝 环境变量完整列表

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `DISCORD_TOKEN` | ✅ | - | Discord Bot Token |
| `DISCORD_CLIENT_ID` | ✅ | - | Discord Application ID |
| `LOG_LEVEL` | ❌ | `info` | 日志级别 (debug/info/warn/error) |
| `LOG_TO_FILE` | ❌ | `true` | 是否写入日志文件 |
| `MAX_QUEUE_SIZE` | ❌ | `50` | 最大队列长度 |
| `EXTRACTION_TIMEOUT` | ❌ | `30000` | 提取超时时间（毫秒）|
| `FFMPEG_INACTIVE_KILL_THRESHOLD` | ❌ | `60000` | FFmpeg 无活动终止阈值 |

---

## 🎉 部署完成！

恭喜！你的 Bilibili Discord Bot 现在已经在 Oracle Cloud 上运行了。

测试 Bot：
1. 在 Discord 服务器中输入 `/help`
2. 使用 `/play <Bilibili URL>` 播放音乐

享受吧！🎵
