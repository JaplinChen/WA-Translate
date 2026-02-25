function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(err) {
  if (!err || !err.message) return 0;
  const match = String(err.message).match(/Please retry in\s+([\d.]+)s/i);
  if (!match) return 0;
  const sec = Number.parseFloat(match[1]);
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  return Math.ceil(sec * 1000);
}

function isQuotaRateLimitError(err) {
  const msg = String((err && err.message) || '');
  return /429/.test(msg) || /quota exceeded/i.test(msg) || /Too Many Requests/i.test(msg);
}

module.exports = {
  sleep,
  parseRetryDelayMs,
  isQuotaRateLimitError
};
