const WA_PUPPETEER_ARGS = [
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
];

function buildWaPuppeteerOptions(executablePath) {
  return {
    executablePath,
    headless: true,
    args: WA_PUPPETEER_ARGS
  };
}

// Pin to the WhatsApp Web build whatsapp-web.js was tested against; leaving it
// on the default (type: local) lets WA auto-update past the lib and breaks
// getChats() with minified errors.
const WA_WEB_VERSION = '2.3000.1039661369-alpha';
const WA_WEB_VERSION_CACHE = {
  type: 'remote',
  remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${WA_WEB_VERSION}.html`
};

module.exports = {
  WA_PUPPETEER_ARGS,
  buildWaPuppeteerOptions,
  WA_WEB_VERSION,
  WA_WEB_VERSION_CACHE
};
