function readHeaderToken(req) {
  const raw = req && req.headers ? req.headers['x-bot-control-token'] : '';
  if (Array.isArray(raw)) return String(raw[0] || '').trim();
  return String(raw || '').trim();
}

function isLoopbackRequest(req) {
  const remote = String(req && req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '');
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

function isAuthorizedBotControl(req, expectedToken) {
  if (isLoopbackRequest(req)) return true;
  const token = String(expectedToken || '').trim();
  if (!token) return false;
  return readHeaderToken(req) === token;
}

function botControlAuthError(expectedToken) {
  if (String(expectedToken || '').trim()) return '未授權的 bot 控制請求。';
  return 'BOT_CONTROL_TOKEN 未設定，僅允許本機控制。';
}

module.exports = {
  readHeaderToken,
  isLoopbackRequest,
  isAuthorizedBotControl,
  botControlAuthError
};
