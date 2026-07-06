#!/usr/bin/env node
// =============================================================================
// dry_run_friend_invite_flow.js — server→client dry run of ONE complete flow
// =============================================================================
// Loads the REAL production handler code (friends/notification_codes.js +
// friends/friend_invites.js — no copies, no inlining) into a Node VM sandbox
// with a mocked Nakama runtime, then drives the full friend-invite journey a
// Unity client performs:
//
//   1. A sends invite to B            → row + graph + notification + K-factor
//   2. A immediately resends          → B-009 per-pair rate limit fires
//   3. B accepts (canonical id)       → mutual friends + accepted notification
//   4. C→B graph-only legacy invite   → B-007 server graph-fallback accepts
//   5. Hourly cap                     → 21st send this hour rejected
//   6. Client-side parse              → response fields Unity's DTOs read
//
// Run:  node data/modules/tests/dry_run_friend_invite_flow.js
// The shebang makes postbuild skip this file (test-only, never bundled).
// =============================================================================

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Mock Nakama runtime ──────────────────────────────────────────────────────
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const storage = new Map();          // "collection|key|userId" → { value, version }
const graph = new Map();            // "userId" → Map(otherId → state)
const captured = { notifications: [], pushes: [], events: [] };

const skey = (c, k, u) => `${c}|${k}|${u || SYSTEM_USER}`;
const edges = (u) => { if (!graph.has(u)) graph.set(u, new Map()); return graph.get(u); };

const users = {};                   // userId → { userId, username, displayName, createTime }
function addUser(id, name, daysAgo) {
  users[id] = { userId: id, username: name, displayName: name,
                createTime: new Date(Date.now() - (daysAgo || 30) * 86400000).toISOString() };
}

const logger = {
  info: () => {}, debug: () => {},
  warn: (m) => { if (process.env.VERBOSE) console.log('  [warn]', m); },
  error: (m) => console.log('  [error]', m),
};

const nk = {
  storageRead: (reads) => reads.map(r => {
    const hit = storage.get(skey(r.collection, r.key, r.userId));
    return hit ? { collection: r.collection, key: r.key, userId: r.userId || SYSTEM_USER,
                   value: JSON.parse(JSON.stringify(hit.value)), version: hit.version } : null;
  }).filter(Boolean),
  storageWrite: (writes) => writes.map(w => {
    const k = skey(w.collection, w.key, w.userId);
    const cur = storage.get(k);
    if (w.version === '*' && cur) throw new Error('version conflict: exists');
    if (w.version && w.version !== '*' && (!cur || cur.version !== w.version)) throw new Error('version conflict');
    const version = 'v' + (cur ? parseInt(cur.version.slice(1)) + 1 : 1);
    storage.set(k, { value: JSON.parse(JSON.stringify(w.value)), version });
    return { version };
  }),
  storageDelete: (dels) => dels.forEach(d => storage.delete(skey(d.collection, d.key, d.userId))),
  friendsList: (userId, limit, state) => {
    const out = [];
    for (const [other, st] of edges(userId)) {
      if (state !== null && state !== undefined && st !== state) continue;
      out.push({ user: { id: other, username: users[other]?.username || other,
                         displayName: users[other]?.displayName || '' }, state: st });
    }
    return { friends: out };
  },
  friendsAdd: (userId, username, ids) => ids.forEach(other => {
    const mine = edges(userId).get(other);
    if (mine === 2 || edges(other).get(userId) === 1) {       // accept: both → FRIEND
      edges(userId).set(other, 0); edges(other).set(userId, 0);
    } else if (mine === undefined) {                           // new invite
      edges(userId).set(other, 1); edges(other).set(userId, 2);
    }
  }),
  friendsDelete: (userId, username, ids) => ids.forEach(other => {
    edges(userId).delete(other); edges(other).delete(userId);
  }),
  usersGetId: (ids) => ids.map(id => users[id]).filter(Boolean),
  notificationsSend: (n) => captured.notifications.push(...n),
  uuidv4: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,
    c => (c === 'x' ? (Math.random() * 16 | 0) : (Math.random() * 4 | 8)).toString(16)),
};

