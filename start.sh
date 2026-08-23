#!/usr/bin/env bash
# 啟動本機檔案管理系統（背景執行、常駐、自動記錄 PID）
set -e
cd "$(dirname "$0")"

PORT="${PORT:-4321}"

# 若已在執行則不重複啟動
if [ -f .server.pid ] && kill -0 "$(cat .server.pid)" 2>/dev/null; then
  echo "伺服器已在執行（PID $(cat .server.pid)，port ${PORT}）"
  exit 0
fi

nohup node server.js > server.log 2>&1 &
echo $! > .server.pid

sleep 1
if kill -0 "$(cat .server.pid)" 2>/dev/null; then
  echo "✅ 已啟動（PID $(cat .server.pid)）"
  echo "   瀏覽器開啟: http://localhost:${PORT}"
  echo "   日誌: server.log　停止: ./stop.sh"
else
  echo "❌ 啟動失敗，請查看 server.log"
  exit 1
fi
