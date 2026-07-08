const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const envConfigPath = path.join(projectRoot, 'src', 'wizard', 'lib', 'env-config.js');
const constantsPath = path.join(projectRoot, 'src', 'wizard', 'lib', 'constants.js');

function loadEnvConfigWithCwd(cwd) {
  const prevCwd = process.cwd();
  process.chdir(cwd);
  try {
    delete require.cache[constantsPath];
    delete require.cache[envConfigPath];
    return require(envConfigPath);
  } finally {
    process.chdir(prevCwd);
  }
}

test('parsePairs 會去重並忽略無效值', () => {
  const { parsePairs } = loadEnvConfigWithCwd(projectRoot);
  const result = parsePairs('zh-tw:vi,vi:zh-tw,invalid,zh-tw:vi,en:zh-tw');
  assert.deepEqual(result, ['zh-tw:vi', 'vi:zh-tw', 'en:zh-tw']);
});

test('saveConfig 會寫入合法設定並保留既有 Gemini key', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-env-test-'));
  const prevCwd = process.cwd();
  try {
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      'GEMINI_API_KEYS=existing_key\nTRANSLATE_PAIRS=zh-tw:vi\nDEFAULT_PAIR=zh-tw:vi\n',
      'utf8'
    );

    process.chdir(tempDir);
    const { saveConfig } = loadEnvConfigWithCwd(tempDir);
    saveConfig({
      GEMINI_API_KEYS: '',
      WHATSAPP_ADMIN_ID: '123@c.us',
      WHATSAPP_TRANSLATE_GROUP_ID: 'group@g.us',
      WHATSAPP_TRANSLATE_INCLUDE_FROM_ME: 'false',
      WHATSAPP_SESSION_CLIENT_ID: 'wa-test',
      TRANSLATE_PAIRS: 'zh-tw:vi,vi:zh-tw',
      DEFAULT_PAIR: 'vi:zh-tw'
    });

    const output = fs.readFileSync(path.join(tempDir, '.env'), 'utf8');
    assert.match(output, /^GEMINI_API_KEYS=existing_key/m);
    assert.match(output, /^WHATSAPP_ADMIN_ID=123@c\.us/m);
    assert.match(output, /^WHATSAPP_TRANSLATE_GROUP_ID=group@g\.us/m);
    assert.match(output, /^WHATSAPP_TRANSLATE_INCLUDE_FROM_ME=false/m);
    assert.match(output, /^WHATSAPP_SESSION_CLIENT_ID=wa-test/m);
    assert.match(output, /^TRANSLATE_PAIRS=zh-tw:vi,vi:zh-tw/m);
    assert.match(output, /^DEFAULT_PAIR=vi:zh-tw/m);
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('saveConfig 在 DEFAULT_PAIR 不存在於 TRANSLATE_PAIRS 時拋錯', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-env-test-'));
  const prevCwd = process.cwd();
  try {
    fs.writeFileSync(path.join(tempDir, '.env'), '', 'utf8');
    process.chdir(tempDir);
    const { saveConfig } = loadEnvConfigWithCwd(tempDir);

    assert.throws(
      () => {
        saveConfig({
          TRANSLATE_PAIRS: 'zh-tw:vi',
          DEFAULT_PAIR: 'vi:zh-tw'
        });
      },
      /DEFAULT_PAIR 必須存在於 TRANSLATE_PAIRS/
    );
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
