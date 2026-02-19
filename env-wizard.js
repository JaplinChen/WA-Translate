const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const { HOST, PORT, PUBLIC_DIR, REQUIRE_TOKEN, ACCESS_TOKEN, ENV_PATH } = require('./wizard/lib/constants');
const { loadConfig, saveConfig } = require('./wizard/lib/env-config');
const { WhatsAppManager } = require('./wizard/lib/wa-manager');
const { sendJson, collectJsonBody, serveStaticFile } = require('./wizard/lib/http-utils');
const { createWizardAuth } = require('./wizard/lib/wizard-auth');
const { createBotControlClient } = require('./wizard/lib/bot-control-client');

const waManager = new WhatsAppManager();
const AUTH_COOKIE_NAME = 'wa_wizard_auth';
const botControlHost = String(process.env.BOT_CONTROL_HOST || 'bot').trim() || 'bot';
const botControlPort = Number.parseInt(process.env.BOT_CONTROL_PORT || process.env.BOT_HEALTH_PORT || '38866', 10) || 38866;
const inDocker = fs.existsSync('/.dockerenv');
const botControlFallbackHosts = inDocker ? [] : ['127.0.0.1', 'localhost'];
const runtimeAccessToken = REQUIRE_TOKEN
  ? (ACCESS_TOKEN || crypto.randomBytes(18).toString('hex'))
  : '';
const auth = createWizardAuth({
  requireToken: REQUIRE_TOKEN,
  runtimeAccessToken,
  authCookieName: AUTH_COOKIE_NAME,
  sendJson
});
const { postBot } = createBotControlClient({
  envPath: ENV_PATH,
  preferredHost: botControlHost,
  preferredPort: botControlPort,
  fallbackHosts: botControlFallbackHosts
});

function openBrowser(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' });
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (!auth.isAuthorized(req, url)) {
    auth.sendUnauthorized(req, res);
    return;
  }
  if (REQUIRE_TOKEN && auth.getRequestToken(req, url) === runtimeAccessToken) {
    auth.setAuthCookie(res);
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('token')) {
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/') {
    const served = serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'));
    if (!served) sendJson(res, 500, { ok: false, error: '找不到設定頁面。' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/styles.css') {
    const served = serveStaticFile(res, path.join(PUBLIC_DIR, 'styles.css'));
    if (!served) sendJson(res, 404, { ok: false, error: '找不到 CSS 檔案。' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/app.js') {
    const served = serveStaticFile(res, path.join(PUBLIC_DIR, 'app.js'));
    if (!served) sendJson(res, 404, { ok: false, error: '找不到 JS 檔案。' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/app-runtime.js') {
    const served = serveStaticFile(res, path.join(PUBLIC_DIR, 'app-runtime.js'));
    if (!served) sendJson(res, 404, { ok: false, error: '找不到 app-runtime 檔案。' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/app-api-ops.js') {
    const served = serveStaticFile(res, path.join(PUBLIC_DIR, 'app-api-ops.js'));
    if (!served) sendJson(res, 404, { ok: false, error: '找不到 app-api-ops 檔案。' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/pair-manager.js') {
    const served = serveStaticFile(res, path.join(PUBLIC_DIR, 'pair-manager.js'));
    if (!served) sendJson(res, 404, { ok: false, error: '找不到 pair-manager 檔案。' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/env') {
    sendJson(res, 200, loadConfig());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/save') {
    try {
      const data = await collectJsonBody(req);
      saveConfig(data);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/apply') {
    try {
      const data = await collectJsonBody(req);
      saveConfig(data);
      waManager.stop();

      let reload = { ok: false, error: 'bot 尚未啟動，請先啟動 bot 服務。' };
      try {
        const result = await postBot('/reload');
        if (result.status >= 200 && result.status < 300 && result.body && result.body.ok) {
          reload = { ok: true, data: result.body };
        } else {
          reload = { ok: false, error: (result.body && result.body.error) || 'bot 重新載入失敗。' };
        }
      } catch (err) {
        reload = { ok: false, error: `無法連到 bot：${err.message}` };
      }

      let resume = { ok: false, error: 'bot 尚未恢復連線。' };
      try {
        const resumed = await postBot('/wa/resume');
        if (resumed.status >= 200 && resumed.status < 300 && resumed.body && resumed.body.ok) {
          resume = { ok: true };
        } else {
          resume = { ok: false, error: (resumed.body && resumed.body.error) || 'bot 恢復連線失敗。' };
        }
      } catch (err) {
        resume = { ok: false, error: `無法恢復 bot 連線：${err.message}` };
      }

      sendJson(res, 200, { ok: true, reload, resume });
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/wa/start') {
    try {
      try {
        await postBot('/wa/pause');
      } catch (_) {
        // ignore if bot is not available
      }
      const result = await waManager.start();
      sendJson(res, 200, {
        ok: true,
        alreadyStarted: Boolean(result && result.alreadyStarted),
        status: (result && result.status) || waManager.status
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/wa/stop') {
    waManager.stop();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/wa/groups') {
    if (!waManager.ready) {
      sendJson(res, 200, { ok: false, error: 'WhatsApp 尚未就緒，請先完成登入。' });
      return;
    }

    try {
      const groups = await waManager.refreshGroups();
      sendJson(res, 200, { ok: true, groups });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    res.write('retry: 3000\n\n');
    waManager.subscribe(res);
    res.write(`event: wa\ndata: ${JSON.stringify(waManager.snapshot())}\n\n`);
    req.on('close', () => waManager.unsubscribe(res));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  const url = `http://${displayHost}:${PORT}${REQUIRE_TOKEN ? `/?token=${runtimeAccessToken}` : ''}`;
  console.log(`✅ 設定精靈已啟動：${url}`);
  if (REQUIRE_TOKEN && !ACCESS_TOKEN) {
    console.log('ℹ️ 已自動產生一次性 Wizard token（重啟後會改變）。');
  }
  if (process.env.WIZARD_OPEN_BROWSER !== 'false') {
    openBrowser(url);
  }
});

function shutdown() {
  waManager.stop();
  waManager.closeSseClients();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
