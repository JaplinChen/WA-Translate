const test = require('node:test');
const assert = require('node:assert/strict');

const { BotEchoTracker } = require('../bot-echo-tracker');

function makeMsg(id, fromMe = false) {
  return {
    id: { _serialized: id },
    fromMe
  };
}

test('tracker marks duplicate message id as processed', () => {
  const tracker = new BotEchoTracker(1000);
  const msg = makeMsg('abc');
  assert.equal(tracker.markAndCheckProcessed(msg), false);
  assert.equal(tracker.markAndCheckProcessed(msg), true);
});

test('tracker detects likely bot echo by pending body', () => {
  const tracker = new BotEchoTracker(1000);
  const msg = makeMsg('x1', true);
  tracker.markPendingBotBody('Hello World');
  assert.equal(tracker.isLikelyBotEcho(msg, 'hello   world'), true);
});
