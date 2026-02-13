@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo 啟動翻譯服務中...
docker compose up -d bot
if %errorlevel% neq 0 (
  echo [ERROR] 啟動失敗，請先確認 Docker Desktop 已啟動。
  pause
  exit /b 1
)

echo [OK] bot 已啟動。
echo 查看狀態：docker compose ps
pause
