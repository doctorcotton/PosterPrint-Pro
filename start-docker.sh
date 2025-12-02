#!/bin/bash
# Docker 一键启动脚本（自动获取本机 IP）

cd "$(dirname "$0")"

# 自动获取本机局域网 IP
# 尝试 en0 (Wi-Fi) 或 en1 (有线)
HOST_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

if [ -z "$HOST_IP" ]; then
    echo "⚠️  无法自动获取本机 IP，请手动设置："
    echo "   export HOST_IP=你的IP地址"
    echo "   docker-compose up -d --build"
    exit 1
fi

echo "🌐 检测到本机 IP: $HOST_IP"
echo "🚀 正在启动 Docker 服务..."

export HOST_IP
docker-compose up -d --build

echo ""
echo "✅ 服务已启动！"
echo "📍 本机访问: http://localhost:15234"
echo "📍 局域网访问: http://$HOST_IP:15234"

