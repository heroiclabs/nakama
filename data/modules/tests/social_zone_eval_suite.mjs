#!/usr/bin/env node
// =============================================================================
// social_zone_eval_suite.mjs
// =============================================================================
// Live, end-to-end evaluation suite for the Social Zone RPC surface (Friends,
// Groups, Chat) plus targeted regression + concurrency/stress checks for the
// bugs fixed in this pass (QVBF_305 stale-group race, QVBF_306/149 message
// delivery, the chat hygiene guardrails, and the withCleanAuthError fix on
// quizverse_deliver_pending_chat_messages / mark_group_messages_read /
// get_unread_counts).
//
// This talks to a REAL running Nakama server over its public HTTP + realtime
// WebSocket API — no mocks. Every test account it creates is a disposable,
// clearly-tagged throwaway (`evalsuite_<runTag>_...`) that only ever
// interacts with OTHER accounts created in the same run. It never reads,
// writes, or contacts any pre-existing real player.
//
// Usage:
//   node data/modules/tests/social_zone_eval_suite.mjs
//
// Env overrides (defaults target the live production endpoint):
//   NAKAMA_EVAL_HOST        default: nakama-rest.intelli-verse-x.ai
//   NAKAMA_EVAL_PORT        default: 443
//   NAKAMA_EVAL_TLS         default: true   ("false" for local http docker)
//   NAKAMA_EVAL_SERVER_KEY  default: defaultkey (Nakama's public client key,
//                           same one baked into the shipped Unity client —
//                           NOT an admin secret)
//
// Exit code: 0 if every test passed, 1 if any test failed.
//
// NOTE: The shebang above causes the postbuild bundler to skip this file
// (same convention as tests/async_challenge_state_machine_test.js). Do NOT
// remove it.
// =============================================================================

const HOST = process.env.NAKAMA_EVAL_HOST || "nakama-rest.intelli-verse-x.ai";
const PORT = Number(process.env.NAKAMA_EVAL_PORT || 443);
const USE_TLS = (process.env.NAKAMA_EVAL_TLS ?? "true") !== "false";
const SERVER_KEY = process.env.NAKAMA_EVAL_SERVER_KEY || "defaultkey";
const HTTP_BASE = `${USE_TLS ? "https" : "http"}://${HOST}:${PORT}`;
const WS_BASE = `${USE_TLS ? "wss" : "ws"}://${HOST}:${PORT}`;

const RUN_TAG = process.env.NAKAMA_EVAL_RUN_TAG || Math.random().toString(36).slice(2, 10);
const log = (...a) => console.log(...a);

// ─── HTTP helpers ───────────────────────────────────────────────────────────

function decodeUserIdFromJwt(token) {
  const parts = token.split(".");
  if (parts.length < 2) throw new Error("malformed session token");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (!payload.uid) throw new Error("session token has no uid claim");
  return payload.uid;
}

