#!/bin/bash

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}==========================================================${NC}"
echo -e "${CYAN} WA Translate - Docker 一鍵安裝${NC}"
echo -e "${CYAN}==========================================================${NC}"
echo ""

echo "[1/6] 檢查 Docker..."
if ! command -v docker >/dev/null 2>&1; then
  echo -e "${RED}❌ 找不到 Docker，請先安裝並啟動 Docker Desktop${NC}"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo -e "${RED}❌ Docker daemon 尚未啟動，請先開啟 Docker Desktop${NC}"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo -e "${RED}❌ 找不到 docker compose，請更新 Docker Desktop${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Docker 可用${NC}"
echo ""

echo "[2/6] 準備 .env..."
if [ ! -f "docker-compose.yml" ]; then
  echo -e "${RED}❌ 缺少 docker-compose.yml，請在專案根目錄執行${NC}"
  exit 1
fi
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo -e "${GREEN}✅ 已建立 .env${NC}"
  else
    echo -e "${RED}❌ 缺少 .env.example，無法初始化${NC}"
    exit 1
  fi
else
  echo -e "${GREEN}✅ .env 已存在${NC}"
fi
echo ""

echo "[3/6] 準備 secrets..."
mkdir -p secrets
if [ ! -s "secrets/gemini_api_keys.txt" ]; then
  read -r -p "請輸入 Gemini API Key: " GEMINI_KEY
  if [ -z "$GEMINI_KEY" ]; then
    echo -e "${RED}❌ API key 不能空白${NC}"
    exit 1
  fi
  printf "%s" "$GEMINI_KEY" > secrets/gemini_api_keys.txt
  echo -e "${GREEN}✅ 已建立 secrets/gemini_api_keys.txt${NC}"
else
  echo -e "${GREEN}✅ secrets/gemini_api_keys.txt 已存在${NC}"
fi
echo ""

echo "[4/6] 啟動設定精靈（wizard）..."
docker compose up -d --build wizard
echo -e "${GREEN}✅ wizard 已啟動${NC}"
echo ""

echo "[5/6] 開啟設定頁..."
WIZARD_URL="http://localhost:38765"
if command -v open >/dev/null 2>&1; then
  open "$WIZARD_URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$WIZARD_URL" >/dev/null 2>&1 || true
fi
echo -e "${GREEN}✅ 設定頁：${WIZARD_URL}${NC}"
echo ""

echo "[6/6] 下一步："
echo "1) 網頁按「開始連線」，用手機 WhatsApp 掃碼"
echo "2) 選群組、設定翻譯方向"
echo "3) 按「儲存並套用」"
echo "4) 完成後執行 ./start-bot.sh 啟動翻譯"
echo ""

echo -e "${GREEN}==========================================================${NC}"
echo -e "${GREEN} 安裝流程完成 ${NC}"
echo -e " - 重新開設定頁: docker compose up -d wizard"
echo -e " - 啟動翻譯 bot: ./start-bot.sh"
echo -e " - 停止服務: ./stop-bot.sh"
echo -e "${GREEN}==========================================================${NC}"
