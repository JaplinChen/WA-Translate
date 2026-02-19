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
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function getRequestToken(req, url, authCookieName) {
  const fromQuery = String(url.searchParams.get('token') || '').trim();
  if (fromQuery) return fromQuery;
  const fromHeader = String(req.headers['x-wizard-token'] || '').trim();
  if (fromHeader) return fromHeader;
  const cookies = parseCookies(req.headers.cookie);
  return String(cookies[authCookieName] || '').trim();
}

function isLoopbackRequest(req) {
  const remote = String(req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '');
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

function createWizardAuth(options) {
  const {
    requireToken,
    runtimeAccessToken,
    authCookieName,
    sendJson
  } = options;

  function isAuthorized(req, url) {
    if (!requireToken) return true;
    if (isLoopbackRequest(req)) return true;
    const token = getRequestToken(req, url, authCookieName);
    return token && token === runtimeAccessToken;
  }

  function setAuthCookie(res) {
    if (!requireToken) return;
    res.setHeader(
      'Set-Cookie',
      `${authCookieName}=${encodeURIComponent(runtimeAccessToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
    );
  }

  function sendUnauthorized(req, res) {
    const errorMessage = '缺少或無效的 Wizard 存取 token，請使用啟動訊息提供的網址。';
    if (req.url && req.url.startsWith('/api/')) {
      sendJson(res, 401, { ok: false, error: errorMessage });
      return;
    }
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(errorMessage);
  }

  return {
    isAuthorized,
    setAuthCookie,
    sendUnauthorized,
    getRequestToken: (req, url) => getRequestToken(req, url, authCookieName)
  };
}

module.exports = {
  createWizardAuth
};
