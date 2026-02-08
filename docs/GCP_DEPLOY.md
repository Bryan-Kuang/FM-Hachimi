# Google Cloud Platform (GCP) e2-micro 部署指南

本指南将协助您将 Bilibili Discord Bot 部署到 GCP 的免费层级实例 (`e2-micro`) 上。

## 📋 前置准备

1.  Google Cloud 账号
2.  已创建的 GCP 项目

## 🚀 第一步：创建虚拟机实例

1.  进入 **Compute Engine** > **VM 实例**
2.  点击 **"创建实例"**
3.  **名称**: `bilibili-bot` (或任意名称)
4.  **区域**: 选择 `us-west1`, `us-central1`, 或 `us-east1` (这些区域通常包含免费层级额度，请查阅 GCP 官网确认)
5.  **机器配置**:
    *   系列: `E2`
    *   机器类型: `e2-micro` (2 vCPU, 1 GB 内存)
6.  **启动磁盘**:
    *   操作系统: **Ubuntu** 或 **Debian** (推荐 Ubuntu 20.04 LTS 或更高)
    *   磁盘类型: **标准持久化磁盘**
    *   大小: 30 GB (免费层级上限)
7.  **防火墙**: 勾选 "允许 HTTP 流量" (可选，如果需要 Web 面板)
8.  点击 **"创建"**

## 🛠️ 第二步：连接与初始化环境

1.  在 VM 列表页面，点击实例旁的 **SSH** 按钮连接。

2.  **获取初始化脚本**：
    （如果您已经克隆了代码，直接运行即可。如果是新机器，请使用以下命令下载并运行）

    ```bash
    # 假设您已将代码上传或克隆到服务器
    # 运行初始化脚本（自动安装 Docker、Git 并配置 2GB Swap）
    sudo bash scripts/setup/vm_init.sh
    ```

    *注意：`e2-micro` 只有 1GB 内存，**必须**配置 Swap 才能成功构建和运行应用。初始化脚本会自动处理此项。*

3.  **重新登录**：
    脚本执行完成后，请输入 `exit` 退出 SSH，然后重新连接，以使用户组更改生效。

## 📦 第三步：部署应用

1.  **克隆代码** (如果尚未克隆):
    ```bash
    git clone https://github.com/yourusername/bilibili-discord-bot.git
    cd bilibili-discord-bot
    ```

2.  **配置环境变量**:
    ```bash
    cp .env.example .env
    nano .env
    ```
    *   填入 `DISCORD_TOKEN` 和其他必要信息。
    *   建议设置 `LOG_TO_FILE=false` 以减少磁盘 I/O，利用 Docker 日志。

3.  **构建镜像**:
    ```bash
    npm run docker:build
    ```
    *这可能需要几分钟。由于配置了 Swap，构建过程不会因内存不足而崩溃。*

4.  **启动服务**:
    ```bash
    npm run deploy
    ```

## 🔍 常用维护命令

*   **查看日志**:
    ```bash
    docker logs -f bilibili-bot
    ```

*   **停止服务**:
    ```bash
    docker stop bilibili-bot
    ```

*   **更新代码并重新部署**:
    ```bash
    git pull
    npm run docker:build
    npm run deploy
    ```

*   **系统资源监控**:
    ```bash
    htop
    ```

## ⚠️ 注意事项

*   **内存限制**: `e2-micro` 资源有限。尽量不要在该机器上运行其他重型应用。
*   **出站流量**: 确保 GCP 项目未限制出站流量，以免无法连接 Discord API 或 Bilibili。
*   **IP 封禁**: 如果频繁请求 Bilibili，GCP 的数据中心 IP 可能会被暂时限制。如果遇到 403 错误，可能需要考虑使用代理或等待。
