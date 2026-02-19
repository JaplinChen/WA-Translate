function extractMessageId(msg) {
  if (!msg || !msg.id) return '';
  return String(msg.id._serialized || msg.id.id || '');
}

function normalizeBody(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

class BotEchoTracker {
  constructor(ttlMs = 120000) {
    this.ttlMs = ttlMs;
    this.recentBotMessageIds = new Set();
    this.recentBotBodies = new Map();
    this.processedMessageIds = new Map();
    this.pendingBotBodies = new Map();
  }

  cleanup() {
    const now = Date.now();
    for (const [key, expireAt] of this.recentBotBodies.entries()) {
      if (expireAt <= now) this.recentBotBodies.delete(key);
    }
    for (const [key, expireAt] of this.pendingBotBodies.entries()) {
      if (expireAt <= now) this.pendingBotBodies.delete(key);
    }
    for (const [id, expireAt] of this.processedMessageIds.entries()) {
      if (expireAt <= now) this.processedMessageIds.delete(id);
    }
  }

  markAndCheckProcessed(msg) {
    this.cleanup();
    const msgId = extractMessageId(msg);
    if (!msgId) return false;
    if (this.processedMessageIds.has(msgId)) return true;
    this.processedMessageIds.set(msgId, Date.now() + this.ttlMs);
    return false;
  }

  isLikelyBotEcho(msg, body) {
    this.cleanup();

    const msgId = extractMessageId(msg);
    if (msgId && this.recentBotMessageIds.has(msgId)) {
      this.recentBotMessageIds.delete(msgId);
      return true;
    }

    if (!msg || !msg.fromMe) return false;
    const key = normalizeBody(body);
    if (!key) return false;

    const pendingExpireAt = this.pendingBotBodies.get(key);
    if (pendingExpireAt && pendingExpireAt > Date.now()) return true;

    const expireAt = this.recentBotBodies.get(key);
    if (!expireAt) return false;
    if (expireAt <= Date.now()) {
      this.recentBotBodies.delete(key);
      return false;
    }
    return true;
  }

  markPendingBotBody(body) {
    const key = normalizeBody(body);
    if (!key) return;
    this.pendingBotBodies.set(key, Date.now() + this.ttlMs);
  }

  clearPendingBotBody(body) {
    const key = normalizeBody(body);
    if (!key) return;
    this.pendingBotBodies.delete(key);
  }

  rememberBotMessage(sentMsg, body) {
    const msgId = extractMessageId(sentMsg);
    if (msgId) this.recentBotMessageIds.add(msgId);

    const key = normalizeBody(body);
    if (key) this.recentBotBodies.set(key, Date.now() + this.ttlMs);
  }
}

module.exports = {
  BotEchoTracker
};
