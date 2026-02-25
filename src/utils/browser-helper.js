const fs = require('fs');
const path = require('path');
const os = require('os');

function sanitize(value) {
  return String(value || '').trim();
}

function localBrowserCandidates() {
  const candidates = [];
  const envChrome = sanitize(process.env.CHROME_PATH);
  const envPptr = sanitize(process.env.PUPPETEER_EXECUTABLE_PATH);
  if (envChrome) candidates.push(envChrome);
  if (envPptr) candidates.push(envPptr);

  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium'
    );
  }
  return candidates;
}

function firstExisting(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {
      // ignore
    }
  }
  return '';
}

function resolvePuppeteerExecutable() {
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const puppeteer = require('puppeteer');
    const executablePath = puppeteer.executablePath && puppeteer.executablePath();
    if (executablePath && fs.existsSync(executablePath)) {
      return executablePath;
    }
  } catch (_) {
    // ignore
  }
  return '';
}

function cacheFallbackCandidates() {
  const home = os.homedir();
  if (!home) return [];
  const base = process.platform === 'win32'
    ? path.join(home, '.cache', 'puppeteer', 'chrome')
    : path.join(home, '.cache', 'puppeteer', 'chrome');
  if (!fs.existsSync(base)) return [];

  const bins = [];
  const dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const d of dirs) {
    if (process.platform === 'win32') {
      bins.push(path.join(base, d, 'chrome-win64', 'chrome.exe'));
      bins.push(path.join(base, d, 'chrome-win', 'chrome.exe'));
    } else if (process.platform === 'darwin') {
      bins.push(path.join(base, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
      bins.push(path.join(base, d, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'));
    } else {
      bins.push(path.join(base, d, 'chrome-linux64', 'chrome'));
    }
  }
  return bins;
}

async function ensureBrowserExecutable(options = {}) {
  const preferLocal = options.preferLocal !== false;
  const log = typeof options.log === 'function' ? options.log : null;

  let executablePath = '';
  if (preferLocal) {
    executablePath = firstExisting(localBrowserCandidates());
    if (executablePath) return { ok: true, executablePath, source: 'local' };
  }

  executablePath = resolvePuppeteerExecutable();
  if (executablePath) return { ok: true, executablePath, source: 'puppeteer-cache' };
  executablePath = firstExisting(cacheFallbackCandidates());
  if (executablePath) return { ok: true, executablePath, source: 'puppeteer-cache' };

  if (!preferLocal) {
    executablePath = firstExisting(localBrowserCandidates());
    if (executablePath) return { ok: true, executablePath, source: 'local-fallback' };
  }

  if (log) {
    log('找不到可用瀏覽器，請手動安裝 Chrome/Edge，或設定 CHROME_PATH。');
  }
  return { ok: false, error: '找不到 Chrome/Edge，也找不到 Puppeteer 瀏覽器。' };
}

module.exports = {
  ensureBrowserExecutable
};