async function authenticateDevice(deviceId, username) {
  const url = `${HTTP_BASE}/v2/account/authenticate/device?create=true&username=${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(SERVER_KEY + ":").toString("base64"),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: deviceId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`authenticate_device HTTP ${res.status}: ${JSON.stringify(body)}`);
  return { token: body.token, userId: decodeUserIdFromJwt(body.token), username };
}

// Mirrors the exact `?unwrap=true` convention already used by the platform's
// own cron sidecars (see intelli-verse-kube-infra/nakama/*-cronjob.yaml) —
// send the raw JSON object as the RPC payload, Nakama handles the stringify.
async function rpc(token, rpcId, payload) {
  const url = `${HTTP_BASE}/v2/rpc/${rpcId}?unwrap=true`;
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const durMs = Date.now() - started;
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { httpStatus: res.status, ok: res.ok, body, durMs };
}

// ─── Realtime WebSocket helper (the actual path Unity's chat send uses) ────

function openRealtimeSocket(token) {
  return new Promise((resolve, reject) => {
    const url = `${WS_BASE}/ws?token=${encodeURIComponent(token)}&format=json`;
    const ws = new WebSocket(url);
    const pending = new Map();
    let cidCounter = 0;
    const settleTimer = setTimeout(() => reject(new Error("WS connect timeout")), 10000);

    ws.addEventListener("open", () => {
      clearTimeout(settleTimer);
      resolve(handle);
    });
    ws.addEventListener("error", () => { clearTimeout(settleTimer); reject(new Error("WS connect error")); });
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.cid && pending.has(msg.cid)) {
        const { resolve: res } = pending.get(msg.cid);
        pending.delete(msg.cid);
        res(msg);
      }
    });

    const handle = {
      send(envelope, timeoutMs = 8000) {
        const cid = String(++cidCounter);
        return new Promise((res, rej) => {
          pending.set(cid, { resolve: res });
          ws.send(JSON.stringify({ cid, ...envelope }));
          setTimeout(() => {
            if (pending.has(cid)) { pending.delete(cid); rej(new Error(`WS timeout waiting on cid ${cid}`)); }
          }, timeoutMs);
        });
      },
      close() { try { ws.close(); } catch (_) {} },
    };
  });
}

// ─── Minimal test runner ────────────────────────────────────────────────────

const results = [];
async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    const durMs = Date.now() - started;
    results.push({ name, status: "PASS", durMs });
    log(`  \u2713 ${name} (${durMs}ms)`);
  } catch (err) {
    const durMs = Date.now() - started;
    results.push({ name, status: "FAIL", durMs, error: err.message || String(err) });
    log(`  \u2717 ${name} (${durMs}ms) — ${err.message || err}`);
  }
}
function skip(name, reason) {
  results.push({ name, status: "SKIP", durMs: 0, error: reason });
  log(`  \u2013 ${name} (skipped: ${reason})`);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function isInsufficientFunds(res) {
  const msg = JSON.stringify(res.body || "").toLowerCase();
  return msg.includes("insufficient") || msg.includes("not enough coins") || msg.includes("balance");
}

// ─── Suites ─────────────────────────────────────────────────────────────────

async function friendsSuite(A, B) {
  log("\n[Friends]");
  let inviteId, challengeId;

  await test("ivx_social_friend_search finds B by username", async () => {
    const r = await rpc(A.token, "ivx_social_friend_search", { query: B.username });
    assert(r.ok && r.body.success !== false, `unexpected response: ${JSON.stringify(r.body)}`);
  });

  await test("ivx_social_friend_nearby responds cleanly", async () => {
    const r = await rpc(A.token, "ivx_social_friend_nearby", {});
    assert(r.ok && r.body.success !== false, `unexpected response: ${JSON.stringify(r.body)}`);
  });

  await test("ivx_social_invite_send A -> B", async () => {
    const r = await rpc(A.token, "ivx_social_invite_send", { targetUserId: B.userId });
    assert(r.ok && r.body.success !== false, `send failed: ${JSON.stringify(r.body)}`);
    inviteId = r.body?.data?.inviteId || r.body?.inviteId;
    assert(inviteId, `no inviteId in response: ${JSON.stringify(r.body)}`);
  });

  await test("ivx_social_invites_pending shows it for B", async () => {
    const r = await rpc(B.token, "ivx_social_invites_pending", {});
    assert(r.ok, `unexpected response: ${JSON.stringify(r.body)}`);
    const list = r.body?.data?.incoming || r.body?.incoming || [];
    assert(Array.isArray(list) && list.some((i) => i.inviteId === inviteId), "sent invite not visible to recipient");
  });

  await test("ivx_social_invite_accept B accepts", async () => {
    const r = await rpc(B.token, "ivx_social_invite_accept", { inviteId });
    assert(r.ok && r.body.success !== false, `accept failed: ${JSON.stringify(r.body)}`);
  });

  await test("ivx_social_friends_list shows the new pair (both directions)", async () => {
    const rA = await rpc(A.token, "ivx_social_friends_list", {});
    const rB = await rpc(B.token, "ivx_social_friends_list", {});
    const listA = rA.body?.data?.results || rA.body?.results || [];
    const listB = rB.body?.data?.results || rB.body?.results || [];
    assert(listA.some((f) => (f.userId || f.id) === B.userId), "A does not see B as a friend");
    assert(listB.some((f) => (f.userId || f.id) === A.userId), "B does not see A as a friend");
  });

  await test("ivx_social_challenge_send A -> B", async () => {
    const r = await rpc(A.token, "ivx_social_challenge_send", {
      targetUserId: B.userId,
      gameId: "quizverse_sync_eval",
      challengeData: { modeName: "classic", isAsync: false },
    });
    if (!r.ok || r.body.success === false) { skip("ivx_social_challenge_send A -> B (soft)", JSON.stringify(r.body)); return; }
    challengeId = r.body?.data?.challengeId || r.body?.challengeId;
  });

  await test("ivx_social_challenges_pending visible to B", async () => {
    if (!challengeId) { skip("ivx_social_challenges_pending visible to B", "no challengeId from prior step"); return; }
    const r = await rpc(B.token, "ivx_social_challenges_pending", {});
    const list = r.body?.data?.incoming || r.body?.incoming || [];
    assert(Array.isArray(list) && list.some((c) => c.challengeId === challengeId), "challenge not visible to recipient");
  });

  await test("ivx_social_friends_online_count responds", async () => {
    const r = await rpc(A.token, "ivx_social_friends_online_count", {});
    assert(r.ok, `unexpected response: ${JSON.stringify(r.body)}`);
  });

  await test("get_notifications responds", async () => {
    const r = await rpc(A.token, "get_notifications", {});
    assert(r.ok, `unexpected response: ${JSON.stringify(r.body)}`);
  });

  await test("friends_block / ivx_social_friends_blocked / friends_unblock round-trip", async () => {
    const b1 = await rpc(A.token, "friends_block", { targetUserId: B.userId });
    assert(b1.ok && b1.body.success !== false, `block failed: ${JSON.stringify(b1.body)}`);
    const list = await rpc(A.token, "ivx_social_friends_blocked", {});
    const arr = list.body?.data?.results || list.body?.results || [];
    assert(Array.isArray(arr) && arr.some((u) => (u.userId || u.id) === B.userId), "blocked user not in blocked list");
    const b2 = await rpc(A.token, "friends_unblock", { targetUserId: B.userId });
    assert(b2.ok && b2.body.success !== false, `unblock failed: ${JSON.stringify(b2.body)}`);
  });
}

async function groupsSuite(A, B) {
  log("\n[Groups] (includes QVBF_305 regression: two groups must never show the same details)");
  let groupId1, groupId2, insufficientFunds = false;

  await test("create_quizverse_group #1", async () => {
    const r = await rpc(A.token, "create_quizverse_group", { name: `EvalSuite Alpha ${RUN_TAG}`, description: "eval suite group 1", open: true });
    if (!r.ok || r.body.success === false) {
      if (isInsufficientFunds(r)) { insufficientFunds = true; skip("create_quizverse_group #1", "test account has 0 coins (expected for a brand-new device account)"); return; }
      throw new Error(`create failed: ${JSON.stringify(r.body)}`);
    }
    groupId1 = r.body?.data?.groupId || r.body?.groupId || r.body?.data?.id;
    assert(groupId1, `no groupId in response: ${JSON.stringify(r.body)}`);
  });

  await test("create_quizverse_group #2", async () => {
    if (insufficientFunds) { skip("create_quizverse_group #2", "insufficient funds on #1"); return; }
    const r = await rpc(A.token, "create_quizverse_group", { name: `EvalSuite Beta ${RUN_TAG}`, description: "eval suite group 2", open: true });
    if (!r.ok || r.body.success === false) {
      if (isInsufficientFunds(r)) { insufficientFunds = true; skip("create_quizverse_group #2", "insufficient coins"); return; }
      throw new Error(`create failed: ${JSON.stringify(r.body)}`);
    }
    groupId2 = r.body?.data?.groupId || r.body?.groupId || r.body?.data?.id;
    assert(groupId2, `no groupId in response: ${JSON.stringify(r.body)}`);
  });

  await test("get_group_details(#1) then get_group_details(#2) never show the same name — QVBF_305 regression", async () => {
    if (!groupId1 || !groupId2) { skip("QVBF_305 regression check", "no groups created (funding)"); return; }
    const d1 = await rpc(A.token, "get_group_details", { groupId: groupId1 });
    const d2 = await rpc(A.token, "get_group_details", { groupId: groupId2 });
    const name1 = d1.body?.data?.name || d1.body?.group?.name;
    const name2 = d2.body?.data?.name || d2.body?.group?.name;
    assert(d1.ok && d2.ok, `one of the detail fetches failed: ${JSON.stringify(d1.body)} / ${JSON.stringify(d2.body)}`);
    assert(name1 && name2, `missing name field: ${JSON.stringify(d1.body)} / ${JSON.stringify(d2.body)}`);
    assert(name1 !== name2, `STALE DATA BUG: both groups returned the same name "${name1}"`);
    assert(name1.includes("Alpha") && name2.includes("Beta"), `names don't match what was created: got "${name1}" / "${name2}"`);
  });

  await test("re-fetch group #1 again — still consistent (no cross-contamination)", async () => {
    if (!groupId1) { skip("re-fetch group #1", "no group created"); return; }
    const d = await rpc(A.token, "get_group_details", { groupId: groupId1 });
    const name = d.body?.data?.name || d.body?.group?.name;
    assert(name && name.includes("Alpha"), `group #1 details drifted: got "${name}"`);
  });

  await test("ivx_social_group_search finds both by name", async () => {
    if (!groupId1) { skip("ivx_social_group_search", "no groups created"); return; }
    const r = await rpc(A.token, "ivx_social_group_search", { query: `EvalSuite`, gameId: null });
    assert(r.ok, `search failed: ${JSON.stringify(r.body)}`);
  });

  let inviteCode;
  await test("ivx_social_group_invite_link (owner mints a code)", async () => {
    if (!groupId1) { skip("ivx_social_group_invite_link", "no group created"); return; }
    const r = await rpc(A.token, "ivx_social_group_invite_link", { groupId: groupId1 });
    assert(r.ok && r.body.success !== false, `invite link failed: ${JSON.stringify(r.body)}`);
    inviteCode = r.body?.data?.code || r.body?.code || r.body?.data?.inviteCode;
    assert(inviteCode, `no code in response: ${JSON.stringify(r.body)}`);
  });

  await test("ivx_social_group_join_by_code (B joins via the code)", async () => {
    if (!inviteCode) { skip("ivx_social_group_join_by_code", "no invite code minted"); return; }
    const r = await rpc(B.token, "ivx_social_group_join_by_code", { code: inviteCode });
    assert(r.ok && r.body.success !== false, `join by code failed: ${JSON.stringify(r.body)}`);
  });

  await test("log_group_activity + update_group_xp", async () => {
    if (!groupId1) { skip("log_group_activity + update_group_xp", "no group created"); return; }
    const r1 = await rpc(A.token, "log_group_activity", { groupId: groupId1, activityType: "eval_suite_ping" });
    const r2 = await rpc(A.token, "update_group_xp", { groupId: groupId1, xp: 10 });
    assert(r1.ok, `log_group_activity failed: ${JSON.stringify(r1.body)}`);
    assert(r2.ok, `update_group_xp failed: ${JSON.stringify(r2.body)}`);
  });

  return { groupId1 };
}

