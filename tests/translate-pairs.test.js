const test = require('node:test');
const assert = require('node:assert/strict');

const { parsePairKeys, parsePairObjects } = require('../src/shared/translate-pairs');

test('parsePairKeys 會去重並標準化大小寫', () => {
  const result = parsePairKeys('ZH-TW:VI,vi:zh-tw,zh-tw:vi,en:zh-tw');
  assert.deepEqual(result, ['zh-tw:vi', 'vi:zh-tw', 'en:zh-tw']);
});

test('parsePairKeys 忽略格式錯誤的 token', () => {
  const result = parsePairKeys('invalid,zh-tw:vi:extra,ja:');
  assert.deepEqual(result, []);
});

test('parsePairObjects 回傳 source/target/key 結構', () => {
  const result = parsePairObjects('zh-tw:vi,en:zh-tw');
  assert.deepEqual(result, [
    { source: 'zh-tw', target: 'vi', key: 'zh-tw:vi' },
    { source: 'en', target: 'zh-tw', key: 'en:zh-tw' }
  ]);
});
