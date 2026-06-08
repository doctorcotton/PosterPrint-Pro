#!/bin/bash
# Docker 开发态启动脚本：
# 1. 先同步构建一次 dist
# 2. 后台启动 `npm run build:watch`
# 3. 用 docker-compose.dev.yml 把 dist 挂进容器，前端改动免重建

set -euo pipefail

cd "$(dirname "$0")"

WATCH_DIR=".docker-dev"
WATCH_PID_FILE="$WATCH_DIR/build-watch.pid"
WATCH_LOG_FILE="$WATCH_DIR/build-watch.log"

mkdir -p "$WATCH_DIR"

detect_host_ip() {
  ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
}

HOST_IP="${HOST_IP:-$(detect_host_ip)}"

if [ -z "$HOST_IP" ]; then
  echo "⚠️  无法自动获取本机 IP，请手动设置："
  echo "   export HOST_IP=你的IP地址"
  echo "   ./start-docker-watch.sh"
  exit 1
fi

is_watch_running() {
  if [ ! -f "$WATCH_PID_FILE" ]; then
    return 1
  fi
  local pid
  pid="$(cat "$WATCH_PID_FILE" 2>/dev/null || true)"
  if [ -z "$pid" ]; then
    return 1
  fi
  kill -0 "$pid" 2>/dev/null
}

echo "🌐 检测到本机 IP: $HOST_IP"
echo "🧱 先构建一次前端 dist..."
npm run build

if is_watch_running; then
  echo "👀 前端 build --watch 已在运行，PID=$(cat "$WATCH_PID_FILE")"
else
  echo "👀 启动前端 build:watch（日志：$WATCH_LOG_FILE）..."
  nohup npm run build:watch >"$WATCH_LOG_FILE" 2>&1 &
  echo $! >"$WATCH_PID_FILE"
  sleep 1
  if ! is_watch_running; then
    echo "❌ build --watch 启动失败，请查看日志：$WATCH_LOG_FILE"
    exit 1
  fi
fi

echo "🚀 启动 Docker 开发态服务（挂载宿主 dist）..."
export HOST_IP
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

echo ""
echo "✅ Docker 开发态已启动！"
echo "📍 本机访问: http://localhost:15234"
echo "📍 局域网访问: http://$HOST_IP:15234"
echo "🔒 HTTPS 访问: https://$HOST_IP:15235"
echo "♻️  前端改动后会自动重新构建 dist，并直接反映到容器里。"
echo "🧾 watcher 日志: $WATCH_LOG_FILE"
echo "🛑 停止开发态: ./stop-docker-watch.sh"