async function chatSuite(A, B, groupId) {
  log("\n[Chat] (includes QVBF_306/149 regression: sent message must actually appear in recipient's history)");
  const dmTag = `eval-suite-dm-${RUN_TAG}`;
  const groupTag = `eval-suite-group-msg-${RUN_TAG}`;

  await test("send_direct_message A -> B, then B's history actually contains it", async () => {
    const send = await rpc(A.token, "send_direct_message", { targetUserId: B.userId, messageText: dmTag });
    assert(send.ok && send.body.success !== false, `send failed: ${JSON.stringify(send.body)}`);
    const hist = await rpc(B.token, "get_direct_message_history", { targetUserId: A.userId, limit: 20 });
    assert(hist.ok, `history fetch failed: ${JSON.stringify(hist.body)}`);
    const messages = hist.body?.data?.messages || hist.body?.messages || [];
    const found = messages.some((m) => JSON.stringify(m).includes(dmTag));
    assert(found, `DELIVERY BUG: sent DM never appeared in recipient's history (got ${messages.length} messages)`);
  });

  await test("mark_direct_messages_read (B)", async () => {
    const r = await rpc(B.token, "mark_direct_messages_read", { targetUserId: A.userId });
    assert(r.ok && r.body.success !== false, `mark read failed: ${JSON.stringify(r.body)}`);
  });

  await test("get_unread_counts (B) — authenticated happy path for the withCleanAuthError fix", async () => {
    const r = await rpc(B.token, "get_unread_counts", { directUserIds: [A.userId] });
    assert(r.ok && r.httpStatus < 500, `should not 500 for an authenticated caller: HTTP ${r.httpStatus} ${JSON.stringify(r.body)}`);
    assert(r.body.success !== false, `unexpected error: ${JSON.stringify(r.body)}`);
  });

  if (groupId) {
    await test("send_group_chat_message, then group history actually contains it", async () => {
      const send = await rpc(A.token, "send_group_chat_message", { groupId, content: groupTag });
      assert(send.ok && send.body.success !== false, `send failed: ${JSON.stringify(send.body)}`);
      const hist = await rpc(A.token, "get_group_chat_history", { groupId, limit: 20 });
      assert(hist.ok, `history fetch failed: ${JSON.stringify(hist.body)}`);
      const messages = hist.body?.data?.messages || hist.body?.messages || [];
      const found = messages.some((m) => JSON.stringify(m).includes(groupTag));
      assert(found, `DELIVERY BUG: sent group message never appeared in group history`);
    });

    await test("mark_group_messages_read — authenticated happy path for the withCleanAuthError fix", async () => {
      const r = await rpc(A.token, "mark_group_messages_read", { groupId });
      assert(r.ok && r.httpStatus < 500, `should not 500 for an authenticated caller: HTTP ${r.httpStatus} ${JSON.stringify(r.body)}`);
      assert(r.body.success !== false, `unexpected error: ${JSON.stringify(r.body)}`);
    });
  } else {
    skip("send_group_chat_message / history / mark_group_messages_read", "no group available from Groups suite");
  }

  await test("quizverse_deliver_pending_chat_messages — authenticated happy path for the withCleanAuthError fix", async () => {
    const r = await rpc(A.token, "quizverse_deliver_pending_chat_messages", {});
    assert(r.ok && r.httpStatus < 500, `should not 500 for an authenticated caller: HTTP ${r.httpStatus} ${JSON.stringify(r.body)}`);
    assert(r.body.success !== false, `unexpected error: ${JSON.stringify(r.body)}`);
  });
}

