# 🚀 快速开始 - Oracle Cloud 部署

## 30 秒快速部署

### 1. 在 Oracle Cloud 创建实例
- Shape: VM.Standard.E2.1.Micro (免费)
- Image: Ubuntu 22.04
- 记录公网 IP

### 2. SSH 连接并运行

```bash
# 连接到服务器
ssh ubuntu@<你的IP>

# 上传项目或克隆仓库
git clone <你的仓库> && cd <项目目录>

# 配置环境变量
cp .env.example .env
nano .env  # 填入 DISCORD_TOKEN

# 一键部署
./deploy.sh
```

完成！查看日志：
```bash
docker-compose logs -f
```

---

## 📋 常用命令

```bash
# 查看状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 重启
docker-compose restart

# 停止
docker-compose down

# 更新
git pull && docker-compose up -d --build
```

---

## ⚙️ 必需的环境变量

在 `.env` 文件中设置：

```env
DISCORD_TOKEN=你的Token
DISCORD_CLIENT_ID=你的ClientID
```

---

详细文档请查看 [DEPLOYMENT.md](./DEPLOYMENT.md)
