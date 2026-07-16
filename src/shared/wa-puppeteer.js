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

// Optional WhatsApp Web version pin. Default (empty) uses the library's built-in
// version, which matches live WhatsApp Web and completes fresh logins. Pin only
// when a WA auto-update breaks getChats() with minified errors — set WA_WEB_VERSION
// to a snapshot from github.com/wppconnect-team/wa-version.
// ponytail: env knob, not hardcoded — the right version is field-tuned, not fixed.
function waVersionOptions() {
  const version = String(process.env.WA_WEB_VERSION || '').trim();
  if (!version) return {};
  return {
    webVersion: version,
    webVersionCache: {
      type: 'remote',
      remotePath: `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/${version}.html`
    }
  };
}

module.exports = {
  WA_PUPPETEER_ARGS,
  buildWaPuppeteerOptions,
  waVersionOptions
};
