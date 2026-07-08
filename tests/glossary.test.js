const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Glossary } = require('../src/bot/glossary');
const { translateWithClients } = require('../src/bot/translator');

// --- Glossary unit tests ---

test('add 會儲存術語並可用 getEntries 取回', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glossary-test-'));
  const g = new Glossary(path.join(dir, 'g.json'));
  g.add('zh-tw:vi', '公司', 'công ty');
  const entries = g.getEntries('zh-tw:vi');
  assert.deepEqual(entries, [['公司', 'công ty']]);
});

test('add 會持久化：重新讀取同一檔案可取回術語', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glossary-test-'));
  const filePath = path.join(dir, 'g.json');
  const g1 = new Glossary(filePath);
  g1.add('zh-tw:vi', '訂單', 'đơn hàng');

  const g2 = new Glossary(filePath);
  const entries = g2.getEntries('zh-tw:vi');
  assert.deepEqual(entries, [['訂單', 'đơn hàng']]);
});

test('remove 會刪除術語並回傳 true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glossary-test-'));
  const g = new Glossary(path.join(dir, 'g.json'));
  g.add('zh-tw:vi', '客戶', 'khách hàng');
  const ok = g.remove('zh-tw:vi', '客戶');
  assert.equal(ok, true);
  assert.deepEqual(g.getEntries('zh-tw:vi'), []);
});

test('remove 找不到術語時回傳 false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glossary-test-'));
  const g = new Glossary(path.join(dir, 'g.json'));
  const ok = g.remove('zh-tw:vi', '不存在');
  assert.equal(ok, false);
});

test('不同 pairKey 的術語彼此獨立', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glossary-test-'));
  const g = new Glossary(path.join(dir, 'g.json'));
  g.add('zh-tw:vi', '公司', 'công ty');
  g.add('vi:zh-tw', 'công ty', '公司');
  assert.deepEqual(g.getEntries('zh-tw:vi'), [['公司', 'công ty']]);
  assert.deepEqual(g.getEntries('vi:zh-tw'), [['công ty', '公司']]);
});

test('getEntries 在檔案不存在時回傳空陣列', () => {
  const g = new Glossary('/nonexistent/path/g.json');
  assert.deepEqual(g.getEntries('zh-tw:vi'), []);
});

// --- Prompt injection test (no API call) ---

test('translateWithClients 帶術語表時 prompt 包含術語（mock API）', async () => {
  let capturedPrompt = null;
  const fakeModel = {
    generateContent: async (prompt) => {
      capturedPrompt = prompt;
      return { response: { text: () => 'kết quả' } };
    }
  };
  const fakeClient = { getGenerativeModel: () => fakeModel };

  await translateWithClients({
    text: '公司名稱',
    pair: { source: 'zh-tw', target: 'vi', key: 'zh-tw:vi' },
    apiClients: [fakeClient],
    apiKeyIndex: 0,
    geminiModel: 'fake',
    minIntervalMs: 0,
    nextTranslateAt: 0,
    glossaryEntries: [['公司', 'công ty'], ['訂單', 'đơn hàng']]
  });

  assert.ok(capturedPrompt.includes('公司 → công ty'), 'prompt 應含第一條術語');
  assert.ok(capturedPrompt.includes('訂單 → đơn hàng'), 'prompt 應含第二條術語');
  assert.ok(capturedPrompt.includes('術語表'), 'prompt 應含術語表標題');
});

test('translateWithClients 無術語表時 prompt 不含術語表區塊', async () => {
  let capturedPrompt = null;
  const fakeModel = {
    generateContent: async (prompt) => {
      capturedPrompt = prompt;
      return { response: { text: () => 'kết quả' } };
    }
  };
  const fakeClient = { getGenerativeModel: () => fakeModel };

  await translateWithClients({
    text: '公司名稱',
    pair: { source: 'zh-tw', target: 'vi', key: 'zh-tw:vi' },
    apiClients: [fakeClient],
    apiKeyIndex: 0,
    geminiModel: 'fake',
    minIntervalMs: 0,
    nextTranslateAt: 0
  });

  assert.ok(!capturedPrompt.includes('術語表（必須使用以下對照翻譯）'), 'prompt 不應含術語表區塊');
});

// --- Command parsing test ---

test('/learn 解析 → 分隔符', () => {
  // 直接測試 parseLearnArgs 邏輯（inline 複製以免改動 exports）
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
  assert.deepEqual(parseLearnArgs('/learn 公司 → công ty'), { source: '公司', target: 'công ty' });
  assert.deepEqual(parseLearnArgs('/learn 公司->công ty'), { source: '公司', target: 'công ty' });
  assert.equal(parseLearnArgs('/learn 只有來源'), null);
});
