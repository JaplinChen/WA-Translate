const dotenv = require('dotenv');
dotenv.config();

const fs = require('fs');
const http = require('http');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Client: WhatsAppClient, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { ensureBrowserExecutable } = require('./browser-helper');
const { cleanupStaleSessionLocks } = require('./wa-session-utils');

const cleanEnv = (str, allowSpaces = false) => {
  if (!str) return '';
  let cleaned = String(str).replace(/[^\x20-\x7E]/g, '');
  if (!allowSpaces) cleaned = cleaned.replace(/\s/g, '');
  return cleaned.trim();
};

const parseBoolean = (value, fallback = false) => {
  const v = cleanEnv(value).toLowerCase();
  if (!v) return fallback;
  return /^(1|true|yes|on)$/i.test(v);
};

const normalizeLang = (value) => cleanEnv(value, true).toLowerCase();

function parsePairs(raw) {
  const tokens = (raw || '')
    .split(',')
    .map((v) => cleanEnv(v, true))
    .filter(Boolean);

  const seen = new Set();
  const pairs = [];
  for (const token of tokens) {
    const parts = token.split(':').map(normalizeLang).filter(Boolean);
    if (parts.length !== 2) continue;
    const key = `${parts[0]}:${parts[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ source: parts[0], target: parts[1], key });
  }
  return pairs;
}

function loadApiKeys() {
  const direct = (process.env.GEMINI_API_KEYS || '')
    .split(',')
    .map((k) => cleanEnv(k))
    .filter(Boolean);
  if (direct.length > 0) return direct;

  const filePath = cleanEnv(process.env.GEMINI_API_KEYS_FILE || '/run/secrets/gemini_api_keys', true);
  if (!filePath) return [];
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content
      .split(/[,\r\n]+/)
      .map((k) => cleanEnv(k))
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function readEnvFileVars() {
  try {
    const raw = fs.readFileSync('.env', 'utf8');
    return dotenv.parse(raw);
  } catch (_) {
    return {};
  }
}

function pickEnv(envVars, key, fallback = '') {
  if (Object.prototype.hasOwnProperty.call(envVars, key)) return envVars[key];
  if (Object.prototype.hasOwnProperty.call(process.env, key)) return process.env[key];
  return fallback;
}

function buildConfig() {
  const envVars = readEnvFileVars();
  const prevApiKeysFile = process.env.GEMINI_API_KEYS_FILE;
  process.env.GEMINI_API_KEYS_FILE = pickEnv(envVars, 'GEMINI_API_KEYS_FILE', prevApiKeysFile || '/run/secrets/gemini_api_keys');

  const config = {
    WA_ENABLED: parseBoolean(pickEnv(envVars, 'WHATSAPP_ENABLED', 'true'), true),
    WA_SESSION_CLIENT_ID: cleanEnv(pickEnv(envVars, 'WHATSAPP_SESSION_CLIENT_ID', 'wa-translate'), true),
    WA_TRANSLATE_GROUP_ID: cleanEnv(pickEnv(envVars, 'WHATSAPP_TRANSLATE_GROUP_ID', ''), true).replace(/^id=/i, ''),
    WA_TRANSLATE_INCLUDE_FROM_ME: parseBoolean(pickEnv(envVars, 'WHATSAPP_TRANSLATE_INCLUDE_FROM_ME', 'true'), true),
    BOT_HEALTH_ENABLED: parseBoolean(pickEnv(envVars, 'BOT_HEALTH_ENABLED', 'true'), true),
    BOT_HEALTH_PORT: Number.parseInt(pickEnv(envVars, 'BOT_HEALTH_PORT', '38866'), 10),
    GEMINI_MODEL: cleanEnv(pickEnv(envVars, 'GEMINI_MODEL', 'gemini-2.5-flash'), true),
    GEMINI_MIN_INTERVAL_MS: Number.parseInt(pickEnv(envVars, 'GEMINI_MIN_INTERVAL_MS', '12000'), 10),
    API_KEYS: loadApiKeys(),
    PAIRS: parsePairs(pickEnv(envVars, 'TRANSLATE_PAIRS', 'zh-tw:vi,vi:zh-tw')),
    DEFAULT_PAIR: cleanEnv(pickEnv(envVars, 'DEFAULT_PAIR', 'zh-tw:vi'), true).toLowerCase()
  };

  process.env.GEMINI_API_KEYS_FILE = prevApiKeysFile;
  return config;
}

function validateConfig(config) {
  if (!config.WA_ENABLED) {
    return { ok: false, error: 'WHATSAPP_ENABLED=false，程式不啟動。', exitCode: 0 };
  }
  if (!config.WA_TRANSLATE_GROUP_ID) {
    return { ok: false, error: '缺少 WHATSAPP_TRANSLATE_GROUP_ID，請先設定 .env。', exitCode: 1 };
  }
  if (config.API_KEYS.length === 0) {
    return { ok: false, error: '缺少 Gemini API Key，請設定 GEMINI_API_KEYS 或 GEMINI_API_KEYS_FILE。', exitCode: 1 };
  }
  if (config.PAIRS.length === 0) {
    return { ok: false, error: 'TRANSLATE_PAIRS 格式無效，至少要有一組 source:target。', exitCode: 1 };
  }
  return { ok: true };
}

let CONFIG = buildConfig();
const initialCheck = validateConfig(CONFIG);
if (!initialCheck.ok) {
  if (initialCheck.exitCode === 0) {
    console.log(initialCheck.error);
  } else {
    console.error(initialCheck.error);
  }
  process.exit(initialCheck.exitCode);
}

let pairMap = new Map(CONFIG.PAIRS.map((p) => [p.key, p]));
let currentPair = pairMap.get(CONFIG.DEFAULT_PAIR) || CONFIG.PAIRS[0];
let apiClients = CONFIG.API_KEYS.map((key) => new GoogleGenerativeAI(key));
let apiKeyIndex = 0;
let waClient = null;
let healthServer = null;
let browserInfo = null;
let waPausedByWizard = false;
let waStarting = false;
let translateQueue = Promise.resolve();
let nextTranslateAt = 0;
const recentBotMessageIds = new Set();
const recentBotBodies = new Map();
const BOT_ECHO_TTL_MS = 120 * 1000;
const processedMessageIds = new Map();
const BOT_MESSAGE_MARKER = '\u2063\u2063';
const pendingBotBodies = new Map();

function applyRuntimeConfig(config, { keepCurrentPair = true } = {}) {
  CONFIG = config;
  pairMap = new Map(CONFIG.PAIRS.map((p) => [p.key, p]));
  const fallbackPair = pairMap.get(CONFIG.DEFAULT_PAIR) || CONFIG.PAIRS[0];
  if (!keepCurrentPair || !currentPair || !pairMap.has(currentPair.key)) {
    currentPair = fallbackPair;
  }
  apiClients = CONFIG.API_KEYS.map((key) => new GoogleGenerativeAI(key));
  apiKeyIndex = 0;
}

const isChineseText = (text) => /[\u3400-\u9FFF\uF900-\uFAFF]/.test(text);
const isVietnameseText = (text) => /[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(text);
const langPrefix = (lang) => normalizeLang(lang).split('-')[0];

function findPairBySource(sourceLang) {
  const sourcePrefix = langPrefix(sourceLang);
  return CONFIG.PAIRS.find((p) => langPrefix(p.source) === sourcePrefix) || null;
}

function detectPairByText(text) {
  if (isChineseText(text)) return findPairBySource('zh') || currentPair;
  if (isVietnameseText(text)) return findPairBySource('vi') || currentPair;
  return currentPair;
}

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

function enqueueTranslateTask(taskFn) {
  const run = translateQueue.then(taskFn, taskFn);
  translateQueue = run.catch(() => {});
  return run;
}

function normalizeBody(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function rememberBotMessage(sentMsg, body) {
  const now = Date.now();
  const id = sentMsg && sentMsg.id ? (sentMsg.id._serialized || sentMsg.id.id || '') : '';
  if (id) recentBotMessageIds.add(String(id));

  const key = normalizeBody(body);
  if (key) recentBotBodies.set(key, now + BOT_ECHO_TTL_MS);
}

function cleanupBotEchoMemory() {
  const now = Date.now();
  for (const [key, expireAt] of recentBotBodies.entries()) {
    if (expireAt <= now) recentBotBodies.delete(key);
  }
  for (const [key, expireAt] of pendingBotBodies.entries()) {
    if (expireAt <= now) pendingBotBodies.delete(key);
  }
  for (const [id, expireAt] of processedMessageIds.entries()) {
    if (expireAt <= now) processedMessageIds.delete(id);
  }
}

function isLikelyBotEcho(msg, body) {
  cleanupBotEchoMemory();

  const msgId = msg && msg.id ? (msg.id._serialized || msg.id.id || '') : '';
  if (msgId && recentBotMessageIds.has(String(msgId))) {
    recentBotMessageIds.delete(String(msgId));
    return true;
  }

  if (!msg || !msg.fromMe) return false;
  const key = normalizeBody(body);
  if (!key) return false;
  const pendingExpireAt = pendingBotBodies.get(key);
  if (pendingExpireAt && pendingExpireAt > Date.now()) return true;
  const expireAt = recentBotBodies.get(key);
  if (!expireAt) return false;
  if (expireAt <= Date.now()) {
    recentBotBodies.delete(key);
    return false;
  }
  return true;
}

function markAndCheckProcessed(msg) {
  cleanupBotEchoMemory();
  const msgId = msg && msg.id ? (msg.id._serialized || msg.id.id || '') : '';
  if (!msgId) return false;
  if (processedMessageIds.has(msgId)) return true;
  processedMessageIds.set(msgId, Date.now() + BOT_ECHO_TTL_MS);
  return false;
}

function markPendingBotBody(body) {
  const key = normalizeBody(body);
  if (!key) return;
  pendingBotBodies.set(key, Date.now() + BOT_ECHO_TTL_MS);
}

function clearPendingBotBody(body) {
  const key = normalizeBody(body);
  if (!key) return;
  pendingBotBodies.delete(key);
}

async function translateText(text, pair) {
  const prompt = [
    '你是專業翻譯引擎，只做翻譯。',
    `請把以下內容從 ${pair.source} 翻譯成 ${pair.target}。`,
    '規則：',
    '1) 僅輸出翻譯結果，不要解釋。',
    '2) 保留人名、網址、程式碼、數字與專有名詞。',
    '3) 若原文主要不是可翻譯自然語言，回傳原文。',
    '',
    text
  ].join('\n');

  let lastError = null;
  for (let i = 0; i < apiClients.length; i += 1) {
    const idx = (apiKeyIndex + i) % apiClients.length;
    const model = apiClients[idx].getGenerativeModel({ model: CONFIG.GEMINI_MODEL });
    try {
      const now = Date.now();
      if (nextTranslateAt > now) {
        await sleep(nextTranslateAt - now);
      }
      const result = await model.generateContent(prompt);
      const minInterval = Number.isFinite(CONFIG.GEMINI_MIN_INTERVAL_MS) ? CONFIG.GEMINI_MIN_INTERVAL_MS : 12000;
      nextTranslateAt = Date.now() + Math.max(0, minInterval);
      apiKeyIndex = (idx + 1) % apiClients.length;
      return result.response.text().trim();
    } catch (err) {
      if (isQuotaRateLimitError(err)) {
        const retryMs = parseRetryDelayMs(err);
        if (retryMs > 0) {
          console.warn(`Gemini 速率限制，等待 ${Math.ceil(retryMs / 1000)} 秒後重試...`);
          await sleep(retryMs);
          try {
            const result = await model.generateContent(prompt);
            const minInterval = Number.isFinite(CONFIG.GEMINI_MIN_INTERVAL_MS) ? CONFIG.GEMINI_MIN_INTERVAL_MS : 12000;
            nextTranslateAt = Date.now() + Math.max(0, minInterval);
            apiKeyIndex = (idx + 1) % apiClients.length;
            return result.response.text().trim();
          } catch (retryErr) {
            lastError = retryErr;
            continue;
          }
        }
      }
      lastError = err;
    }
  }
  throw lastError || new Error('翻譯失敗');
}

async function resolveChatId(msg) {
  try {
    const chat = await msg.getChat();
    if (chat && chat.id && chat.id._serialized) return chat.id._serialized;
  } catch (_) {
    // ignore
  }
  return msg.from || '';
}

function helpText() {
  const pairList = CONFIG.PAIRS.map((p) => `- ${p.key}`).join('\n');
  return [
    '可用指令：',
    '/help 顯示說明',
    '/gid 顯示目前群組 ID',
    '/status 查看目前翻譯模式',
    '/mode 列出可用模式',
    '/mode <source:target> 切換翻譯模式（例如 /mode zh-tw:vi）',
    '',
    '可用模式：',
    pairList
  ].join('\n');
}

async function handleCommand(msg, body, replyChatId) {
  const raw = body.trim();
  if (!raw.startsWith('/')) return false;

  if (/^\/help$/i.test(raw)) {
    await waClient.sendMessage(replyChatId, helpText());
    return true;
  }
  if (/^\/gid$/i.test(raw)) {
    const chatId = await resolveChatId(msg);
    await waClient.sendMessage(replyChatId, `chatId: ${chatId}`);
    return true;
  }
  if (/^\/status$/i.test(raw)) {
    await waClient.sendMessage(
      replyChatId,
      `目前模式: ${currentPair.key}\n群組: ${CONFIG.WA_TRANSLATE_GROUP_ID}\n可翻譯對數: ${CONFIG.PAIRS.length}`
    );
    return true;
  }
  if (/^\/mode$/i.test(raw)) {
    const text = ['可用翻譯模式：', ...CONFIG.PAIRS.map((p) => `- ${p.key}`), '', `目前模式: ${currentPair.key}`].join('\n');
    await waClient.sendMessage(replyChatId, text);
    return true;
  }

  const match = raw.match(/^\/mode\s+([a-zA-Z-]+:[a-zA-Z-]+)$/i);
  if (match) {
    const key = match[1].toLowerCase();
    const pair = pairMap.get(key);
    if (!pair) {
      await waClient.sendMessage(replyChatId, `無效模式: ${key}\n請用 /mode 查看可用清單。`);
      return true;
    }
    currentPair = pair;
    await waClient.sendMessage(replyChatId, `已切換翻譯模式為 ${currentPair.key}`);
    return true;
  }

  await waClient.sendMessage(replyChatId, '不支援的指令，請使用 /help。');
  return true;
}

async function bootstrap() {
  async function stopWaClient() {
    if (!waClient) return;
    const client = waClient;
    waClient = null;
    await client.destroy().catch(() => {});
  }

  function createWaClient(browser) {
    const client = new WhatsAppClient({
      authStrategy: new LocalAuth({ clientId: CONFIG.WA_SESSION_CLIENT_ID }),
      puppeteer: {
        executablePath: browser.executablePath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          '--disable-background-networking',
          '--remote-allow-origins=*',
          '--disable-breakpad',
          '--disable-crash-reporter'
        ]
      }
    });

    client.on('qr', (qr) => {
      console.log('請使用 WhatsApp 掃描 QR Code：');
      qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
      const self = client.info && client.info.wid ? client.info.wid._serialized : 'unknown';
      console.log(`WhatsApp 已就緒，登入帳號: ${self}`);
      console.log(`目標群組: ${CONFIG.WA_TRANSLATE_GROUP_ID}`);
      console.log(`目前翻譯模式: ${currentPair.key}`);
    });

    client.on('auth_failure', (msg) => console.error(`WhatsApp 驗證失敗: ${msg}`));
    client.on('disconnected', (reason) => console.error(`WhatsApp 已斷線: ${reason}`));

    client.on('message_create', async (msg) => {
    try {
      if (markAndCheckProcessed(msg)) return;

      const chatId = await resolveChatId(msg);
      if (chatId !== CONFIG.WA_TRANSLATE_GROUP_ID) return;

      const rawBody = String(msg.body || '');
      if (rawBody.startsWith(BOT_MESSAGE_MARKER)) return;
      const body = rawBody.trim();
      if (!body) return;
      if (isLikelyBotEcho(msg, body)) return;
      if (msg.fromMe && !CONFIG.WA_TRANSLATE_INCLUDE_FROM_ME) return;

      const replyChatId = chatId || (msg.fromMe ? msg.to : msg.from);
      if (!replyChatId) return;

      const isCommand = await handleCommand(msg, body, replyChatId);
      if (isCommand) return;

      const pair = detectPairByText(body);
      await enqueueTranslateTask(async () => {
        const translated = await translateText(body, pair);
        if (!translated || translated.trim() === body.trim()) return;
        markPendingBotBody(translated);
        let sent = null;
        try {
          const outboundText = `${BOT_MESSAGE_MARKER}${translated}`;
          sent = await client.sendMessage(replyChatId, outboundText);
        } finally {
          clearPendingBotBody(translated);
        }
        rememberBotMessage(sent, translated);
        console.log(`已翻譯 (${pair.key}) ${body.slice(0, 30)}...`);
      });
    } catch (err) {
      console.error(`翻譯失敗: ${err.message}`);
    }
    });
    return client;
  }

  async function startWaClient() {
    if (waClient || waStarting) return { ok: true };
    waStarting = true;
    try {
      if (!browserInfo) {
        const browser = await ensureBrowserExecutable({ preferLocal: true, log: console.log });
        if (!browser.ok) {
          return { ok: false, error: browser.error || '找不到可用瀏覽器。' };
        }
        browserInfo = browser;
        console.log(`使用瀏覽器：${browserInfo.executablePath} (${browserInfo.source})`);
      }

      const removedLocks = cleanupStaleSessionLocks(CONFIG.WA_SESSION_CLIENT_ID);
      if (removedLocks > 0) console.log(`已清理舊 session 鎖檔: ${removedLocks} 個`);

      waClient = createWaClient(browserInfo);
      waClient.initialize().catch((err) => {
        console.error(`WhatsApp 初始化失敗: ${err.message}`);
        if (!waPausedByWizard) process.exit(1);
      });
      return { ok: true };
    } finally {
      waStarting = false;
    }
  }

  const startResult = await startWaClient();
  if (!startResult.ok) {
    console.error(startResult.error);
    process.exit(1);
  }

  if (CONFIG.BOT_HEALTH_ENABLED && Number.isFinite(CONFIG.BOT_HEALTH_PORT)) {
    healthServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/reload') {
        const nextConfig = buildConfig();
        const check = validateConfig(nextConfig);
        if (!check.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: check.error }));
          return;
        }
        applyRuntimeConfig(nextConfig, { keepCurrentPair: true });
        console.log(`已重新載入設定：群組=${CONFIG.WA_TRANSLATE_GROUP_ID}，語言對=${CONFIG.PAIRS.length}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          ok: true,
          groupId: CONFIG.WA_TRANSLATE_GROUP_ID,
          pairs: CONFIG.PAIRS.length,
          mode: currentPair.key
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/wa/pause') {
        waPausedByWizard = true;
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
        waPausedByWizard = false;
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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        ready: Boolean(waClient && waClient.info),
        mode: currentPair.key,
        paused: waPausedByWizard
      }));
    });
    healthServer.listen(CONFIG.BOT_HEALTH_PORT, '0.0.0.0', () => {
      console.log(`健康檢查端點：http://0.0.0.0:${CONFIG.BOT_HEALTH_PORT}/healthz`);
    });
  }
}

function shutdown() {
  if (waClient) waClient.destroy().catch(() => {});
  if (healthServer) healthServer.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

bootstrap().catch((err) => {
  console.error(`啟動失敗: ${err.message}`);
  process.exit(1);
});
