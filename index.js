const dotenv = require('dotenv');
dotenv.config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const qrcode = require('qrcode-terminal');
const { ensureBrowserExecutable } = require('./browser-helper');
const { cleanupStaleSessionLocks } = require('./wa-session-utils');
const { buildConfig, validateConfig, normalizeLang } = require('./lib/runtime-config');
const { createWaClient } = require('./lib/wa-client-factory');
const { EchoGuard } = require('./lib/echo-guard');
const { translateWithClients } = require('./lib/translator');
const { createHealthServer } = require('./lib/health-server');
const { createMessageProcessor } = require('./lib/message-processor');

class AppRuntime {
  constructor() {
    this.config = buildConfig();
    const initialCheck = validateConfig(this.config);
    if (!initialCheck.ok) {
      (initialCheck.exitCode === 0 ? console.log : console.error)(initialCheck.error);
      process.exit(initialCheck.exitCode);
    }
    
    this.applyConfigState(this.config);
    this.waClient = null;
    this.healthServer = null;
    this.browserInfo = null;
    this.waPausedByWizard = false;
    this.waStarting = false;
    
    this.translateQueue = Promise.resolve();
    this.translateQueueDepth = 0;
    this.nextTranslateAt = 0;
    
    const BOT_ECHO_TTL_MS = 120 * 1000;
    this.BOT_MESSAGE_MARKER = '\u2063\u2063';
    this.echoGuard = new EchoGuard(BOT_ECHO_TTL_MS);
    this.clientRefHolder = { current: null };
  }

  applyConfigState(config, keepCurrentPair = true) {
    const oldKeys = this.config && this.config.API_KEYS ? this.config.API_KEYS.join(',') : '';
    const newKeys = config && config.API_KEYS ? config.API_KEYS.join(',') : '';

    this.config = config;
    this.pairMap = new Map(this.config.PAIRS.map((p) => [p.key, p]));
    const fallbackPair = this.pairMap.get(this.config.DEFAULT_PAIR) || this.config.PAIRS[0];
    
    if (!keepCurrentPair || !this.currentPair || !this.pairMap.has(this.currentPair.key)) {
      this.currentPair = fallbackPair;
    }
    
    if (oldKeys !== newKeys || !this.apiClients) {
      this.apiClients = this.config.API_KEYS.map((key) => new GoogleGenerativeAI(key));
      this.apiKeyIndex = 0;
    }
  }

