const { Client: WhatsAppClient, LocalAuth } = require('whatsapp-web.js');
const { buildWaPuppeteerOptions } = require('../shared/wa-puppeteer');

function createWaClient({
  sessionClientId,
  browserExecutablePath,
  onQr,
  onReady,
  onAuthFailure,
  onDisconnected,
  onMessageCreate
}) {
  const client = new WhatsAppClient({
    authStrategy: new LocalAuth({ clientId: sessionClientId }),
    puppeteer: buildWaPuppeteerOptions(browserExecutablePath)
  });

  if (typeof onQr === 'function') client.on('qr', onQr);
  if (typeof onReady === 'function') client.on('ready', onReady);
  if (typeof onAuthFailure === 'function') client.on('auth_failure', onAuthFailure);
  if (typeof onDisconnected === 'function') client.on('disconnected', onDisconnected);
  if (typeof onMessageCreate === 'function') client.on('message_create', onMessageCreate);

  return client;
}

module.exports = {
  createWaClient
};
