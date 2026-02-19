## 🔧 WA-Translate Docker：Wizard/Bot 連線與套用修復流程
**日期：** 2026-02-19
**情境：** Docker 部署後，Wizard 可開啟但「儲存並套用」失敗，出現 token、ENOTFOUND/ECONNREFUSED、bot 重啟迴圈。
**最佳實踐：**
- 先看 `docker compose ps` + `docker logs`，把問題分層：服務健康、授權、主機解析、設定缺值。
- 若 Wizard 顯示 token 錯誤，先用啟動日誌內的 `http://localhost:38765/?token=...` 進入，成功後同瀏覽器會有 cookie。
- Bot 重啟常見主因是 `.env` 缺 `WHATSAPP_TRANSLATE_GROUP_ID`；先補齊必填再看其他錯誤。
- 啟用 `BOT_CONTROL_TOKEN`，讓 Wizard 呼叫 `/reload`、`/wa/pause`、`/wa/resume` 可通過授權；避免只靠 loopback 例外。
- 在容器模式中，Wizard 應優先用 `host=bot` 連 bot 控制端點，不要 fallback 到容器內 `127.0.0.1`（會打到自己）。
- 本機模式可 fallback 到 `127.0.0.1/localhost`，並允許 `BOT_CONTROL_PORT` 覆蓋控制埠。
- 用 smoke 流程驗證：健康檢查、授權成功/失敗、`/api/apply` 回傳 `reload.ok=true` 與 `resume.ok=true`。
