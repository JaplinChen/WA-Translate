const fs = require('fs');
const { parsePairKeys } = require('../../shared/translate-pairs');

const { ENV_PATH } = require('./constants');

function sanitizeValue(value) {
  return String(value || '').replace(/[\r\n]/g, '').trim();
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function upsertEnv(content, updates) {
  let next = content;

  for (const [key, rawValue] of Object.entries(updates)) {
    const value = sanitizeValue(rawValue);
    const re = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm');

    if (re.test(next)) {
      next = next.replace(re, `${key}=${value}`);
      continue;
    }

    const suffix = next.endsWith('\n') || next.length === 0 ? '' : '\n';
    next += `${suffix}${key}=${value}\n`;
  }

  return next;
}

function readEnvValue(key, raw) {
  const re = new RegExp(`^${escapeRegExp(key)}=(.*)$`, 'm');
  const match = raw.match(re);
  return match ? match[1].trim() : '';
}

function parsePairs(raw) {
  return parsePairKeys(raw, sanitizeValue);
}

function maskGeminiKeys(raw) {
  const keys = String(raw || '')
    .split(',')
    .map((value) => sanitizeValue(value))
    .filter(Boolean);
  if (keys.length === 0) return '';
  return keys
    .map((value) => {
      if (value.length <= 6) return `${value.slice(0, 1)}***`;
      return `${value.slice(0, 3)}***${value.slice(-2)}`;
    })
    .join(',');
}

function loadConfig() {
  const raw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const geminiRaw = readEnvValue('GEMINI_API_KEYS', raw);

  return {
    GEMINI_API_KEYS: '',
    GEMINI_API_KEYS_CONFIGURED: Boolean(geminiRaw),
    GEMINI_API_KEYS_MASKED: maskGeminiKeys(geminiRaw),
    WHATSAPP_ADMIN_ID: readEnvValue('WHATSAPP_ADMIN_ID', raw),
    WHATSAPP_TRANSLATE_GROUP_ID: readEnvValue('WHATSAPP_TRANSLATE_GROUP_ID', raw),
    TRANSLATE_PAIRS: readEnvValue('TRANSLATE_PAIRS', raw) || 'zh-tw:vi,vi:zh-tw',
    DEFAULT_PAIR: readEnvValue('DEFAULT_PAIR', raw) || 'zh-tw:vi',
    WHATSAPP_TRANSLATE_INCLUDE_FROM_ME: readEnvValue('WHATSAPP_TRANSLATE_INCLUDE_FROM_ME', raw) || 'true',
    WHATSAPP_SESSION_CLIENT_ID: readEnvValue('WHATSAPP_SESSION_CLIENT_ID', raw) || 'wa-translate'
  };
}

function saveConfig(input) {
  const pairs = parsePairs(input.TRANSLATE_PAIRS || '').join(',');
  if (!pairs) throw new Error('TRANSLATE_PAIRS 至少要有一組 source:target');
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const existingGemini = readEnvValue('GEMINI_API_KEYS', existing);
  const incomingGemini = sanitizeValue(input.GEMINI_API_KEYS || '');
  const clearGemini = sanitizeValue(input.CLEAR_GEMINI_API_KEYS || '').toLowerCase() === 'true';
  const nextGemini = clearGemini ? '' : (incomingGemini || existingGemini);

  const updates = {
    GEMINI_API_KEYS: nextGemini,
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_ADMIN_ID: input.WHATSAPP_ADMIN_ID || '',
    WHATSAPP_TRANSLATE_GROUP_ID: input.WHATSAPP_TRANSLATE_GROUP_ID || '',
    WHATSAPP_TRANSLATE_INCLUDE_FROM_ME: input.WHATSAPP_TRANSLATE_INCLUDE_FROM_ME === 'false' ? 'false' : 'true',
    WHATSAPP_SESSION_CLIENT_ID: input.WHATSAPP_SESSION_CLIENT_ID || 'wa-translate',
    TRANSLATE_PAIRS: pairs,
    DEFAULT_PAIR: sanitizeValue(input.DEFAULT_PAIR || 'zh-tw:vi').toLowerCase()
  };

  const pairSet = new Set(parsePairs(updates.TRANSLATE_PAIRS));
  if (!pairSet.has(updates.DEFAULT_PAIR)) {
    throw new Error('DEFAULT_PAIR 必須存在於 TRANSLATE_PAIRS');
  }

  const merged = upsertEnv(existing, updates);
  fs.writeFileSync(ENV_PATH, merged, 'utf8');
}

module.exports = {
  parsePairs,
  loadConfig,
  saveConfig
};
