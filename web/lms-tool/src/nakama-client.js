'use strict';

/**
 * Client for the Workstream-B lms-bridge Nakama RPC contract (live on this
 * machine at data/modules/src/lms-bridge/lms_bridge.ts).
 *
 * Live contract notes (verified against the deployed RPCs):
 *   - endpoint: POST {base}/v2/rpc/{id}?http_key={key}&unwrap  (raw JSON body)
 *   - every response is an envelope: {success:true, data:{...}} or
 *     {success:false, error:"...", code:N} — this client unwraps it.
 *   - every RPC requires payload.service_token === LMS_BRIDGE_SERVICE_TOKEN.
 *   - launches are validated against a platform+deployment allowlist:
 *     the platform row's `issuer` must match the LTI iss and the deployment_id
 *     must be listed. resolvePlatformId() maps iss → platform_id.
 *
 * If Nakama is unreachable or an RPC is not registered (404), the call falls
 * back to a local mock (mock-nakama/handlers.js) and the RPC is marked
 * "integration-pending" in getIntegrationStatus().
 */

const { NAKAMA } = require('./config');
const mock = require('../mock-nakama/handlers');

const RPCS = [
  'lms_launch_session',
  'lms_deeplink_bind',
  'lms_attempt_complete',
  'lms_import_pack',
  'lms_link_status',
  'lms_platform_upsert',
  'lms_platform_list',
];

// per-RPC: 'unknown' | 'live' | 'mocked'
const rpcStatus = Object.fromEntries(RPCS.map((r) => [r, 'unknown']));

class NakamaRpcError extends Error {
  constructor(id, message, code) {
    super(`Nakama ${id} failed (${code}): ${message}`);
    this.rpc = id;
    this.code = code;
  }
}

async function callRpc(id, payload) {
  const body = { service_token: NAKAMA.serviceToken, ...payload };
  const url = `${NAKAMA.baseUrl}/v2/rpc/${id}?http_key=${encodeURIComponent(NAKAMA.httpKey)}&unwrap`;

  let res, text;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    text = await res.text();
  } catch (err) {
    return fallbackToMock(id, body, err.message || 'connection error');
  }

  if (res.status === 404) {
    // RPC not registered yet → mock
    return fallbackToMock(id, body, 'Nakama returned 404 (RPC not registered)');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new NakamaRpcError(id, `unparseable response: ${text.slice(0, 200)}`, res.status);
  }

  // lms-bridge envelope: {success, data} | {success:false, error, code}
  if (parsed && typeof parsed === 'object' && 'success' in parsed) {
    // A well-formed error envelope still proves the RPC is registered and
    // answering — mark it live before surfacing the business error.
    rpcStatus[id] = 'live';
    if (!parsed.success) throw new NakamaRpcError(id, parsed.error || 'unknown error', parsed.code || res.status);
    return parsed.data || {};
  }
  if (!res.ok) throw new NakamaRpcError(id, (parsed && parsed.message) || text, res.status);
  rpcStatus[id] = 'live';
  return parsed;
}

function fallbackToMock(id, body, reason) {
  if (rpcStatus[id] !== 'mocked') {
    console.warn(`[nakama-client] ${id}: falling back to local mock (${reason}) — integration-pending`);
  }
  rpcStatus[id] = 'mocked';
  return mock.handle(id, body);
}

// ── issuer → platform_id resolution (cached) ────────────────────────────────

let platformCache = { at: 0, byIssuer: {} };

async function resolvePlatformId(issuer) {
  const now = Date.now();
  if (now - platformCache.at > 60000) {
    try {
      const data = await callRpc('lms_platform_list', {});
      const byIssuer = {};
      for (const p of data.platforms || []) byIssuer[p.issuer] = p.platform_id;
      platformCache = { at: now, byIssuer };
    } catch (err) {
      console.warn('[nakama-client] lms_platform_list failed:', err.message);
    }
  }
  return platformCache.byIssuer[issuer] || issuer;
}

function invalidatePlatformCache() {
  platformCache = { at: 0, byIssuer: {} };
}

function getIntegrationStatus() {
  return { baseUrl: NAKAMA.baseUrl, serviceTokenConfigured: Boolean(NAKAMA.serviceToken), rpcs: { ...rpcStatus } };
}

/**
 * Actively exercise RPCs still marked 'unknown' so /health reflects reality.
 * The probes use benign payloads; a structured error envelope (e.g. 404
 * "resource link not found") is proof-of-life and flips the status to 'live'.
 */
async function probeHealth() {
  const probes = {
    lms_link_status: { platform_id: '__health_probe__', deployment_id: '0', resource_link_id: '__health_probe__' },
    lms_deeplink_bind: { platform_id: '__health_probe__', deployment_id: '0', resource_link_id: '__health_probe__', pack_id: '__health_probe__' },
    lms_platform_list: {},
  };
  await Promise.all(Object.entries(probes)
    .filter(([id]) => rpcStatus[id] === 'unknown')
    .map(([id, payload]) => callRpc(id, payload).catch(() => {})));
  return getIntegrationStatus();
}

module.exports = {
  callRpc,
  NakamaRpcError,
  getIntegrationStatus,
  probeHealth,
  resolvePlatformId,
  invalidatePlatformCache,
  launchSession: (p) => callRpc('lms_launch_session', p),
  deeplinkBind: (p) => callRpc('lms_deeplink_bind', p),
  attemptComplete: (p) => callRpc('lms_attempt_complete', p),
  importPack: (p) => callRpc('lms_import_pack', p),
  linkStatus: (p) => callRpc('lms_link_status', p),
  platformUpsert: (p) => callRpc('lms_platform_upsert', p),
  platformList: (p) => callRpc('lms_platform_list', p || {}),
};
