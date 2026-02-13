const path = require('path');

const HOST = process.env.WIZARD_HOST || '127.0.0.1';
const parsedPort = Number.parseInt(process.env.WIZARD_PORT || '', 10);
const PORT = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 38765;
const requireTokenRaw = String(process.env.WIZARD_REQUIRE_TOKEN || '').trim().toLowerCase();
const REQUIRE_TOKEN = requireTokenRaw
  ? /^(1|true|yes|on)$/i.test(requireTokenRaw)
  : HOST === '0.0.0.0';
const ACCESS_TOKEN = String(process.env.WIZARD_ACCESS_TOKEN || '').trim();
const ENV_PATH = path.resolve(process.cwd(), '.env');
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

module.exports = {
  HOST,
  PORT,
  REQUIRE_TOKEN,
  ACCESS_TOKEN,
  ENV_PATH,
  PUBLIC_DIR
};
