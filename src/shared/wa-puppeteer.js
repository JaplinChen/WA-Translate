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

module.exports = {
  WA_PUPPETEER_ARGS,
  buildWaPuppeteerOptions
};
