function buildHelpText(pairs) {
  const pairList = pairs.map((p) => `- ${p.key}`).join('\n');
  return [
    '可用指令：',
    '/help 顯示說明',
    '/gid 顯示目前群組 ID',
    '/status 查看目前翻譯模式',
    '/mode 列出可用模式',
    '/mode <source:target> 切換翻譯模式（例如 /mode zh-tw:vi）',
    '/learn <原文> → <翻譯> 新增術語對照',
    '/forget <原文> 移除術語對照',
    '/glossary 列出目前模式的術語表',
    '',
    '可用模式：',
    pairList
  ].join('\n');
}

function parseLearnArgs(body) {
  const inner = body.replace(/^\/learn\s*/i, '');
  const sep = inner.indexOf('→') !== -1 ? '→' : '->';
  const idx = inner.indexOf(sep);
  if (idx === -1) return null;
  const source = inner.slice(0, idx).trim();
  const target = inner.slice(idx + sep.length).trim();
  if (!source || !target) return null;
  return { source, target };
}

const ADMIN_ONLY = '此指令僅限管理員使用。';

async function handleCommand({
  client,
  msg,
  body,
  replyChatId,
  isAdmin = true,
  botMessageMarker = '',
  pairs,
  pairMap,
  currentPair,
  groupId,
  resolveChatId,
  glossary
}) {
  // 指令回覆需帶 marker，否則 fromMe 回聲會被機器人重新翻譯
  const send = (text) => client.sendMessage(replyChatId, `${botMessageMarker}${text}`);
  const raw = body.trim();
  if (!raw.startsWith('/')) return { handled: false, currentPair };

  if (/^\/help$/i.test(raw)) {
    await send(buildHelpText(pairs));
    return { handled: true, currentPair };
  }
  if (/^\/gid$/i.test(raw)) {
    const chatId = await resolveChatId(msg);
    await send(`chatId: ${chatId}`);
    return { handled: true, currentPair };
  }
  if (/^\/status$/i.test(raw)) {
    await send(`目前模式: ${currentPair.key}\n群組: ${groupId}\n可翻譯對數: ${pairs.length}`);
    return { handled: true, currentPair };
  }
  if (/^\/mode$/i.test(raw)) {
    const text = ['可用翻譯模式：', ...pairs.map((p) => `- ${p.key}`), '', `目前模式: ${currentPair.key}`].join('\n');
    await send(text);
    return { handled: true, currentPair };
  }

  const match = raw.match(/^\/mode\s+([a-zA-Z-]+:[a-zA-Z-]+)$/i);
  if (match) {
    if (!isAdmin) {
      await send(ADMIN_ONLY);
      return { handled: true, currentPair };
    }
    const key = match[1].toLowerCase();
    const pair = pairMap.get(key);
    if (!pair) {
      await send(`無效模式: ${key}\n請用 /mode 查看可用清單。`);
      return { handled: true, currentPair };
    }
    await send(`已切換翻譯模式為 ${pair.key}`);
    return { handled: true, currentPair: pair };
  }

  if (/^\/glossary$/i.test(raw)) {
    if (!glossary) {
      await send('術語表功能未啟用。');
      return { handled: true, currentPair };
    }
    const entries = glossary.getEntries(currentPair.key);
    const text = entries.length === 0
      ? `[${currentPair.key}] 術語表目前為空。`
      : [`[${currentPair.key}] 術語表：`, ...entries.map(([s, t]) => `- ${s} → ${t}`)].join('\n');
    await send(text);
    return { handled: true, currentPair };
  }

  if (/^\/learn\s+/i.test(raw)) {
    if (!isAdmin) {
      await send(ADMIN_ONLY);
      return { handled: true, currentPair };
    }
    if (!glossary) {
      await send('術語表功能未啟用。');
      return { handled: true, currentPair };
    }
    const args = parseLearnArgs(raw);
    if (!args) {
      await send('格式錯誤，請用：/learn 原文 → 翻譯');
      return { handled: true, currentPair };
    }
    glossary.add(currentPair.key, args.source, args.target);
    await send(`已學習 [${currentPair.key}]：${args.source} → ${args.target}`);
    return { handled: true, currentPair };
  }

  if (/^\/forget\s+/i.test(raw)) {
    if (!isAdmin) {
      await send(ADMIN_ONLY);
      return { handled: true, currentPair };
    }
    if (!glossary) {
      await send('術語表功能未啟用。');
      return { handled: true, currentPair };
    }
    const source = raw.replace(/^\/forget\s*/i, '').trim();
    const removed = glossary.remove(currentPair.key, source);
    const text = removed ? `已移除 [${currentPair.key}]：${source}` : `找不到術語：${source}`;
    await send(text);
    return { handled: true, currentPair };
  }

  await send('不支援的指令，請使用 /help。');
  return { handled: true, currentPair };
}

module.exports = {
  handleCommand
};
