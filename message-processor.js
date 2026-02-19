function createMessageProcessor(deps) {
  const {
    getConfig,
    detectPairByText,
    resolveChatId,
    handleCommand,
    translatorRuntime,
    botMessageMarker,
    tracker,
    log
  } = deps;

  return async function processMessage({ msg, client }) {
    const config = getConfig();
    if (tracker.markAndCheckProcessed(msg)) return;

    const chatId = await resolveChatId(msg);
    if (chatId !== config.WA_TRANSLATE_GROUP_ID) return;

    const rawBody = String(msg.body || '');
    if (rawBody.startsWith(botMessageMarker)) return;
    const body = rawBody.trim();
    if (!body) return;
    if (tracker.isLikelyBotEcho(msg, body)) return;
    if (msg.fromMe && !config.WA_TRANSLATE_INCLUDE_FROM_ME) return;

    const replyChatId = chatId || (msg.fromMe ? msg.to : msg.from);
    if (!replyChatId) return;

    const isCommand = await handleCommand(msg, body, replyChatId);
    if (isCommand) return;

    const pair = detectPairByText(body);
    const translated = await translatorRuntime.enqueueTranslate(body, pair);
    if (!translated || translated.trim() === body.trim()) return;

    tracker.markPendingBotBody(translated);
    let sent = null;
    try {
      const outboundText = `${botMessageMarker}${translated}`;
      sent = await client.sendMessage(replyChatId, outboundText);
    } finally {
      tracker.clearPendingBotBody(translated);
    }

    tracker.rememberBotMessage(sent, translated);
    log(`已翻譯 (${pair.key}) ${body.slice(0, 30)}...`);
  };
}

module.exports = {
  createMessageProcessor
};
