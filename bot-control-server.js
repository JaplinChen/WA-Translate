const http = require('http');
const { isAuthorizedBotControl, botControlAuthError } = require('./bot-control-auth');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function startBotControlServer(deps) {
  const {
    getConfig,
    getCurrentPair,
    getWaReady,
    getWaPaused,
    setWaPaused,
    startWaClient,
    stopWaClient,
    buildConfig,
    validateConfig,
    applyRuntimeConfig,
    log
  } = deps;

  const config = getConfig();
  if (!config.BOT_HEALTH_ENABLED || !Number.isFinite(config.BOT_HEALTH_PORT)) {
    return null;
  }

  if (!config.BOT_CONTROL_TOKEN) {
    log('warn', '警告：未設定 BOT_CONTROL_TOKEN，bot 控制端點僅允許本機請求。');
  }

  const server = http.createServer((req, res) => {
    const runtimeConfig = getConfig();

    if (req.method === 'POST' && req.url === '/reload') {
      if (!isAuthorizedBotControl(req, runtimeConfig.BOT_CONTROL_TOKEN)) {
        sendJson(res, 401, { ok: false, error: botControlAuthError(runtimeConfig.BOT_CONTROL_TOKEN) });
        return;
      }

      const nextConfig = buildConfig();
      const check = validateConfig(nextConfig);
      if (!check.ok) {
        sendJson(res, 400, { ok: false, error: check.error });
        return;
      }

      applyRuntimeConfig(nextConfig, { keepCurrentPair: true });
      const applied = getConfig();
      log('info', `已重新載入設定：群組=${applied.WA_TRANSLATE_GROUP_ID}，語言對=${applied.PAIRS.length}`);
      sendJson(res, 200, {
        ok: true,
        groupId: applied.WA_TRANSLATE_GROUP_ID,
        pairs: applied.PAIRS.length,
        mode: getCurrentPair().key
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/wa/pause') {
      if (!isAuthorizedBotControl(req, runtimeConfig.BOT_CONTROL_TOKEN)) {
        sendJson(res, 401, { ok: false, error: botControlAuthError(runtimeConfig.BOT_CONTROL_TOKEN) });
        return;
      }

      setWaPaused(true);
      stopWaClient().then(() => {
        sendJson(res, 200, { ok: true, paused: true });
      }).catch((err) => {
        sendJson(res, 500, { ok: false, error: err.message });
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/wa/resume') {
      if (!isAuthorizedBotControl(req, runtimeConfig.BOT_CONTROL_TOKEN)) {
        sendJson(res, 401, { ok: false, error: botControlAuthError(runtimeConfig.BOT_CONTROL_TOKEN) });
        return;
      }

      setWaPaused(false);
      startWaClient().then((result) => {
        if (!result.ok) {
          sendJson(res, 500, { ok: false, error: result.error || 'resume failed' });
          return;
        }
        sendJson(res, 200, { ok: true, paused: false });
      }).catch((err) => {
        sendJson(res, 500, { ok: false, error: err.message });
      });
      return;
    }

    if (req.method !== 'GET' || req.url !== '/healthz') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    sendJson(res, 200, {
      ok: true,
      ready: getWaReady(),
      mode: getCurrentPair().key,
      paused: getWaPaused()
    });
  });

  server.listen(config.BOT_HEALTH_PORT, '0.0.0.0', () => {
    log('info', `健康檢查端點：http://0.0.0.0:${config.BOT_HEALTH_PORT}/healthz`);
  });

  return server;
}

module.exports = {
  startBotControlServer
};
