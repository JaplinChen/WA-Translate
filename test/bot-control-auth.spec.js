const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isAuthorizedBotControl,
  botControlAuthError
} = require('../bot-control-auth');

function makeReq(remoteAddress, token) {
  return {
    socket: { remoteAddress },
    headers: token ? { 'x-bot-control-token': token } : {}
  };
}

test('loopback request is always authorized', () => {
  const req = makeReq('127.0.0.1');
  assert.equal(isAuthorizedBotControl(req, ''), true);
});

test('non-loopback request requires matching token', () => {
  const req = makeReq('172.19.0.3', 'abc123');
  assert.equal(isAuthorizedBotControl(req, 'abc123'), true);
  assert.equal(isAuthorizedBotControl(req, 'nope'), false);
});

test('non-loopback request is denied when token is not configured', () => {
  const req = makeReq('172.19.0.3');
  assert.equal(isAuthorizedBotControl(req, ''), false);
  assert.match(botControlAuthError(''), /BOT_CONTROL_TOKEN/);
});
