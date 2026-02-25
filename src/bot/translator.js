const { sleep, parseRetryDelayMs, isQuotaRateLimitError } = require('./translate-retry');

async function translateWithClients({
  text,
  pair,
  apiClients,
  apiKeyIndex,
  geminiModel,
  minIntervalMs,
  nextTranslateAt
}) {
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
  let nextKeyIndex = apiKeyIndex;
  let nextAt = nextTranslateAt;
  for (let i = 0; i < apiClients.length; i += 1) {
    const idx = (apiKeyIndex + i) % apiClients.length;
    const model = apiClients[idx].getGenerativeModel({ model: geminiModel });
    try {
      const now = Date.now();
      if (nextAt > now) await sleep(nextAt - now);
      const result = await model.generateContent(prompt);
      nextAt = Date.now() + Math.max(0, Number.isFinite(minIntervalMs) ? minIntervalMs : 12000);
      nextKeyIndex = (idx + 1) % apiClients.length;
      return { text: result.response.text().trim(), apiKeyIndex: nextKeyIndex, nextTranslateAt: nextAt };
    } catch (err) {
      if (isQuotaRateLimitError(err)) {
        const retryMs = parseRetryDelayMs(err);
        if (retryMs > 0) {
          console.warn(`Gemini 速率限制，等待 ${Math.ceil(retryMs / 1000)} 秒後重試...`);
          await sleep(retryMs);
          try {
            const result = await model.generateContent(prompt);
            nextAt = Date.now() + Math.max(0, Number.isFinite(minIntervalMs) ? minIntervalMs : 12000);
            nextKeyIndex = (idx + 1) % apiClients.length;
            return { text: result.response.text().trim(), apiKeyIndex: nextKeyIndex, nextTranslateAt: nextAt };
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

module.exports = {
  translateWithClients
};
