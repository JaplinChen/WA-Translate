const fs = require('fs');
const path = require('path');

const LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

function cleanupStaleSessionLocks(clientId) {
  const safeClientId = String(clientId || '').trim();
  if (!safeClientId) return 0;

  const appRoot = path.resolve(__dirname);
  const sessionDir = path.join(appRoot, '.wwebjs_auth', `session-${safeClientId}`);
  if (!fs.existsSync(sessionDir)) return 0;

  const dynamicLocks = (() => {
    try {
      return fs.readdirSync(sessionDir).filter((name) => /^Singleton/i.test(name));
    } catch (_) {
      return [];
    }
  })();
  const candidates = [...new Set([...LOCK_FILES, ...dynamicLocks])];
  let removed = 0;

  for (const file of candidates) {
    const fullPath = path.join(sessionDir, file);
    try {
      fs.lstatSync(fullPath);
      fs.unlinkSync(fullPath);
      removed += 1;
    } catch (_) {
      // ignore stale lock cleanup errors
    }
  }
  return removed;
}

module.exports = {
  cleanupStaleSessionLocks
};
