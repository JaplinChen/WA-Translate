const dotenv = require('dotenv');
dotenv.config();

const http = require('http');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const qrcode = require('qrcode-terminal');
const { ensureBrowserExecutable } = require('./browser-helper');
const { cleanupStaleSessionLocks } = require('./wa-session-utils');
const { buildConfig, validateConfig, normalizeLang } = require('./lib/runtime-config');
const { createWaClient } = require('./lib/wa-client-factory');
const { EchoGuard } = require('./lib/echo-guard');
const { handleCommand } = require('./lib/translate-commands');
const { translateWithClients } = require('./lib/translator');
let CONFIG = buildConfig();
const initialCheck = validateConfig(CONFIG);
if (!initialCheck.ok) {
  (initialCheck.exitCode === 0 ? console.log : console.error)(initialCheck.error);
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
const BOT_ECHO_TTL_MS = 120 * 1000, BOT_MESSAGE_MARKER = '\u2063\u2063';
const echoGuard = new EchoGuard(BOT_ECHO_TTL_MS);
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
function enqueueTranslateTask(taskFn) {
  const run = translateQueue.then(taskFn, taskFn);
  translateQueue = run.catch(() => {});
  return run;
}

async function translateText(text, pair) {
  const result = await translateWithClients({
    text,
    pair,
    apiClients,
    apiKeyIndex,
    geminiModel: CONFIG.GEMINI_MODEL,
    minIntervalMs: CONFIG.GEMINI_MIN_INTERVAL_MS,
    nextTranslateAt
  });
  apiKeyIndex = result.apiKeyIndex;
  nextTranslateAt = result.nextTranslateAt;
  return result.text;
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
async function bootstrap() {
  async function stopWaClient() {
    if (!waClient) return;
    const client = waClient;
    waClient = null;
    await client.destroy().catch(() => {});
  }

  function buildWaClient(browser) {
    let clientRef = null;
    const client = createWaClient({
      sessionClientId: CONFIG.WA_SESSION_CLIENT_ID,
      browserExecutablePath: browser.executablePath,
      onQr: (qr) => {
        console.log('請使用 WhatsApp 掃描 QR Code：');
        qrcode.generate(qr, { small: true });
      },
      onReady: () => {
        const self = client.info && client.info.wid ? client.info.wid._serialized : 'unknown';
        console.log(`WhatsApp 已就緒，登入帳號: ${self}`);
        console.log(`目標群組: ${CONFIG.WA_TRANSLATE_GROUP_ID}`);
        console.log(`目前翻譯模式: ${currentPair.key}`);
      },
      onAuthFailure: (msg) => console.error(`WhatsApp 驗證失敗: ${msg}`),
      onDisconnected: (reason) => console.error(`WhatsApp 已斷線: ${reason}`),
      onMessageCreate: async (msg) => {
        try {
          if (echoGuard.markAndCheckProcessed(msg)) return;

          const chatId = await resolveChatId(msg);
          if (chatId !== CONFIG.WA_TRANSLATE_GROUP_ID) return;

          const rawBody = String(msg.body || '');
          if (rawBody.startsWith(BOT_MESSAGE_MARKER)) return;
          const body = rawBody.trim();
          if (!body) return;
          if (echoGuard.isLikelyBotEcho(msg, body)) return;
          if (msg.fromMe && !CONFIG.WA_TRANSLATE_INCLUDE_FROM_ME) return;

          const replyChatId = chatId || (msg.fromMe ? msg.to : msg.from);
          if (!replyChatId) return;

          const commandResult = await handleCommand({
            client,
            msg,
            body,
            replyChatId,
            pairs: CONFIG.PAIRS,
            pairMap,
            currentPair,
            groupId: CONFIG.WA_TRANSLATE_GROUP_ID,
            resolveChatId
          });
          if (commandResult.handled) {
            currentPair = commandResult.currentPair;
            return;
          }

          const pair = detectPairByText(body);
          await enqueueTranslateTask(async () => {
            const translated = await translateText(body, pair);
            if (!translated || translated.trim() === body.trim()) return;
            echoGuard.markPendingBotBody(translated);
            let sent = null;
            try {
              const outboundText = `${BOT_MESSAGE_MARKER}${translated}`;
              sent = await clientRef.sendMessage(replyChatId, outboundText);
            } finally {
              echoGuard.clearPendingBotBody(translated);
            }
            echoGuard.rememberBotMessage(sent, translated);
            console.log(`已翻譯 (${pair.key}) ${body.slice(0, 30)}...`);
          });
        } catch (err) {
          console.error(`翻譯失敗: ${err.message}`);
        }
      }
    });
    clientRef = client;
    return client;
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

      waClient = buildWaClient(browserInfo);
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
