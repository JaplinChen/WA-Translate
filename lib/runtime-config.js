const fs = require('fs');
const dotenv = require('dotenv');
const { parsePairObjects } = require('../shared/translate-pairs');

function cleanEnv(str, allowSpaces = false) {
  if (!str) return '';
  let cleaned = String(str).replace(/[^\x20-\x7E]/g, '');
  if (!allowSpaces) cleaned = cleaned.replace(/\s/g, '');
  return cleaned.trim();
}

function parseBoolean(value, fallback = false) {
  const v = cleanEnv(value).toLowerCase();
  if (!v) return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

function normalizeLang(value) {
  return cleanEnv(value, true).toLowerCase();
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
  process.env.GEMINI_API_KEYS_FILE = pickEnv(
    envVars,
    'GEMINI_API_KEYS_FILE',
    prevApiKeysFile || '/run/secrets/gemini_api_keys'
  );

  const config = {
    WA_ENABLED: parseBoolean(pickEnv(envVars, 'WHATSAPP_ENABLED', 'true'), true),
    WA_SKIP_CLIENT_INIT: parseBoolean(pickEnv(envVars, 'WA_SKIP_CLIENT_INIT', 'false'), false),
    WA_SESSION_CLIENT_ID: cleanEnv(pickEnv(envVars, 'WHATSAPP_SESSION_CLIENT_ID', 'wa-translate'), true),
    WA_TRANSLATE_GROUP_ID: cleanEnv(pickEnv(envVars, 'WHATSAPP_TRANSLATE_GROUP_ID', ''), true).replace(/^id=/i, ''),
    WA_TRANSLATE_INCLUDE_FROM_ME: parseBoolean(pickEnv(envVars, 'WHATSAPP_TRANSLATE_INCLUDE_FROM_ME', 'true'), true),
    BOT_HEALTH_ENABLED: parseBoolean(pickEnv(envVars, 'BOT_HEALTH_ENABLED', 'true'), true),
    BOT_HEALTH_PORT: Number.parseInt(pickEnv(envVars, 'BOT_HEALTH_PORT', '38866'), 10),
    GEMINI_MODEL: cleanEnv(pickEnv(envVars, 'GEMINI_MODEL', 'gemini-2.5-flash'), true),
    GEMINI_MIN_INTERVAL_MS: Number.parseInt(pickEnv(envVars, 'GEMINI_MIN_INTERVAL_MS', '12000'), 10),
    API_KEYS: loadApiKeys(),
    PAIRS: parsePairObjects(
      pickEnv(envVars, 'TRANSLATE_PAIRS', 'zh-tw:vi,vi:zh-tw'),
      (v) => cleanEnv(v, true)
    ),
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

module.exports = {
  cleanEnv,
  normalizeLang,
  buildConfig,
  validateConfig
};