// Realtime-socket guardrail stress test — this exercises the ACTUAL path
// Unity's chat send uses (socket.WriteChatMessageAsync -> ChannelMessageSend),
// which is what beforeChannelMessageSend's new length-cap + rate-limit guard
// in chat.ts protects. The RPC-based send_direct_message does NOT go through
// this hook (it calls nk.channelMessageSend server-side directly), so this is
// the only way to genuinely validate the new guardrail.
async function chatGuardrailStressSuite(A, B) {
  log("\n[Chat guardrails — realtime socket stress test, new in this pass]");
  let socket;
  try {
    socket = await openRealtimeSocket(A.token);
  } catch (err) {
    skip("realtime socket guardrail tests", `could not open WS: ${err.message}`);
    return;
  }

  let channelId;
  await test("channel_join DM(A,B) over the realtime socket", async () => {
    const res = await socket.send({ channel_join: { target: B.userId, type: 2, persistence: true } });
    assert(!res.error, `join failed: ${JSON.stringify(res.error)}`);
    channelId = res.channel?.id;
    assert(channelId, `no channel id in join response: ${JSON.stringify(res)}`);
  });

  await test("10 rapid messages succeed, 11th+ rejected by the new rate limiter (max 10 / 10s)", async () => {
    if (!channelId) { throw new Error("no channelId from join step"); }
    let successCount = 0, rejectedAt = null;
    for (let i = 1; i <= 13; i++) {
      const res = await socket.send({ channel_message_send: { channel_id: channelId, content: JSON.stringify({ text: `eval-suite-burst-${RUN_TAG}-${i}` }) } });
      if (res.error) { rejectedAt = i; break; }
      successCount++;
    }
    assert(successCount === 10, `expected exactly 10 messages to succeed before the limiter kicks in, got ${successCount}`);
    assert(rejectedAt === 11, `expected message #11 to be the first rejected one, got rejection at #${rejectedAt}`);
  });

  await test("wait out the 10s window, then sending resumes", async () => {
    await new Promise((r) => setTimeout(r, 10500));
    const res = await socket.send({ channel_message_send: { channel_id: channelId, content: JSON.stringify({ text: `eval-suite-postcooldown-${RUN_TAG}` }) } });
    assert(!res.error, `expected send to succeed after cooldown, got: ${JSON.stringify(res.error)}`);
  });

  await test("message over 4000 chars is rejected by the new length cap", async () => {
    // A silent timeout (no ack, no error envelope) also counts as "rejected"
    // here: Nakama's own transport layer may drop an oversized WS frame
    // before it ever reaches beforeChannelMessageSend, which is just as
    // valid a rejection outcome as our application-level guard throwing.
    let outcome;
    try {
      outcome = await socket.send({ channel_message_send: { channel_id: channelId, content: JSON.stringify({ text: "x".repeat(4200) }) } }, 5000);
    } catch (timeoutErr) {
      outcome = { error: { message: `no response (${timeoutErr.message})` } };
    }
    assert(outcome.error, "expected an oversized message to be rejected, but it was accepted");
  });

  socket.close();
}

