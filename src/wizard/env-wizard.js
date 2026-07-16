const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const { HOST, PORT, PUBLIC_DIR, REQUIRE_TOKEN, ACCESS_TOKEN, ENV_PATH } = require('./lib/constants');
const { loadConfig, saveConfig } = require('./lib/env-config');
const { WhatsAppManager } = require('./lib/wa-manager');
const { sendJson, collectJsonBody, serveStaticFile } = require('./lib/http-utils');
const { createBotControlClient } = require('./lib/bot-control-client');

const BOT_HOST = process.env.BOT_HOST || 'bot';
const BOT_HEALTH_PORT = Number.parseInt(process.env.BOT_HEALTH_PORT || '38866', 10);

const waManager = new WhatsAppManager();
const sseConnections = new Map();
const botClient = createBotControlClient({
  envPath: ENV_PATH,
  preferredHost: BOT_HOST,
  preferredPort: BOT_HEALTH_PORT
});
const {
  runtimeAccessToken,
  getRequestToken,
  isAuthorized,
  setAuthCookie,
  sendUnauthorized
} = require('./lib/auth-utils');

function openBrowser(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' });
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  }
}

function servePublicAsset(urlPath, res) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const resolved = path.join(PUBLIC_DIR, safePath);
  const publicRoot = path.resolve(PUBLIC_DIR);
  const assetPath = path.resolve(resolved);
  if (!assetPath.startsWith(publicRoot)) return false;
  return serveStaticFile(res, assetPath);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!isAuthorized(req, url)) {
    sendUnauthorized(req, res);
    return;
  }
  if (REQUIRE_TOKEN && getRequestToken(req, url) === runtimeAccessToken) {
    setAuthCookie(res);
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

  if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
    const requestPath = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    if (requestPath) {
      const served = servePublicAsset(requestPath, res);
      if (served) return;
      sendJson(res, 404, { ok: false, error: `找不到檔案：${url.pathname}` });
      return;
    }
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
        const result = await botClient.postBot('/reload');
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
        const resumed = await botClient.postBot('/wa/resume');
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
        await botClient.postBot('/wa/pause');
      } catch (_) {
        // ignore if bot is not available
      }
      const result = await waManager.start();
      if (result && result.ok === false) {
        sendJson(res, 200, {
          ok: false,
          error: result.error || '啟動失敗。',
          status: result.status || waManager.status
        });
        return;
      }
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
    const clientIp = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
    const count = sseConnections.get(clientIp) || 0;
    if (count >= 3) {
      res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Too Many Requests');
      return;
    }
    sseConnections.set(clientIp, count + 1);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    res.write(`retry: 3000

`);
    waManager.subscribe(res);
    res.write(`event: wa
data: ${JSON.stringify(waManager.snapshot())}

`);
    req.on('close', () => {
      waManager.unsubscribe(res);
      const currentCount = sseConnections.get(clientIp) || 1;
      sseConnections.set(clientIp, Math.max(0, currentCount - 1));
    });
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
