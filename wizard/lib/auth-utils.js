const crypto = require('crypto');
const { REQUIRE_TOKEN, ACCESS_TOKEN, PORT } = require('./constants');
const { sendJson } = require('./http-utils');

const AUTH_COOKIE_NAME = 'wa_wizard_auth';
const runtimeAccessToken = REQUIRE_TOKEN ? (ACCESS_TOKEN || crypto.randomBytes(18).toString('hex')) : '';

function parseCookies(header) {
  const cookieHeader = String(header || '');
  if (!cookieHeader) return {};
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf('=');
      if (idx <= 0) return acc;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      try {
        acc[key] = decodeURIComponent(value);
      } catch (_) {
        acc[key] = value;
      }
      return acc;
    }, {});
}

function getRequestToken(req, url) {
  const fromQuery = String(url.searchParams.get('token') || '').trim();
  if (fromQuery) return fromQuery;
  const fromHeader = String(req.headers['x-wizard-token'] || '').trim();
  if (fromHeader) return fromHeader;
  const cookies = parseCookies(req.headers.cookie);
  return String(cookies[AUTH_COOKIE_NAME] || '').trim();
}

function isLoopbackRequest(req) {
  const remote = String(req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '');
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

function isLocalHostHeader(req) {
  const hostHeader = String(req.headers.host || '').trim().toLowerCase();
  if (!hostHeader) return false;
  const host = hostHeader.split(':')[0];
  return host === 'localhost' || host === '127.0.0.1';
}

function isAuthorized(req, url) {
  if (!REQUIRE_TOKEN) return true;
  if (isLoopbackRequest(req)) return true;
  const token = getRequestToken(req, url);
  return token && token === runtimeAccessToken;
}

function setAuthCookie(res) {
  if (!REQUIRE_TOKEN) return;
  res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=${encodeURIComponent(runtimeAccessToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
}

function sendUnauthorized(req, res) {
  const errorMessage = '缺少或無效的 Wizard 存取 token，請使用啟動訊息提供的網址。';
  if (req.url && req.url.startsWith('/api/')) {
    sendJson(res, 401, { ok: false, error: errorMessage });
    return;
  }

  if (REQUIRE_TOKEN && (isLoopbackRequest(req) || isLocalHostHeader(req)) && runtimeAccessToken) {
    const secureUrl = `http://localhost:${PORT}/?token=${encodeURIComponent(runtimeAccessToken)}`;
    const html = [
      '<!doctype html>',
      '<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>Wizard 需要授權</title>',
      '<style>body{font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;padding:24px;line-height:1.6;color:#13353f;}',
      '.card{max-width:760px;border:1px solid #d4dee0;border-radius:12px;padding:18px;background:#f9fcfc;}',
      'a.btn{display:inline-block;margin-top:10px;padding:10px 14px;background:#0e7c86;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;}',
      'code{background:#eef4f5;padding:2px 6px;border-radius:6px;word-break:break-all;}</style></head><body>',
      '<div class="card">',
      `<p>${errorMessage}</p>`,
      '<p>你目前是從本機開啟，可直接使用下方安全入口：</p>`,
      `<p><a class="btn" href="${secureUrl}">使用安全入口開啟 Wizard</a></p>`,
      `<p>或手動貼上：<br><code>${secureUrl}</code></p>`,
      '</div></body></html>'
    ].join('');
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }

  res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(errorMessage);
}

module.exports = {
  runtimeAccessToken,
  getRequestToken,
  isAuthorized,
  setAuthCookie,
  sendUnauthorized
};
