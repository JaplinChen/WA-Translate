#!/bin/bash

set -e
cd "$(dirname "$0")"

echo "停止服務中..."
docker compose stop bot wizard
echo "[OK] 已停止 bot 與 wizard"
