#!/usr/bin/env bash
# 停止本機檔案管理系統
cd "$(dirname "$0")"

if [ -f .server.pid ] && kill -0 "$(cat .server.pid)" 2>/dev/null; then
  kill "$(cat .server.pid)"
  rm -f .server.pid
  echo "已停止伺服器"
else
  # 找不到 PID 檔時，改用 port 搜尋
  PID=$(ss -tlnp 2>/dev/null | grep ":4321 " | grep -oP 'pid=\K[0-9]+' | head -1)
  if [ -n "$PID" ]; then
    kill "$PID" && echo "已停止伺服器（PID $PID）"
  else
    echo "伺服器未在執行"
  fi
fi
