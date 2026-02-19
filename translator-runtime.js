const { GoogleGenerativeAI } = require('@google/generative-ai');
const { AsyncTaskQueue } = require('./async-task-queue');

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

function isTransientGeminiError(err) {
  const msg = String((err && err.message) || '');
  if (err && err.code === 'ETIMEDOUT') return true;
  return (
    /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|ETIMEDOUT/i.test(msg)
    || /5\d{2}/.test(msg)
    || /timeout/i.test(msg)
    || /network/i.test(msg)
    || /temporar/i.test(msg)
  );
}

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return Promise.race([
    promise,
    sleep(timeoutMs).then(() => {
      const timeoutErr = new Error(`Gemini 請求逾時（>${timeoutMs}ms）`);
      timeoutErr.code = 'ETIMEDOUT';
      throw timeoutErr;
    })
  ]);
}

class TranslatorRuntime {
  constructor(config) {
    this.apiClients = [];
    this.apiKeyIndex = 0;
    this.nextTranslateAt = 0;
    this.config = config;
    this.queue = new AsyncTaskQueue(100);
    this.applyConfig(config);
  }

  applyConfig(config) {
    this.config = config;
    this.apiClients = config.API_KEYS.map((key) => new GoogleGenerativeAI(key));
    this.apiKeyIndex = 0;
    this.queue.setMaxSize(Number.isFinite(config.TRANSLATE_QUEUE_MAX_SIZE) ? config.TRANSLATE_QUEUE_MAX_SIZE : 100);
  }

  enqueueTranslate(text, pair) {
    return this.queue.enqueue(() => this.translateText(text, pair));
  }

  async translateText(text, pair) {
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
    const maxRetries = Number.isFinite(this.config.GEMINI_MAX_RETRIES_PER_KEY)
      ? Math.max(0, this.config.GEMINI_MAX_RETRIES_PER_KEY)
      : 1;
    const timeoutMs = Number.isFinite(this.config.GEMINI_TIMEOUT_MS)
      ? Math.max(1000, this.config.GEMINI_TIMEOUT_MS)
      : 45000;

    for (let i = 0; i < this.apiClients.length; i += 1) {
      const idx = (this.apiKeyIndex + i) % this.apiClients.length;
      const model = this.apiClients[idx].getGenerativeModel({ model: this.config.GEMINI_MODEL });
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          const now = Date.now();
          if (this.nextTranslateAt > now) {
            await sleep(this.nextTranslateAt - now);
          }
          const result = await withTimeout(model.generateContent(prompt), timeoutMs);
          const minInterval = Number.isFinite(this.config.GEMINI_MIN_INTERVAL_MS) ? this.config.GEMINI_MIN_INTERVAL_MS : 12000;
          this.nextTranslateAt = Date.now() + Math.max(0, minInterval);
          this.apiKeyIndex = (idx + 1) % this.apiClients.length;
          return result.response.text().trim();
        } catch (err) {
          lastError = err;
          const hasMoreAttempt = attempt < maxRetries;
          if (!hasMoreAttempt) break;

          let waitMs = 0;
          if (isQuotaRateLimitError(err)) {
            waitMs = parseRetryDelayMs(err) || (1000 * (attempt + 1));
          } else if (isTransientGeminiError(err)) {
            waitMs = 1000 * (attempt + 1);
          } else {
            break;
          }
          console.warn(`Gemini 請求失敗，${Math.ceil(waitMs / 1000)} 秒後重試（key ${idx + 1}/${this.apiClients.length}，attempt ${attempt + 1}/${maxRetries + 1}）...`);
          await sleep(waitMs);
        }
      }
    }

    throw lastError || new Error('翻譯失敗');
  }
}

module.exports = {
  TranslatorRuntime
};
