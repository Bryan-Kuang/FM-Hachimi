#!/bin/bash
# GCP e2-micro Initialization Script
# usage: sudo bash scripts/setup/vm_init.sh

set -e

echo "🚀 Starting GCP e2-micro initialization..."

# 1. Configure Swap (Crucial for 1GB RAM instances)
if [ ! -f /swapfile ]; then
    echo "📦 Creating 2GB swap file..."
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "✅ Swap created successfully."
else
    echo "✅ Swap file already exists."
fi

# 2. Update System
echo "🔄 Updating package lists..."
sudo apt-get update

# 3. Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "🐳 Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    rm get-docker.sh
    
    # Add current user to docker group
    sudo usermod -aG docker $USER
    echo "✅ Docker installed. Note: You may need to re-login for group changes to take effect."
else
    echo "✅ Docker is already installed."
fi

# 4. Install Basic Tools
echo "🛠️ Installing Git and tools..."
sudo apt-get install -y git curl htop

# 5. Optimization for Low Memory
echo "⚙️ Configuring system for low memory environment..."
# Adjust swappiness to use swap more aggressively (default is 60)
sudo sysctl vm.swappiness=60
# Adjust cache pressure
sudo sysctl vm.vfs_cache_pressure=50

echo "
🎉 Initialization Complete!
------------------------------------------------
Next Steps:
1. Logout and login again: 'exit' then reconnect
2. Clone your repository (if not done)
3. Copy .env.example to .env and configure it
4. Run: npm run docker:build
5. Run: npm run deploy
------------------------------------------------
"
