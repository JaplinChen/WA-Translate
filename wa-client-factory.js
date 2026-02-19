const { Client: WhatsAppClient, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { BotEchoTracker } = require('./bot-echo-tracker');
const { createMessageProcessor } = require('./message-processor');

function createWaClient(deps) {
  const {
    browser,
    getConfig,
    getCurrentPair,
    resolveChatId,
    handleCommand,
    detectPairByText,
    translatorRuntime,
    botMessageMarker
  } = deps;

  const tracker = new BotEchoTracker(120 * 1000);
  const processMessage = createMessageProcessor({
    getConfig,
    detectPairByText,
    resolveChatId,
    handleCommand,
    translatorRuntime,
    botMessageMarker,
    tracker,
    log: (message) => console.log(message)
  });

  const config = getConfig();
  const client = new WhatsAppClient({
    authStrategy: new LocalAuth({ clientId: config.WA_SESSION_CLIENT_ID }),
    puppeteer: {
      executablePath: browser.executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-networking',
        '--remote-allow-origins=*',
        '--disable-breakpad',
        '--disable-crash-reporter'
      ]
    }
  });

  client.on('qr', (qr) => {
    console.log('請使用 WhatsApp 掃描 QR Code：');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    const self = client.info && client.info.wid ? client.info.wid._serialized : 'unknown';
    console.log(`WhatsApp 已就緒，登入帳號: ${self}`);
    console.log(`目標群組: ${getConfig().WA_TRANSLATE_GROUP_ID}`);
    console.log(`目前翻譯模式: ${getCurrentPair().key}`);
  });

  client.on('auth_failure', (msg) => console.error(`WhatsApp 驗證失敗: ${msg}`));
  client.on('disconnected', (reason) => console.error(`WhatsApp 已斷線: ${reason}`));

  client.on('message_create', async (msg) => {
    try {
      await processMessage({ msg, client });
    } catch (err) {
      if (err && err.code === 'QUEUE_FULL') {
        console.warn(err.message);
        return;
      }
      console.error(`翻譯失敗: ${err.message}`);
    }
  });

  return client;
}

module.exports = {
  createWaClient
};