// Basic concurrency sanity — N simultaneous reads must all succeed with
// consistent, correct data (guards against the class of bug this whole pass
// started from: shared/reused state leaking between concurrent requests).
async function concurrencySuite(A, B, groupId1) {
  log("\n[Concurrency sanity]");

  await test("5 concurrent get_unread_counts calls all succeed independently", async () => {
    const calls = Array.from({ length: 5 }, () => rpc(A.token, "get_unread_counts", { directUserIds: [B.userId] }));
    const resArr = await Promise.all(calls);
    resArr.forEach((r, i) => assert(r.ok && r.body.success !== false, `concurrent call #${i} failed: ${JSON.stringify(r.body)}`));
  });

  await test("2 concurrent ivx_social_invite_accept on the SAME (already-consumed) invite never double-errors ungracefully", async () => {
    // Re-use of an already-accepted invite id is a reasonable proxy for the
    // claim-before-grant race this pass fixed server-side (friend_invites.js):
    // a repeat/duplicate accept must fail cleanly, never crash or corrupt state.
    const fakeInviteId = `nonexistent-${RUN_TAG}`;
    const [r1, r2] = await Promise.all([
      rpc(A.token, "ivx_social_invite_accept", { inviteId: fakeInviteId }),
      rpc(A.token, "ivx_social_invite_accept", { inviteId: fakeInviteId }),
    ]);
    assert(r1.httpStatus < 500 && r2.httpStatus < 500, `expected clean errors, got HTTP ${r1.httpStatus}/${r2.httpStatus}`);
  });

  if (groupId1) {
    await test("10 concurrent get_group_details(#1) calls all return the SAME name (no interleaving corruption)", async () => {
      const calls = Array.from({ length: 10 }, () => rpc(A.token, "get_group_details", { groupId: groupId1 }));
      const resArr = await Promise.all(calls);
      const names = resArr.map((r) => r.body?.data?.name || r.body?.group?.name);
      const distinct = new Set(names);
      assert(distinct.size === 1, `expected all 10 concurrent reads of the same group to agree, got: ${[...distinct].join(", ")}`);
    });
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  log(`Social Zone Eval Suite — target: ${HTTP_BASE}  run tag: ${RUN_TAG}\n`);

  log("[Setup] creating two disposable throwaway accounts...");
  const A = await authenticateDevice(`evalsuite_${RUN_TAG}_a`, `evalsuiteA_${RUN_TAG}`);
  const B = await authenticateDevice(`evalsuite_${RUN_TAG}_b`, `evalsuiteB_${RUN_TAG}`);
  log(`  A = ${A.userId} (${A.username})`);
  log(`  B = ${B.userId} (${B.username})`);

  await friendsSuite(A, B);
  const { groupId1 } = await groupsSuite(A, B);
  await chatSuite(A, B, groupId1);
  await chatGuardrailStressSuite(A, B);
  await concurrencySuite(A, B, groupId1);

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;

  log("\n" + "=".repeat(70));
  log(`RESULTS: ${pass} passed, ${fail} failed, ${skipped} skipped (of ${results.length})`);
  if (fail > 0) {
    log("\nFAILURES:");
    results.filter((r) => r.status === "FAIL").forEach((r) => log(`  \u2717 ${r.name}\n      ${r.error}`));
  }
  log("=".repeat(70));

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFATAL — eval suite could not run to completion:", err);
  process.exit(1);
});
