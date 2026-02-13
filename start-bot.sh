#!/bin/bash

set -e
cd "$(dirname "$0")"

echo "啟動翻譯服務中..."
docker compose up -d bot
echo "[OK] bot 已啟動"
echo "查看狀態：docker compose ps"
