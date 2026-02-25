const { handleCommand } = require('./translate-commands');

function createMessageProcessor({
  getConfig,
  getPairMap,
  getCurrentPair,
  setCurrentPair,
  detectPairByText,
  enqueueTranslateTask,
  translateText,
  resolveChatId,
  echoGuard,
  botMessageMarker,
  clientRefHolder
}) {
  return async function processMessage(msg) {
    try {
      const config = getConfig();
      if (echoGuard.markAndCheckProcessed(msg)) return;

      const chatId = await resolveChatId(msg);
      if (chatId !== config.WA_TRANSLATE_GROUP_ID) return;

      const rawBody = String(msg.body || '');
      if (rawBody.startsWith(botMessageMarker)) return;
      const body = rawBody.trim();
      if (!body) return;
      if (echoGuard.isLikelyBotEcho(msg, body)) return;
      if (msg.fromMe && !config.WA_TRANSLATE_INCLUDE_FROM_ME) return;

      const replyChatId = chatId || (msg.fromMe ? msg.to : msg.from);
      if (!replyChatId) return;

      const commandResult = await handleCommand({
        client: clientRefHolder.current,
        msg,
        body,
        replyChatId,
        pairs: config.PAIRS,
        pairMap: getPairMap(),
        currentPair: getCurrentPair(),
        groupId: config.WA_TRANSLATE_GROUP_ID,
        resolveChatId
      });
      if (commandResult.handled) {
        setCurrentPair(commandResult.currentPair);
        return;
      }

      const pair = detectPairByText(body);
      await enqueueTranslateTask(async () => {
        const translated = await translateText(body, pair);
        if (!translated || translated.trim() === body.trim()) return;
        echoGuard.markPendingBotBody(translated);
        let sent = null;
        try {
          const outboundText = `${botMessageMarker}${translated}`;
          sent = await clientRefHolder.current.sendMessage(replyChatId, outboundText);
        } finally {
          echoGuard.clearPendingBotBody(translated);
        }
        echoGuard.rememberBotMessage(sent, translated);
        console.log(`已翻譯 (${pair.key}) ${body.slice(0, 30)}...`);
      });
    } catch (err) {
      console.error(`處理訊息或翻譯失敗: ${err.message}`);
    }
  };
}

module.exports = { createMessageProcessor };
