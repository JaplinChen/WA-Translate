function createCommandHandler(deps) {
  const {
    getConfig,
    getPairMap,
    getCurrentPair,
    setCurrentPair,
    resolveChatId,
    sendMessage
  } = deps;

  function helpText() {
    const config = getConfig();
    const pairList = config.PAIRS.map((p) => `- ${p.key}`).join('\n');
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

  return async function handleCommand(msg, body, replyChatId) {
    const raw = body.trim();
    if (!raw.startsWith('/')) return false;

    if (/^\/help$/i.test(raw)) {
      await sendMessage(replyChatId, helpText());
      return true;
    }
    if (/^\/gid$/i.test(raw)) {
      const chatId = await resolveChatId(msg);
      await sendMessage(replyChatId, `chatId: ${chatId}`);
      return true;
    }
    if (/^\/status$/i.test(raw)) {
      const config = getConfig();
      await sendMessage(
        replyChatId,
        `目前模式: ${getCurrentPair().key}\n群組: ${config.WA_TRANSLATE_GROUP_ID}\n可翻譯對數: ${config.PAIRS.length}`
      );
      return true;
    }
    if (/^\/mode$/i.test(raw)) {
      const config = getConfig();
      const text = ['可用翻譯模式：', ...config.PAIRS.map((p) => `- ${p.key}`), '', `目前模式: ${getCurrentPair().key}`].join('\n');
      await sendMessage(replyChatId, text);
      return true;
    }

    const match = raw.match(/^\/mode\s+([a-zA-Z-]+:[a-zA-Z-]+)$/i);
    if (match) {
      const key = match[1].toLowerCase();
      const pair = getPairMap().get(key);
      if (!pair) {
        await sendMessage(replyChatId, `無效模式: ${key}\n請用 /mode 查看可用清單。`);
        return true;
      }
      setCurrentPair(pair);
      await sendMessage(replyChatId, `已切換翻譯模式為 ${getCurrentPair().key}`);
      return true;
    }

    await sendMessage(replyChatId, '不支援的指令，請使用 /help。');
    return true;
  };
}

module.exports = {
  createCommandHandler
};
