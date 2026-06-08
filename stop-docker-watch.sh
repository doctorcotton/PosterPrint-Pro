#!/bin/bash
# 停止 Docker 开发态与后台前端 watcher。

set -euo pipefail

cd "$(dirname "$0")"

WATCH_PID_FILE=".docker-dev/build-watch.pid"

if [ -f "$WATCH_PID_FILE" ]; then
  WATCH_PID="$(cat "$WATCH_PID_FILE" 2>/dev/null || true)"
  if [ -n "${WATCH_PID:-}" ] && kill -0 "$WATCH_PID" 2>/dev/null; then
    echo "🛑 停止前端 build --watch，PID=$WATCH_PID"
    kill "$WATCH_PID"
  fi
  rm -f "$WATCH_PID_FILE"
fi

echo "🧹 停止 Docker 服务..."
docker-compose -f docker-compose.yml -f docker-compose.dev.yml down

echo "✅ Docker 开发态已停止。"
