const http = require('http');
const { buildConfig, validateConfig } = require('./runtime-config');

function createHealthServer({
  getConfig,
  applyConfig,
  getCurrentPair,
  getWaClient,
  getWaPaused,
  setWaPaused,
  stopWaClient,
  startWaClient
}) {
  const server = http.createServer((req, res) => {
    const config = getConfig();
    if (req.method === 'POST' && req.url === '/reload') {
      const nextConfig = buildConfig();
      const check = validateConfig(nextConfig);
      if (!check.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: check.error }));
        return;
      }
      applyConfig(nextConfig, { keepCurrentPair: true });
      const currentConfig = getConfig();
      console.log(`已重新載入設定：群組=${currentConfig.WA_TRANSLATE_GROUP_ID}，語言對=${currentConfig.PAIRS.length}`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        groupId: currentConfig.WA_TRANSLATE_GROUP_ID,
        pairs: currentConfig.PAIRS.length,
        mode: getCurrentPair().key
      }));
      return;
    }

    if (req.method === 'POST' && req.url === '/wa/pause') {
      const token = req.headers['x-bot-control-token'];
      if (config.BOT_CONTROL_TOKEN && token !== config.BOT_CONTROL_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
        return;
      }
      setWaPaused(true);
      stopWaClient().then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, paused: true }));
      }).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/wa/resume') {
      const token = req.headers['x-bot-control-token'];
      if (config.BOT_CONTROL_TOKEN && token !== config.BOT_CONTROL_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
        return;
      }
      setWaPaused(false);
      startWaClient().then((result) => {
        if (!result.ok) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: result.error || 'resume failed' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, paused: false }));
      }).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      });
      return;
    }

    if (req.method !== 'GET' || req.url !== '/healthz') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const waClient = getWaClient();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      ready: Boolean(waClient && waClient.info),
      mode: getCurrentPair().key,
      paused: getWaPaused()
    }));
  });

  return server;
}

module.exports = { createHealthServer };
