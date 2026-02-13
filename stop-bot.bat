@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo 停止服務中...
docker compose stop bot wizard
if %errorlevel% neq 0 (
  echo [ERROR] 停止失敗，請先確認 Docker Desktop 已啟動。
  pause
  exit /b 1
)

echo [OK] 已停止 bot 與 wizard。
pause
