const http = require('http');
const fs = require('fs');
const dotenv = require('dotenv');

function createBotControlClient(options) {
  const {
    envPath,
    preferredHost = 'bot',
    preferredPort = 38866,
    fallbackHosts = ['127.0.0.1', 'localhost']
  } = options;

  function readBotControlToken() {
    const fromEnv = String(process.env.BOT_CONTROL_TOKEN || '').trim();
    if (fromEnv) return fromEnv;
    try {
      const raw = fs.readFileSync(envPath, 'utf8');
      const parsed = dotenv.parse(raw);
      return String(parsed.BOT_CONTROL_TOKEN || '').trim();
    } catch (_) {
      return '';
    }
  }

  function postJson({ host, port, path: route, timeoutMs = 5000 }) {
    const token = readBotControlToken();
    const headers = { 'Content-Type': 'application/json', 'Content-Length': '0' };
    if (token) headers['X-Bot-Control-Token'] = token;

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host,
          port,
          path: route,
          method: 'POST',
          headers,
          timeout: timeoutMs
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            let parsed = {};
            if (body) {
              try {
                parsed = JSON.parse(body);
              } catch (_) {
                parsed = { raw: body };
              }
            }
            resolve({ status: res.statusCode || 0, body: parsed });
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('request timeout')));
      req.end();
    });
  }

  async function postBot(route, timeoutMs = 5000) {
    const hosts = [];
    const normalizedPreferred = String(preferredHost || '').trim();
    if (normalizedPreferred) hosts.push(normalizedPreferred);
    for (const fallback of fallbackHosts) {
      const host = String(fallback || '').trim();
      if (!host || host === normalizedPreferred) continue;
      hosts.push(host);
    }

    let lastErr = null;
    for (const host of hosts) {
      try {
        return await postJson({ host, port: preferredPort, path: route, timeoutMs });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('無法連線至 bot 控制端點');
  }

  return {
    postJson,
    postBot
  };
}

module.exports = {
  createBotControlClient
};
