class EchoGuard {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.recentBotMessageIds = new Set();
    this.recentBotBodies = new Map();
    this.processedMessageIds = new Map();
    this.pendingBotBodies = new Map();
  }

  normalizeBody(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
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
    const msgId = msg && msg.id ? (msg.id._serialized || msg.id.id || '') : '';
    if (!msgId) return false;
    if (this.processedMessageIds.has(msgId)) return true;
    this.processedMessageIds.set(msgId, Date.now() + this.ttlMs);
    return false;
  }

  isLikelyBotEcho(msg, body) {
    this.cleanup();
    const msgId = msg && msg.id ? (msg.id._serialized || msg.id.id || '') : '';
    if (msgId && this.recentBotMessageIds.has(String(msgId))) {
      this.recentBotMessageIds.delete(String(msgId));
      return true;
    }

    if (!msg || !msg.fromMe) return false;
    const key = this.normalizeBody(body);
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
    const key = this.normalizeBody(body);
    if (!key) return;
    this.pendingBotBodies.set(key, Date.now() + this.ttlMs);
  }

  clearPendingBotBody(body) {
    const key = this.normalizeBody(body);
    if (!key) return;
    this.pendingBotBodies.delete(key);
  }

  rememberBotMessage(sentMsg, body) {
    const now = Date.now();
    const id = sentMsg && sentMsg.id ? (sentMsg.id._serialized || sentMsg.id.id || '') : '';
    if (id) this.recentBotMessageIds.add(String(id));

    const key = this.normalizeBody(body);
    if (key) this.recentBotBodies.set(key, now + this.ttlMs);
  }
}

module.exports = {
  EchoGuard
};
