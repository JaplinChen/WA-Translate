const { test } = require('node:test');
const assert = require('node:assert');
const { handleCommand } = require('../src/bot/translate-commands');

function makeCtx(overrides = {}) {
  const sent = [];
  const pairs = [{ key: 'zh-tw:vi' }, { key: 'zh-tw:en' }];
  return {
    sent,
    args: {
      client: { sendMessage: async (_id, text) => sent.push(text) },
      msg: {},
      replyChatId: 'g@g.us',
      pairs,
      pairMap: new Map(pairs.map((p) => [p.key, p])),
      currentPair: pairs[0],
      groupId: 'g@g.us',
      resolveChatId: async () => 'g@g.us',
      glossary: { add() {}, remove: () => true, getEntries: () => [] },
      ...overrides
    }
  };
}

test('非管理員不能切換模式 (/mode)', async () => {
  const { sent, args } = makeCtx({ isAdmin: false });
  const r = await handleCommand({ ...args, body: '/mode zh-tw:en' });
  assert.strictEqual(r.currentPair.key, 'zh-tw:vi');
  assert.match(sent.at(-1), /僅限管理員/);
});

test('管理員可以切換模式 (/mode)', async () => {
  const { args } = makeCtx({ isAdmin: true });
  const r = await handleCommand({ ...args, body: '/mode zh-tw:en' });
  assert.strictEqual(r.currentPair.key, 'zh-tw:en');
});

test('非管理員不能 /learn', async () => {
  const { sent, args } = makeCtx({ isAdmin: false });
  await handleCommand({ ...args, body: '/learn 訂單 → đơn hàng' });
  assert.match(sent.at(-1), /僅限管理員/);
});

test('唯讀指令不受限 (/status)', async () => {
  const { sent, args } = makeCtx({ isAdmin: false });
  await handleCommand({ ...args, body: '/status' });
  assert.match(sent.at(-1), /目前模式/);
});