// ── Sandbox with mocked cross-module globals ────────────────────────────────
const sandbox = {
  console,
  Date, JSON, Math, RegExp, Object, Array, String, Number, Error,
  LegacyPush: {
    sendLocalizedPushToUser: (ctx, lg, _nk, userId, eventType, titleKey, bodyKey, vars, opts) => {
      captured.pushes.push({ userId, eventType, titleKey, vars: vars || {}, data: (opts && opts.data) || {} });
      return true;
    },
  },
  SatoriEventCapture: {
    captureEvent: (_nk, lg, userId, event) => captured.events.push({ userId, ...event }),
  },
};
sandbox.global = sandbox;
vm.createContext(sandbox);

const MODULES_DIR = path.join(__dirname, '..');
for (const file of ['friends/notification_codes.js', 'friends/friend_invites.js']) {
  vm.runInContext(fs.readFileSync(path.join(MODULES_DIR, file), 'utf8'), sandbox, { filename: file });
}

// ── Tiny assertion runner ────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? ' — ' + extra : '')); }
}
const ctxFor = (id) => ({ userId: id, username: users[id]?.username || id, env: {} });
const call = (fn, ctx, payload) => JSON.parse(sandbox[fn](ctx, logger, nk, JSON.stringify(payload)));

// ── Test users ───────────────────────────────────────────────────────────────
const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const C = 'cccccccc-3333-4333-8333-cccccccccccc';
addUser(A, 'alice', 14); addUser(B, 'bob', 60); addUser(C, 'carol', 5);

console.log('\n═ 1. A sends friend invite to B (send_friend_invite) ═');
let res = call('rpcFriendsSendInvite', ctxFor(A), { targetUserId: B, message: 'hi!' });
check('RPC succeeds', res.success === true, res.error);
check('inviteId is canonical inv_{A}_{B}', res.inviteId === `inv_${A}_${B}`, res.inviteId);
check('status = pending (client renders "Cancel" state)', res.status === 'pending');
const row = storage.get(skey('friend_invites', `inv_${A}_${B}`, B));
check('invite row stored under TARGET (B owns their inbox)', !!row);
check('Nakama graph: A→B INVITE_SENT(1)', edges(A).get(B) === 1);
check('Nakama graph: B→A INVITE_RECEIVED(2)', edges(B).get(A) === 2);
check('in-app notification delivered to B', captured.notifications.some(n => n.userId === B && n.code === 1));
check('inbox mirror row written (tier 2)', [...storage.keys()].some(k => k.startsWith('notification_inbox|') && k.endsWith('|' + B)));
check('device push sent to B (friend_request)', captured.pushes.some(p => p.userId === B && p.eventType === 'friend_request'));
const sentEvt = captured.events.find(e => e.name === 'invite_sent');
check('K-factor invite_sent emitted', !!sentEvt);
check('K-factor carries daysSinceSourceJoined=14', sentEvt && sentEvt.metadata.daysSinceSourceJoined === '14', sentEvt && sentEvt.metadata.daysSinceSourceJoined);
check('K-factor carries sourceFriendCount=0', sentEvt && sentEvt.metadata.sourceFriendCount === '0');

console.log('\n═ 2. A immediately resends → B-009 per-pair rate limit ═');
res = call('rpcFriendsSendInvite', ctxFor(A), { targetUserId: B });
check('resend blocked', res.success === false);
check('errorCode is rate_limited (per-user 5s burst guard fires first)',
      res.errorCode === 'rate_limited' || res.errorCode === 'pair_rate_limited', res.errorCode);
check('retryAfterMs provided for client countdown', typeof res.retryAfterMs === 'number' && res.retryAfterMs > 0);
// Clear the per-user burst bucket but KEEP the pair bucket → pair limit must fire on its own.
storage.delete(skey('rate_limits', 'rl_fr_invite_send_' + A, A));
res = call('rpcFriendsSendInvite', ctxFor(A), { targetUserId: B });
check('pair bucket alone still blocks (B-009 core)', res.success === false && res.errorCode === 'pair_rate_limited', res.errorCode);

