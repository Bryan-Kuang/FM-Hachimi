# 📋 部署检查清单

在部署到 Oracle Cloud 之前，请确保完成以下步骤：

## ✅ 准备阶段

- [ ] 已注册 Oracle Cloud 账户
- [ ] 已创建 Discord Bot 应用并获取 Token
- [ ] 已获取 Discord Client ID
- [ ] 已为 Bot 设置适当的权限（Administrator 或特定权限）

## ✅ 服务器配置

- [ ] 已创建 Oracle Cloud 实例（VM.Standard.E2.1.Micro）
- [ ] 实例运行 Ubuntu 22.04 或 Oracle Linux 8
- [ ] 已记录实例的公网 IP 地址
- [ ] 可以通过 SSH 连接到实例

## ✅ 项目配置

- [ ] 已将项目上传到服务器（通过 git clone 或 scp）
- [ ] 已复制 `.env.example` 为 `.env`
- [ ] 已在 `.env` 中填写 `DISCORD_TOKEN`
- [ ] 已在 `.env` 中填写 `CLIENT_ID`（Discord Client ID，改为 `DISCORD_CLIENT_ID`）
- [ ] 已验证 `.env` 文件权限（应为 600）

## ✅ 部署步骤

- [ ] 已运行 `./deploy.sh` 部署脚本
- [ ] Docker 和 Docker Compose 已成功安装
- [ ] 容器已成功构建并启动
- [ ] 查看日志确认 Bot 已连接到 Discord

## ✅ 验证部署

- [ ] 运行 `docker-compose ps` 确认容器状态为 "Up"
- [ ] 运行 `docker-compose logs -f` 查看实时日志
- [ ] 在 Discord 中看到 Bot 在线
- [ ] 测试 `/help` 命令正常响应
- [ ] 测试 `/play` 命令可以播放音乐

## ✅ 安全配置

- [ ] `.env` 文件权限设置为 600（`chmod 600 .env`）
- [ ] 不要将 `.env` 提交到 Git 仓库
- [ ] Oracle Cloud 防火墙规则已检查（Bot 只需出站连接）
- [ ] 定期更新系统包（`sudo apt update && sudo apt upgrade`）

## ✅ 自动启动配置（可选但推荐）

- [ ] 已配置 systemd 服务（见 DEPLOYMENT.md）
- [ ] 或者确认 docker-compose.yml 中有 `restart: unless-stopped`

## ✅ 监控和维护

- [ ] 已设置 Docker 日志轮转
- [ ] 知道如何查看日志（`docker-compose logs -f`）
- [ ] 知道如何重启 Bot（`docker-compose restart`）
- [ ] 知道如何更新 Bot（`git pull && docker-compose up -d --build`）

## 🎯 完成！

如果以上所有项目都已完成，恭喜你成功部署了 Bilibili Discord Bot！

---

## 📞 需要帮助？

- 查看 [DEPLOYMENT.md](./DEPLOYMENT.md) 获取详细步骤
- 查看 [QUICK_START.md](./QUICK_START.md) 获取快速命令参考
- 检查容器日志：`docker-compose logs --tail=100 bilibili-bot`
- 确保所有环境变量都正确设置

---

## 🔄 更新 Bot

当你有新的代码更新时：

```bash
# SSH 到服务器
ssh ubuntu@<你的IP>
cd ~/bilibili-bot

# 拉取最新代码
git pull

# 重新构建并重启
docker-compose up -d --build

# 查看日志确认
docker-compose logs -f
```

---

祝你部署顺利！🎉
