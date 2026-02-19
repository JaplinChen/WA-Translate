const dotenv = require('dotenv');
dotenv.config();

const fs = require('fs');
const { ensureBrowserExecutable } = require('./browser-helper');
const { cleanupStaleSessionLocks } = require('./wa-session-utils');
const { TranslatorRuntime } = require('./translator-runtime');
const { startBotControlServer } = require('./bot-control-server');
const { createCommandHandler } = require('./command-handler');
const { createWaClient } = require('./wa-client-factory');

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

const parseIntSafe = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
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
    WA_SKIP_CLIENT_INIT: parseBoolean(pickEnv(envVars, 'WA_SKIP_CLIENT_INIT', 'false'), false),
    WA_SESSION_CLIENT_ID: cleanEnv(pickEnv(envVars, 'WHATSAPP_SESSION_CLIENT_ID', 'wa-translate'), true),
    WA_TRANSLATE_GROUP_ID: cleanEnv(pickEnv(envVars, 'WHATSAPP_TRANSLATE_GROUP_ID', ''), true).replace(/^id=/i, ''),
    WA_TRANSLATE_INCLUDE_FROM_ME: parseBoolean(pickEnv(envVars, 'WHATSAPP_TRANSLATE_INCLUDE_FROM_ME', 'true'), true),
    BOT_HEALTH_ENABLED: parseBoolean(pickEnv(envVars, 'BOT_HEALTH_ENABLED', 'true'), true),
    BOT_HEALTH_PORT: parseIntSafe(pickEnv(envVars, 'BOT_HEALTH_PORT', '38866'), 38866),
    BOT_CONTROL_TOKEN: cleanEnv(pickEnv(envVars, 'BOT_CONTROL_TOKEN', ''), true),
    GEMINI_MODEL: cleanEnv(pickEnv(envVars, 'GEMINI_MODEL', 'gemini-2.5-flash'), true),
    GEMINI_MIN_INTERVAL_MS: parseIntSafe(pickEnv(envVars, 'GEMINI_MIN_INTERVAL_MS', '12000'), 12000),
    GEMINI_TIMEOUT_MS: parseIntSafe(pickEnv(envVars, 'GEMINI_TIMEOUT_MS', '45000'), 45000),
    GEMINI_MAX_RETRIES_PER_KEY: parseIntSafe(pickEnv(envVars, 'GEMINI_MAX_RETRIES_PER_KEY', '1'), 1),
    TRANSLATE_QUEUE_MAX_SIZE: parseIntSafe(pickEnv(envVars, 'TRANSLATE_QUEUE_MAX_SIZE', '100'), 100),
    API_KEYS: loadApiKeys(),
    PAIRS: parsePairs(pickEnv(envVars, 'TRANSLATE_PAIRS', 'zh-tw:vi,vi:zh-tw')),
    DEFAULT_PAIR: cleanEnv(pickEnv(envVars, 'DEFAULT_PAIR', 'zh-tw:vi'), true).toLowerCase()
  };

  process.env.GEMINI_API_KEYS_FILE = prevApiKeysFile;
  return config;
}

function validateConfig(config) {
  if (config.WA_SKIP_CLIENT_INIT) {
    return { ok: true };
  }
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
const translatorRuntime = new TranslatorRuntime(CONFIG);
let waClient = null;
let healthServer = null;
let browserInfo = null;
let waPausedByWizard = false;
let waStarting = false;
const BOT_MESSAGE_MARKER = '\u2063\u2063';

function applyRuntimeConfig(config, { keepCurrentPair = true } = {}) {
  CONFIG = config;
  pairMap = new Map(CONFIG.PAIRS.map((p) => [p.key, p]));
  const fallbackPair = pairMap.get(CONFIG.DEFAULT_PAIR) || CONFIG.PAIRS[0];
  if (!keepCurrentPair || !currentPair || !pairMap.has(currentPair.key)) {
    currentPair = fallbackPair;
  }
  translatorRuntime.applyConfig(CONFIG);
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

async function resolveChatId(msg) {
  try {
    const chat = await msg.getChat();
    if (chat && chat.id && chat.id._serialized) return chat.id._serialized;
  } catch (_) {
    // ignore
  }
  return msg.from || '';
}

const handleCommand = createCommandHandler({
  getConfig: () => CONFIG,
  getPairMap: () => pairMap,
  getCurrentPair: () => currentPair,
  setCurrentPair: (pair) => { currentPair = pair; },
  resolveChatId,
  sendMessage: async (chatId, message) => {
    if (!waClient) throw new Error('WhatsApp client 尚未啟動');
    await waClient.sendMessage(chatId, message);
  }
});

async function bootstrap() {
  async function stopWaClient() {
    if (!waClient) return;
    const client = waClient;
    waClient = null;
    await client.destroy().catch(() => {});
  }

  async function startWaClient() {
    if (CONFIG.WA_SKIP_CLIENT_INIT) {
      console.log('WA_SKIP_CLIENT_INIT=true，略過 WhatsApp 初始化（CI 模式）。');
      return { ok: true };
    }
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

      waClient = createWaClient({
        browser: browserInfo,
        getConfig: () => CONFIG,
        getCurrentPair: () => currentPair,
        resolveChatId,
        handleCommand,
        detectPairByText,
        translatorRuntime,
        botMessageMarker: BOT_MESSAGE_MARKER
      });
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
  healthServer = startBotControlServer({
    getConfig: () => CONFIG,
    getCurrentPair: () => currentPair,
    getWaReady: () => Boolean(waClient && waClient.info),
    getWaPaused: () => waPausedByWizard,
    setWaPaused: (paused) => { waPausedByWizard = Boolean(paused); },
    startWaClient,
    stopWaClient,
    buildConfig,
    validateConfig,
    applyRuntimeConfig,
    log: (level, message) => {
      if (level === 'warn') console.warn(message);
      else console.log(message);
    }
  });
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