console.log('\n═ 3. B accepts via canonical id (accept_friend_invite) ═');
res = call('rpcFriendsAcceptInvite', ctxFor(B), { inviteId: `inv_${A}_${B}` });
check('accept succeeds', res.success === true, res.error);
check('response carries friendUserId=A for client roster insert', res.friendUserId === A);
check('graph: A→B FRIEND(0)', edges(A).get(B) === 0);
check('graph: B→A FRIEND(0)', edges(B).get(A) === 0);
check('row status flipped to accepted', storage.get(skey('friend_invites', `inv_${A}_${B}`, B)).value.status === 'accepted');
check('accepted notification (code 2) delivered to sender A', captured.notifications.some(n => n.userId === A && n.code === 2));
check('accepted device push sent to A', captured.pushes.some(p => p.userId === A && p.eventType === 'friend_accepted'));
check('K-factor invite_accepted emitted', captured.events.some(e => e.name === 'invite_accepted' && e.userId === B));
res = call('rpcFriendsAcceptInvite', ctxFor(B), { inviteId: `inv_${A}_${B}` });
check('second accept is idempotent (alreadyAccepted)', res.success === true && res.alreadyAccepted === true);

console.log('\n═ 4. C→B legacy graph-only invite → B-007 server graph fallback ═');
edges(C).set(B, 1); edges(B).set(C, 2);   // graph edge exists, NO storage row (legacy invite)
res = call('rpcFriendsAcceptInvite', ctxFor(B), { inviteId: `inv_${C}_${B}` });
check('rowless accept succeeds via graph fallback', res.success === true, res.error || res.errorCode);
check('response flags viaGraphFallback', res.viaGraphFallback === true);
check('graph: B and C now mutual friends', edges(B).get(C) === 0 && edges(C).get(B) === 0);
check('row materialised as accepted (source=graph_fallback)',
      storage.get(skey('friend_invites', `inv_${C}_${B}`, B))?.value.source === 'graph_fallback');
res = call('rpcFriendsAcceptInvite', ctxFor(B), { inviteId: 'inv_dddddddd-4444-4444-8444-dddddddddddd_' + B });
check('truly nonexistent invite still fails cleanly', res.success === false && res.errorCode === 'invite_not_found', res.errorCode);

console.log('\n═ 5. Hourly cap: 20 sends OK, 21st rejected (B-009 global) ═');
let capHit = null;
for (let i = 0; i < 21; i++) {
  const T = `${(10 + i).toString(16).padStart(8, 'e')}-9999-4999-8999-999999999999`.slice(0, 36);
  addUser(T, 'target' + i, 30);
  storage.delete(skey('rate_limits', 'rl_fr_invite_send_' + A, A)); // bypass 5s burst between sends
  const r = call('rpcFriendsSendInvite', ctxFor(A), { targetUserId: T });
  if (!r.success) { capHit = { i, code: r.errorCode }; break; }
}
// Note: 1 send already used in step 1, so the cap trips on the 20th loop send.
check('hourly cap trips with rate_limited_hourly', capHit && capHit.code === 'rate_limited_hourly',
      capHit ? `at loop send #${capHit.i + 1}, code=${capHit.code}` : 'never tripped');
check('cap trips after exactly 20 total sends this hour', capHit && capHit.i === 19, capHit && `loop index ${capHit.i}`);

console.log('\n═ 6. Client-side contract: fields Unity DTOs deserialize ═');
const pend = call('rpcFriendsListPendingInvites', ctxFor(B), { limit: 100 });
check('list_pending returns success envelope', pend.success === true, pend.error);
check('incoming[] present (FriendsNakamaModels.incoming)', Array.isArray(pend.incoming));
check('outgoing[] present (FriendsNakamaModels.outgoing)', Array.isArray(pend.outgoing));
const flowFields = ['success', 'inviteId', 'targetUserId', 'status', 'sentAt'];
storage.delete(skey('rate_limits', 'rl_fr_invite_send_' + C, C));
const sendC = call('rpcFriendsSendInvite', ctxFor(C), { targetUserId: A });
check('send response has every field Unity reads (' + flowFields.join(', ') + ')',
      flowFields.every(f => sendC[f] !== undefined),
      flowFields.filter(f => sendC[f] === undefined).join(','));

console.log('\n─────────────────────────────────────────');
console.log(`  Dry run: ${pass} passed, ${fail} failed`);
console.log('─────────────────────────────────────────\n');
process.exit(fail > 0 ? 1 : 0);
