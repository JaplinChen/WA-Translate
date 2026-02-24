function buildHelpText(pairs) {
  const pairList = pairs.map((p) => `- ${p.key}`).join('\n');
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

async function handleCommand({
  client,
  msg,
  body,
  replyChatId,
  pairs,
  pairMap,
  currentPair,
  groupId,
  resolveChatId
}) {
  const raw = body.trim();
  if (!raw.startsWith('/')) return { handled: false, currentPair };

  if (/^\/help$/i.test(raw)) {
    await client.sendMessage(replyChatId, buildHelpText(pairs));
    return { handled: true, currentPair };
  }
  if (/^\/gid$/i.test(raw)) {
    const chatId = await resolveChatId(msg);
    await client.sendMessage(replyChatId, `chatId: ${chatId}`);
    return { handled: true, currentPair };
  }
  if (/^\/status$/i.test(raw)) {
    await client.sendMessage(
      replyChatId,
      `目前模式: ${currentPair.key}\n群組: ${groupId}\n可翻譯對數: ${pairs.length}`
    );
    return { handled: true, currentPair };
  }
  if (/^\/mode$/i.test(raw)) {
    const text = ['可用翻譯模式：', ...pairs.map((p) => `- ${p.key}`), '', `目前模式: ${currentPair.key}`].join('\n');
    await client.sendMessage(replyChatId, text);
    return { handled: true, currentPair };
  }

  const match = raw.match(/^\/mode\s+([a-zA-Z-]+:[a-zA-Z-]+)$/i);
  if (match) {
    const key = match[1].toLowerCase();
    const pair = pairMap.get(key);
    if (!pair) {
      await client.sendMessage(replyChatId, `無效模式: ${key}\n請用 /mode 查看可用清單。`);
      return { handled: true, currentPair };
    }
    await client.sendMessage(replyChatId, `已切換翻譯模式為 ${pair.key}`);
    return { handled: true, currentPair: pair };
  }

  await client.sendMessage(replyChatId, '不支援的指令，請使用 /help。');
  return { handled: true, currentPair };
}

module.exports = {
  handleCommand
};
