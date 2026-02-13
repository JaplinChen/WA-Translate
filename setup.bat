@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

title WA Translate Docker Installer
echo ==========================================================
echo  WA Translate - Docker 一鍵安裝
echo ==========================================================
echo.

echo [1/6] 檢查 Docker...
docker version >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] 找不到 Docker。請先安裝並啟動 Docker Desktop。
  pause
  exit /b 1
)
docker compose version >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] 找不到 docker compose。請更新 Docker Desktop。
  pause
  exit /b 1
)
echo [OK] Docker 可用。
echo.

echo [2/6] 檢查必要檔案...
if not exist docker-compose.yml (
  echo [ERROR] 缺少 docker-compose.yml，請確認在專案根目錄執行。
  pause
  exit /b 1
)
if not exist .env (
  if exist .env.example (
    copy .env.example .env >nul
    echo [OK] 已建立 .env。
  ) else (
    echo [ERROR] 缺少 .env.example，無法初始化。
    pause
    exit /b 1
  )
) else (
  echo [OK] .env 已存在。
)
echo.

echo [3/6] 準備 secrets...
if not exist secrets mkdir secrets
if not exist secrets\gemini_api_keys.txt (
  echo [提示] 尚未建立 Gemini API key，請輸入一把 key：
  set /p GEMINI_KEY=API Key: 
  if "%GEMINI_KEY%"=="" (
    echo [ERROR] 不能空白，請重新執行 setup.bat。
    pause
    exit /b 1
  )
  powershell -NoProfile -Command "[IO.File]::WriteAllText('secrets/gemini_api_keys.txt',$env:GEMINI_KEY,[Text.UTF8Encoding]::new($false))"
  if %errorlevel% neq 0 (
    echo [ERROR] 寫入 secrets\gemini_api_keys.txt 失敗。
    pause
    exit /b 1
  )
  echo [OK] 已建立 secrets\gemini_api_keys.txt
) else (
  echo [OK] secrets\gemini_api_keys.txt 已存在。
)
echo.

echo [4/6] 啟動設定精靈（wizard）...
docker compose up -d --build wizard
if %errorlevel% neq 0 (
  echo [ERROR] wizard 啟動失敗，請先確認 Docker Desktop 正常。
  pause
  exit /b 1
)
echo [OK] wizard 已啟動。

echo.
echo [5/6] 開啟設定頁...
start "" "http://localhost:38765"
echo [OK] 已嘗試開啟瀏覽器。

echo.
echo [6/6] 下一步（只要照畫面做）：
echo 1. 在網頁按「開始連線」並用手機 WhatsApp 掃碼
echo 2. 選群組、設定翻譯方向
echo 3. 按「儲存並套用」
echo 4. 完成後可執行 start-bot.bat 啟動翻譯

echo.
echo ==========================================================
echo [OK] 安裝流程完成
echo - 重新開設定頁: docker compose up -d wizard
echo - 啟動翻譯 bot: start-bot.bat
echo - 停止服務: stop-bot.bat
echo ==========================================================
pause