  isChineseText(text) { return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(text); }
  isVietnameseText(text) { return /[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(text); }
  langPrefix(lang) { return normalizeLang(lang).split('-')[0]; }

  findPairBySource(sourceLang) {
    const sourcePrefix = this.langPrefix(sourceLang);
    return this.config.PAIRS.find((p) => this.langPrefix(p.source) === sourcePrefix) || null;
  }

  detectPairByText(text) {
    if (this.isChineseText(text)) return this.findPairBySource('zh') || this.currentPair;
    if (this.isVietnameseText(text)) return this.findPairBySource('vi') || this.currentPair;
    return this.currentPair;
  }

  enqueueTranslateTask(taskFn) {
    this.translateQueueDepth++;
    const run = this.translateQueue.then(taskFn, taskFn);
    
    const settled = run.finally(() => {
      this.translateQueueDepth = Math.max(0, this.translateQueueDepth - 1);
    });
    
    this.translateQueue = settled.catch(err => {
      console.error(`[Queue] 非同步任務發生錯誤: ${err.message}`);
    });
    return run;
  }

  async translateText(text, pair) {
    const result = await translateWithClients({
      text,
      pair,
      apiClients: this.apiClients,
      apiKeyIndex: this.apiKeyIndex,
      geminiModel: this.config.GEMINI_MODEL,
      minIntervalMs: this.config.GEMINI_MIN_INTERVAL_MS,
      nextTranslateAt: this.nextTranslateAt
    });
    this.apiKeyIndex = result.apiKeyIndex;
    this.nextTranslateAt = result.nextTranslateAt;
    return result.text;
  }

  async resolveChatId(msg) {
    try {
      const chat = await msg.getChat();
      if (chat && chat.id && chat.id._serialized) return chat.id._serialized;
    } catch (_) { /* ignore */ }
    return msg.from || '';
  }

  async stopWaClient() {
    if (!this.waClient) return;
    const client = this.waClient;
    this.waClient = null;
    this.clientRefHolder.current = null;
    await client.destroy().catch(err => console.error(`停止 WhatsApp 連線失敗: ${err.message}`));
  }

  buildWaClient(browser) {
    const processMessage = createMessageProcessor({
      getConfig: () => this.config,
      getPairMap: () => this.pairMap,
      getCurrentPair: () => this.currentPair,
      setCurrentPair: (p) => { this.currentPair = p; },
      detectPairByText: this.detectPairByText.bind(this),
      enqueueTranslateTask: this.enqueueTranslateTask.bind(this),
      translateText: this.translateText.bind(this),
      resolveChatId: this.resolveChatId.bind(this),
      echoGuard: this.echoGuard,
      botMessageMarker: this.BOT_MESSAGE_MARKER,
      clientRefHolder: this.clientRefHolder
    });

    const client = createWaClient({
      sessionClientId: this.config.WA_SESSION_CLIENT_ID,
      browserExecutablePath: browser.executablePath,
      onQr: (qr) => {
        console.log('請使用 WhatsApp 掃描 QR Code：');
        qrcode.generate(qr, { small: true });
      },
      onReady: () => {
        const self = client.info && client.info.wid ? client.info.wid._serialized : 'unknown';
        console.log(`WhatsApp 已就緒，登入帳號: ${self}`);
        console.log(`目標群組: ${this.config.WA_TRANSLATE_GROUP_ID}`);
        console.log(`目前翻譯模式: ${this.currentPair.key}`);
      },
      onAuthFailure: (msg) => console.error(`WhatsApp 驗證失敗: ${msg}`),
      onDisconnected: (reason) => console.error(`WhatsApp 已斷線: ${reason}`),
      onMessageCreate: processMessage
    });
    
    this.clientRefHolder.current = client;
    return client;
  }

  async startWaClient() {
    if (this.config.WA_SKIP_CLIENT_INIT) {
      console.log('WA_SKIP_CLIENT_INIT=true，略過 WhatsApp 初始化（CI 模式）。');
      return { ok: true };
    }
    if (this.waClient || this.waStarting) return { ok: true };
    this.waStarting = true;
    try {
      if (!this.browserInfo) {
        const browser = await ensureBrowserExecutable({ preferLocal: true, log: console.log });
        if (!browser.ok) {
          return { ok: false, error: browser.error || '找不到可用瀏覽器。' };
        }
        this.browserInfo = browser;
        console.log(`使用瀏覽器：${this.browserInfo.executablePath} (${this.browserInfo.source})`);
      }

      const removedLocks = cleanupStaleSessionLocks(this.config.WA_SESSION_CLIENT_ID);
      if (removedLocks > 0) console.log(`已清理舊 session 鎖檔: ${removedLocks} 個`);

      this.waClient = this.buildWaClient(this.browserInfo);
      this.waClient.initialize().catch((err) => {
        console.error(`WhatsApp 初始化失敗: ${err.message}`);
        if (!this.waPausedByWizard) process.exit(1);
      });
      return { ok: true };
    } finally {
      this.waStarting = false;
    }
  }

  async bootstrap() {
    const startResult = await this.startWaClient();
    if (!startResult.ok) {
      console.error(startResult.error);
      process.exit(1);
    }

    if (this.config.BOT_HEALTH_ENABLED && Number.isFinite(this.config.BOT_HEALTH_PORT)) {
      this.healthServer = createHealthServer({
        getConfig: () => this.config,
        applyConfig: (c, opts) => this.applyConfigState(c, opts?.keepCurrentPair),
        getCurrentPair: () => this.currentPair,
        getWaClient: () => this.waClient,
        getWaPaused: () => this.waPausedByWizard,
        setWaPaused: (p) => { this.waPausedByWizard = p; },
        stopWaClient: this.stopWaClient.bind(this),
        startWaClient: this.startWaClient.bind(this)
      });
      
      this.healthServer.listen(this.config.BOT_HEALTH_PORT, '0.0.0.0', () => {
        console.log(`健康檢查端點：http://0.0.0.0:${this.config.BOT_HEALTH_PORT}/healthz`);
      });
    }
  }

  async shutdown() {
    console.log('\n開始優雅停機 (Graceful Shutdown)...');
    
    if (this.healthServer) {
      this.healthServer.close(() => console.log('HTTP 健康檢查伺服器已關閉'));
    }

    if (this.translateQueueDepth > 0) {
      console.log(`等待 ${this.translateQueueDepth} 個翻譯任務完成...`);
      try {
        await Promise.race([
          this.translateQueue,
          new Promise(resolve => setTimeout(resolve, 5000))
        ]);
        console.log('翻譯佇列已清空。');
      } catch (err) {
        console.error('等待翻譯佇列時發生錯誤:', err.message);
      }
    }

    if (this.waClient) {
      console.log('正在關閉 WhatsApp 連線...');
      await this.waClient.destroy().catch(err => console.error('關閉連線失敗:', err.message));
      console.log('WhatsApp 連線已關閉。');
    }
    
    console.log('停機完成，退出程序。');
    process.exit(0);
  }
}

const app = new AppRuntime();

process.on('SIGINT', () => app.shutdown());
process.on('SIGTERM', () => app.shutdown());

app.bootstrap().catch((err) => {
  console.error(`啟動失敗: ${err.message}`);
  process.exit(1);
});