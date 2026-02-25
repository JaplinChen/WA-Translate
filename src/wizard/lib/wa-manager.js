const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

const { ensureBrowserExecutable } = require('../../utils/browser-helper');
const { cleanupStaleSessionLocks } = require('../../utils/wa-session-utils');
const { buildWaPuppeteerOptions } = require('../../shared/wa-puppeteer');

async function qrImageUrl(text) {
  return QRCode.toDataURL(String(text || ''), {
    margin: 1,
    width: 280,
    errorCorrectionLevel: 'M'
  });
}

class WhatsAppManager {
  constructor() {
    this.sessionClientId = String(process.env.WHATSAPP_SESSION_CLIENT_ID || 'wa-translate').trim() || 'wa-translate';
    this.client = null;
    this.started = false;
    this.ready = false;
    this.status = 'idle';
    this.qrDataUrl = '';
    this.adminId = '';
    this.groups = [];
    this.error = '';
    this.sseClients = new Set();
  }

  snapshot() {
    return {
      status: this.status,
      error: this.error,
      qrDataUrl: this.qrDataUrl,
      adminId: this.adminId,
      groups: this.groups
    };
  }

  subscribe(res) {
    this.sseClients.add(res);
  }

  unsubscribe(res) {
    this.sseClients.delete(res);
  }

  broadcast(type, payload) {
    const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.sseClients) {
      res.write(data);
    }
  }

  setStatus(status, extra = {}) {
    this.status = status;
    if (Object.prototype.hasOwnProperty.call(extra, 'error')) this.error = extra.error;
    if (Object.prototype.hasOwnProperty.call(extra, 'qrDataUrl')) this.qrDataUrl = extra.qrDataUrl;
    if (Object.prototype.hasOwnProperty.call(extra, 'adminId')) this.adminId = extra.adminId;
    this.broadcast('wa', this.snapshot());
  }

  async refreshGroups() {
    if (!this.client || !this.ready) return [];

    const chats = await this.client.getChats();
    this.groups = chats
      .filter((chat) => chat.isGroup)
      .map((chat) => ({
        name: chat.name || '(未命名群組)',
        id: chat.id && chat.id._serialized ? chat.id._serialized : ''
      }))
      .filter((group) => group.id)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));

    this.setStatus('ready', { error: '', qrDataUrl: '', adminId: this.adminId });
    return this.groups;
  }

  async start() {
    if (this.started) {
      return {
        ok: true,
        alreadyStarted: true,
        status: this.status
      };
    }

    this.started = true;
    this.ready = false;
    this.setStatus('starting', { error: '', qrDataUrl: '' });

    const browser = await ensureBrowserExecutable({
      preferLocal: true,
      log: (message) => this.setStatus('starting', { error: message, qrDataUrl: '' })
    });

    if (!browser.ok) {
      this.setStatus('error', { error: browser.error || '無法取得瀏覽器，請設定 CHROME_PATH。' });
      this.started = false;
      return;
    }

    const removedLocks = cleanupStaleSessionLocks(this.sessionClientId);
    if (removedLocks > 0) {
      this.setStatus('starting', { error: `已清理舊 session 鎖檔: ${removedLocks} 個`, qrDataUrl: '' });
    }

    const waClient = new Client({
      authStrategy: new LocalAuth({ clientId: this.sessionClientId }),
      puppeteer: buildWaPuppeteerOptions(browser.executablePath)
    });

    waClient.on('qr', async (qr) => {
      try {
        const dataUrl = await qrImageUrl(qr);
        this.setStatus('waiting_qr', { qrDataUrl: dataUrl, error: '' });
      } catch (err) {
        this.setStatus('waiting_qr', { qrDataUrl: '', error: `QR 產生失敗：${err.message}` });
      }
    });

    waClient.on('authenticated', () => {
      this.setStatus('authenticated', { qrDataUrl: '', error: '' });
    });

    waClient.on('ready', async () => {
      this.ready = true;
      this.adminId = waClient.info && waClient.info.wid ? waClient.info.wid._serialized : '';
      this.setStatus('ready', { adminId: this.adminId, qrDataUrl: '', error: '' });

      try {
        await this.refreshGroups();
      } catch (err) {
        this.setStatus('ready', { error: `群組讀取失敗：${err.message}` });
      }
    });

    waClient.on('auth_failure', (message) => {
      this.setStatus('error', { error: `登入失敗：${message || '未知錯誤'}` });
    });

    waClient.on('disconnected', (reason) => {
      this.ready = false;
      this.setStatus('disconnected', { error: `已斷線：${reason || '未知原因'}` });
    });

    waClient.initialize().catch((err) => {
      this.setStatus('error', { error: `初始化失敗：${err.message}` });
    });

    this.client = waClient;
    return {
      ok: true,
      alreadyStarted: false,
      status: this.status
    };
  }

  stop() {
    if (this.client) this.client.destroy().catch(() => {});
    this.client = null;
    this.started = false;
    this.ready = false;
  }

  closeSseClients() {
    for (const res of this.sseClients) res.end();
    this.sseClients.clear();
  }
}

module.exports = {
  WhatsAppManager
};
