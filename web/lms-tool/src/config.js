'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOOL_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(TOOL_ROOT, '..', '..');

// Load the repo .env first (LMS_BRIDGE_SERVICE_TOKEN etc.), then a local override.
require('dotenv').config({ path: path.join(REPO_ROOT, '.env') });
require('dotenv').config({ path: path.join(TOOL_ROOT, '.env'), override: true });

const PORT = parseInt(process.env.LMS_TOOL_PORT || '8090', 10);
const TOOL_URL = process.env.LMS_TOOL_URL || `http://localhost:${PORT}`;

/**
 * Canonical LTI keypair (owned by Workstream A at .lms-dev/keys/).
 * ltijs manages its own per-platform signing keys internally (no injection API),
 * so the canonical key is NOT used to sign ltijs messages. It is:
 *   - served at /lti/tool-jwks for Nakama's production lms_grade_push path
 *   - fallback-generated at web/lms-tool/.keys/ if Workstream A hasn't created it yet
 */
function loadCanonicalKeys() {
  const canonicalDir = path.join(REPO_ROOT, '.lms-dev', 'keys');
  const localDir = path.join(TOOL_ROOT, '.keys');

  const canonicalPriv = path.join(canonicalDir, 'lti_tool_private.pem');
  const canonicalKid = path.join(canonicalDir, 'kid.txt');
  if (fs.existsSync(canonicalPriv) && fs.existsSync(canonicalKid)) {
    return {
      source: 'canonical (.lms-dev/keys)',
      privateKeyPem: fs.readFileSync(canonicalPriv, 'utf8'),
      kid: fs.readFileSync(canonicalKid, 'utf8').trim(),
      temporary: false,
    };
  }

  // Temporary local pair — integration must switch to the canonical one.
  const localPriv = path.join(localDir, 'lti_tool_private.pem');
  const localKid = path.join(localDir, 'kid.txt');
  if (!fs.existsSync(localPriv)) {
    fs.mkdirSync(localDir, { recursive: true });
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    fs.writeFileSync(localPriv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(path.join(localDir, 'lti_tool_public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
    fs.writeFileSync(localKid, `qv-lti-temp-${Date.now()}`);
    console.warn('[lms-tool] canonical keypair missing — generated TEMPORARY pair at web/lms-tool/.keys/ (switch to .lms-dev/keys for integration)');
  }
  return {
    source: 'temporary (web/lms-tool/.keys — canonical .lms-dev/keys was missing)',
    privateKeyPem: fs.readFileSync(localPriv, 'utf8'),
    kid: fs.readFileSync(localKid, 'utf8').trim(),
    temporary: true,
  };
}

const keys = loadCanonicalKeys();

/** Public JWK for the canonical/temp key (RS256) for /lti/tool-jwks. */
function canonicalPublicJwk() {
  const pub = crypto.createPublicKey(keys.privateKeyPem);
  const jwk = pub.export({ format: 'jwk' });
  return { ...jwk, kid: keys.kid, alg: 'RS256', use: 'sig' };
}

module.exports = {
  TOOL_ROOT,
  REPO_ROOT,
  PORT,
  TOOL_URL,
  ROUTES: {
    login: '/lti/login',
    launch: '/lti/launch',
    keys: '/lti/keys',
    dynReg: '/lti/register',
    toolJwks: '/lti/tool-jwks',
  },
  // ltijs stores platform registrations + its own keys encrypted with this
  LTI_ENCRYPTION_KEY: process.env.LMS_TOOL_LTI_KEY || 'qv-lms-tool-dev-encryption-key',
  // Production default: false (HTTPS + secure cookies). Set LMS_TOOL_DEV_MODE=true for local plain-http iframes.
  DEV_MODE: (process.env.LMS_TOOL_DEV_MODE || 'false') === 'true',
  AUTO_ACTIVATE: (process.env.LMS_TOOL_AUTO_ACTIVATE || 'false') === 'true',
  DB_PATH: process.env.LMS_TOOL_DB || path.join(TOOL_ROOT, 'data', 'ltijs.sqlite'),
  PACK_STORE_PATH: process.env.LMS_TOOL_PACKS || path.join(TOOL_ROOT, 'data', 'packs.json'),
  MEDIA_STORE_PATH: process.env.LMS_TOOL_MEDIA || path.join(TOOL_ROOT, 'data', 'media'),
  NAKAMA: {
    baseUrl: process.env.NAKAMA_BASE_URL || 'http://localhost:7350',
    // Nakama's runtime http key: the repo compose file passes no --runtime.http_key
    // flag, so the server default "defaulthttpkey" applies (verified live).
    httpKey: process.env.NAKAMA_HTTP_KEY || 'defaulthttpkey',
    serviceToken: process.env.LMS_BRIDGE_SERVICE_TOKEN || '', // read from repo .env once Workstream B adds it
  },
  MOODLE_URL: process.env.MOODLE_URL || 'http://localhost:8081',
  CANVAS: {
    enabled: Boolean(
      process.env.CANVAS_BASE_URL &&
      process.env.CANVAS_OAUTH_CLIENT_ID &&
      process.env.CANVAS_OAUTH_CLIENT_SECRET &&
      process.env.CANVAS_TOKEN_ENCRYPTION_KEY
    ),
    baseUrl: process.env.CANVAS_BASE_URL || '',
    clientId: process.env.CANVAS_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.CANVAS_OAUTH_CLIENT_SECRET || '',
    redirectUri: process.env.CANVAS_OAUTH_REDIRECT_URI || `${TOOL_URL}/api/canvas/oauth/callback`,
    tokenEncryptionKey: process.env.CANVAS_TOKEN_ENCRYPTION_KEY || '',
    tokenStorePath: process.env.CANVAS_TOKEN_STORE || path.join(TOOL_ROOT, 'data', 'canvas-tokens.enc.json'),
  },
  keys,
  canonicalPublicJwk,
};
