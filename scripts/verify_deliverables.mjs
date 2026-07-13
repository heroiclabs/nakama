#!/usr/bin/env node
// verify_deliverables.mjs — Seed Questions × Aahaa deliverable verifier.
// ─────────────────────────────────────────────────────────────────────────────
// Runs 12 numbered checks covering every deliverable of the SeedQ/Aahaa
// project (see docs/VERIFIER_LOOP.md for the check → deliverable map) against
// a live Nakama backend. Every run mints FRESH device-auth personas, so the
// suite is repeatable forever and never depends on prior state.
//
// Zero npm deps — node >= 18 (global fetch) is the only requirement.
//
// Usage:
//   node scripts/verify_deliverables.mjs                         # one run vs localhost
//   node scripts/verify_deliverables.mjs --host http://host:7350 # other host
//   node scripts/verify_deliverables.mjs --loop 300              # re-run forever every 300s
//
// Flags / env:
//   --host URL         (env NAKAMA_HOST,  default http://localhost:7350)
//   --http-key KEY     (env HTTP_KEY,     default defaulthttpkey)  admin RPCs
//   --client-key KEY   (env CLIENT_KEY,   default defaultkey)      device auth
//   --out PATH         (env VERIFY_OUT,   default web/seedquestions/verify-latest.json;
//                       pass --out none to skip writing)
//   --loop SECONDS     re-run forever, sleeping SECONDS between runs
//   --no-color         plain output
//
// Exit code: 0 when every check PASSes, 1 otherwise (single-run mode).
// In --loop mode the process never exits; each round prints a summary and
// rewrites the JSON evidence file.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── config ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name, envName, dflt) {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  if (envName && process.env[envName]) return process.env[envName];
  return dflt;
}
const HOST = flag("--host", "NAKAMA_HOST", "http://localhost:7350").replace(/\/+$/, "");
const HTTP_KEY = flag("--http-key", "HTTP_KEY", "defaulthttpkey");
const CLIENT_KEY = flag("--client-key", "CLIENT_KEY", "defaultkey");
const LOOP_SEC = parseInt(flag("--loop", "VERIFY_LOOP", "0"), 10) || 0;
const NO_COLOR = argv.includes("--no-color") || !process.stdout.isTTY;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const OUT_PATH = flag("--out", "VERIFY_OUT", join(REPO_ROOT, "web", "seedquestions", "verify-latest.json"));
const INDEX_JS = join(REPO_ROOT, "data", "modules", "index.js");

// ── ansi ─────────────────────────────────────────────────────────────────────
const c = (code, s) => (NO_COLOR ? s : `\x1b[${code}m${s}\x1b[0m`);
const green = (s) => c("32;1", s), red = (s) => c("31;1", s), dim = (s) => c("2", s),
  bold = (s) => c("1", s), cyan = (s) => c("36", s), yellow = (s) => c("33", s);

// ── the 17 RPC ids shipped by this project ───────────────────────────────────
const RPC_IDS = [
  "quizverse_seedq_get_staged", "quizverse_seedq_consume_set", "quizverse_seedq_review",
  "quizverse_seedq_focus_tracks", "quizverse_seedq_sources", "quizverse_seedq_ingest",
  "quizverse_seedq_ingest_tick", "quizverse_seedq_pool_stats", "quizverse_seedq_asset_job",
  "quizverse_seedq_provenance",
  "quizverse_aahaa_get", "quizverse_aahaa_react", "quizverse_aahaa_fact_pack",
  "quizverse_aahaa_profile_set", "quizverse_aahaa_generate_all", "quizverse_aahaa_validate",
  "quizverse_aahaa_catalog",
];

// ── http helpers ─────────────────────────────────────────────────────────────
async function http(url, opts) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url.split("?")[0]} → ${JSON.stringify(data).slice(0, 300)}`);
    return data;
  } finally { clearTimeout(t); }
}

async function deviceAuth(label) {
  const id = `vfy-${label}-` + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const username = `vfy_${label}_${Math.random().toString(36).slice(2, 8)}`;
  const data = await http(
    `${HOST}/v2/account/authenticate/device?create=true&username=${encodeURIComponent(username)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${CLIENT_KEY}:`).toString("base64"),
      },
      body: JSON.stringify({ id }),
    },
  );
  if (!data.token) throw new Error("device auth returned no token: " + JSON.stringify(data).slice(0, 200));
  const claims = JSON.parse(Buffer.from(data.token.split(".")[1], "base64").toString());
  return { token: data.token, userId: claims.uid, username: claims.usn };
}

async function rpc(persona, id, body) {
  return http(`${HOST}/v2/rpc/${id}?unwrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${persona.token}` },
    body: JSON.stringify(body ?? {}),
  });
}

async function adminRpc(id, body) {
  return http(`${HOST}/v2/rpc/${id}?http_key=${encodeURIComponent(HTTP_KEY)}&unwrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
const ids = (set) => set.question_ids || (set.questions || []).map((q) => q.id);
const allStagedIds = (res) => (res.sets || []).flatMap(ids);

function mkHistory(total, correct) {
  const out = [];
  for (let i = 0; i < total; i++) {
    out.push({ category: "math", correct: i < correct, time_ms: 4000 + Math.floor(Math.random() * 3000) });
  }
  return out;
}
async function seedGames(persona, games, total, correct) {
  for (let g = 0; g < games; g++) {
    const qh = mkHistory(total, correct);
    await rpc(persona, "quiz_submit_result", {
      score: Math.round((correct / total) * 100),
      totalQuestions: total, correctAnswers: correct,
      category: "math", questionHistory: qh,
    });
  }
}

// ── suite ────────────────────────────────────────────────────────────────────
async function runSuite() {
  const runId = Math.random().toString(36).slice(2, 10);
  const checks = [];
  const ctx = {}; // cross-check state

  async function check(id, name, deliverable, fn) {
    const t0 = Date.now();
    let pass = false, detail = "";
    try { detail = await fn(); pass = true; }
    catch (e) { detail = e && e.message ? e.message : String(e); }
    const entry = { id, name, deliverable, pass, detail, ms: Date.now() - t0 };
    checks.push(entry);
    const chip = pass ? green(" PASS ") : red(" FAIL ");
    console.log(`  ${String(id).padStart(2)} ${chip} ${bold(name.padEnd(26))} ${dim(`[${deliverable}]`)} ${dim(entry.ms + "ms")}`);
    console.log(`     ${pass ? dim(detail) : red(detail)}`);
    return entry;
  }

  console.log(`\n${bold("Seed Questions × Aahaa — deliverable verifier")}`);
  console.log(dim(`host=${HOST}  run=${runId}  ${new Date().toISOString()}\n`));

  // 1 · RPC registration in the built bundle (skip gracefully off-repo).
  await check(1, "RPC registration ×17", "RPC Surface", async () => {
    if (!existsSync(INDEX_JS)) return "index.js not present — skipped (in-cluster / off-repo run); covered by repo-local runs";
    const bundle = readFileSync(INDEX_JS, "utf8");
    const missing = RPC_IDS.filter((id) => !bundle.includes(`registerRpc("${id}"`));
    assert(missing.length === 0, "missing registerRpc in index.js: " + missing.join(", "));
    return `all 17 RPC ids registered in data/modules/index.js`;
  });

  // 2 · Fresh persona staging.
  await check(2, "Fresh persona staging", "SeedQ Adaptive", async () => {
    ctx.a = await deviceAuth("a");
    ctx.stage0 = await rpc(ctx.a, "quizverse_seedq_get_staged", { mode: "CustomTopic", topic: "math", set_size: 6, want_sets: 3 });
    const r = ctx.stage0;
    assert(r.ok === true, "get_staged not ok: " + JSON.stringify(r).slice(0, 200));
    assert((r.sets || []).length === 3, `expected 3 ready sets, got ${(r.sets || []).length}`);
    r.sets.forEach((s, i) => assert((s.questions || []).length === 6, `set ${i + 1} has ${(s.questions || []).length} questions, expected 6`));
    assert(r.adaptive && r.adaptive.basis === "default", `fresh user basis expected "default", got "${r.adaptive && r.adaptive.basis}"`);
    return `persona ${ctx.a.username}: 3 sets × 6 questions, adaptive basis "default" (target d${r.adaptive.target_difficulty})`;
  });

  // 3 · Adaptive difficulty: high-accuracy persona targets harder than low-accuracy.
  await check(3, "Adaptive difficulty hi>lo", "SeedQ Adaptive", async () => {
    await seedGames(ctx.a, 3, 8, 8); // 24/24 correct in math
    const hi = await rpc(ctx.a, "quizverse_seedq_get_staged", { mode: "CustomTopic", topic: "math", set_size: 6, want_sets: 3 });
    ctx.b = await deviceAuth("b");
    await seedGames(ctx.b, 3, 8, 2); // 6/24 correct
    const lo = await rpc(ctx.b, "quizverse_seedq_get_staged", { mode: "CustomTopic", topic: "math", set_size: 6, want_sets: 3 });
    const ha = hi.adaptive || {}, la = lo.adaptive || {};
    assert(ha.basis && ha.basis !== "default", `high persona basis still "${ha.basis}" after 24 answers`);
    assert(la.basis && la.basis !== "default", `low persona basis still "${la.basis}" after 24 answers`);
    assert(ha.target_difficulty > la.target_difficulty,
      `expected high target > low target, got d${ha.target_difficulty} vs d${la.target_difficulty}`);
    ctx.stageHi = hi;
    return `high 100% acc → target d${ha.target_difficulty} (${ha.basis}, n=${ha.sample_size}) > low 25% acc → d${la.target_difficulty} (${la.basis}, n=${la.sample_size})`;
  });

  // 4 · Pre-staged depth: sets 2–3 already exist before set 1 is consumed.
  await check(4, "Pre-staged depth 2–3", "D1 No-repeat", async () => {
    const sets = ctx.stage0.sets;
    assert(sets[1] && sets[1].set_id && (sets[1].questions || []).length === 6, "set 2 missing / short before any consume");
    assert(sets[2] && sets[2].set_id && (sets[2].questions || []).length === 6, "set 3 missing / short before any consume");
    return `sets 2–3 pre-built behind set 1: ${sets[1].set_id}, ${sets[2].set_id}`;
  });

  // 5 · Uniqueness across the 18 staged questions.
  await check(5, "Staged id uniqueness ×18", "D1 No-repeat", async () => {
    const all = allStagedIds(ctx.stage0);
    assert(all.length === 18, `expected 18 staged ids, got ${all.length}`);
    const dupes = all.filter((id, i) => all.indexOf(id) !== i);
    assert(dupes.length === 0, "duplicate ids across staged sets: " + [...new Set(dupes)].join(", "));
    return `18 staged question ids, all distinct`;
  });

  // 6 · Consume + restage: zero overlap with consumed ids.
  await check(6, "Consume → restage no-overlap", "D1 No-repeat", async () => {
    const set1 = ctx.stage0.sets[0];
    const consumed = new Set(ids(set1));
    const res = await rpc(ctx.a, "quizverse_seedq_consume_set", { mode: "CustomTopic", topic: "math", set_id: set1.set_id });
    assert(res.ok === true, "consume_set not ok: " + JSON.stringify(res).slice(0, 200));
    const restaged = await rpc(ctx.a, "quizverse_seedq_get_staged", { mode: "CustomTopic", topic: "math", set_size: 6, want_sets: 3 });
    ctx.stage1 = restaged;
    const overlap = allStagedIds(restaged).filter((id) => consumed.has(id));
    assert(overlap.length === 0, `${overlap.length} consumed ids reappeared after restage: ${overlap.slice(0, 5).join(", ")}`);
    return `consumed ${set1.set_id} (${consumed.size} ids) → restaged ${restaged.sets.length} sets, 0 overlap with consumed ids`;
  });

  // 7 · No-repeat production chokepoint: double request_questions is disjoint.
  await check(7, "No-repeat chokepoint ×2", "D1 No-repeat", async () => {
    const topic = `verify_${runId}`;
    const inline = [];
    for (let i = 1; i <= 12; i++) {
      inline.push({ id: `vq_${runId}_${i}`, question: `Verifier question #${i} — pick A.`, options: ["A", "B", "C"], correct_index: 0, category: topic, difficulty: 3 });
    }
    const payload = { kind: "deduped_s3", mode: "Verifier", scope: "global", topic, count: 6, id_prefix: "vfy", inline_questions: inline };
    const r1 = await rpc(ctx.a, "quizverse_request_questions", payload);
    assert(r1.ok === true, "call 1 not ok: " + JSON.stringify(r1).slice(0, 200));
    const r2 = await rpc(ctx.a, "quizverse_request_questions", payload);
    assert(r2.ok === true, "call 2 not ok: " + JSON.stringify(r2).slice(0, 200));
    const ids1 = (r1.questions || []).map((q) => q.id), ids2 = (r2.questions || []).map((q) => q.id);
    const shared = ids2.filter((id) => ids1.includes(id));
    assert(shared.length === 0, `${shared.length} ids repeated across back-to-back calls: ${shared.join(", ")}`);
    for (const [n, r, list] of [[1, r1, ids1], [2, r2, ids2]]) {
      const p = r.repeat_policy;
      assert(p && typeof p.fresh_count === "number" && typeof p.review_count === "number" && typeof p.pool_exhausted === "boolean",
        `call ${n} repeat_policy missing/malformed: ${JSON.stringify(p)}`);
      assert(p.fresh_count + p.review_count === list.length,
        `call ${n} arithmetic: fresh ${p.fresh_count} + review ${p.review_count} != served ${list.length}`);
    }
    return `disjoint: [${ids1.join(",")}] vs [${ids2.join(",")}]; policies fresh=${r1.repeat_policy.fresh_count}/${r2.repeat_policy.fresh_count} review=${r1.repeat_policy.review_count}/${r2.repeat_policy.review_count}`;
  });

  // 8 · Quality gate + honesty fields on every staged response.
  await check(8, "Quality approved + honesty", "SeedQ Quality", async () => {
    const res = ctx.stage1 || ctx.stage0;
    const qs = (res.sets || []).flatMap((s) => s.questions || []);
    const bad = qs.filter((q) => !q.quality || q.quality.status !== "approved");
    assert(bad.length === 0, `${bad.length}/${qs.length} served questions not quality-approved: ` +
      bad.slice(0, 3).map((q) => `${q.id}=${q.quality && q.quality.status}`).join(", "));
    assert(res.repeat_policy && typeof res.repeat_policy.fresh_count === "number", "repeat_policy missing on get_staged response");
    assert(typeof res.suppress_rating_prompt === "boolean", "suppress_rating_prompt missing on get_staged response");
    return `${qs.length}/${qs.length} served questions quality.status="approved"; repeat_policy + suppress_rating_prompt present`;
  });

  // 9 · Media mode: wsrv.nl-optimized URLs with provenance.
  await check(9, "Media wsrv.nl + provenance", "SeedQ Media", async () => {
    const res = await rpc(ctx.a, "quizverse_seedq_get_staged", { mode: "ImageGuess", topic: "space", set_size: 4, want_sets: 1 });
    assert(res.ok === true, "media get_staged not ok: " + JSON.stringify(res).slice(0, 200));
    const qs = (res.sets && res.sets[0] && res.sets[0].questions) || [];
    assert(qs.length > 0, "no ImageGuess/space questions staged (pool empty?)");
    const noMedia = qs.filter((q) => !q.media_url || !q.media_url.includes("wsrv.nl"));
    assert(noMedia.length === 0, `${noMedia.length}/${qs.length} questions lack a wsrv.nl media_url: ` +
      noMedia.slice(0, 3).map((q) => `${q.id}=${(q.media_url || "none").slice(0, 60)}`).join(", "));
    const noProv = qs.filter((q) => !q.media_provenance);
    assert(noProv.length === 0, `${noProv.length}/${qs.length} media questions missing provenance`);
    return `${qs.length} image questions: all media_url via wsrv.nl, all with provenance (` +
      [...new Set(qs.map((q) => q.media_provenance.license))].join("/") + ")";
  });

  // 10 · Aahaa: feed generates for the seeded persona; fact pack matches history.
  await check(10, "Aahaa feed + fact pack", "D2 Fact-pack · D3 Aahaa", async () => {
    const feedRes = await rpc(ctx.a, "quizverse_aahaa_get", { generate: true });
    assert(feedRes.ok === true, "aahaa_get not ok: " + JSON.stringify(feedRes).slice(0, 200));
    const feed = feedRes.feed || [];
    assert(feed.length >= 1, "empty wow feed for a persona with 3 seeded games");
    assert(typeof feedRes.rating_prompt_suppressed === "boolean", "rating_prompt_suppressed missing");
    const fpRes = await rpc(ctx.a, "quizverse_aahaa_fact_pack", {});
    assert(fpRes.ok === true, "fact_pack not ok");
    ctx.facts = fpRes.facts;
    const answered = ctx.facts && ctx.facts.lifetime && ctx.facts.lifetime.questions_answered;
    assert(answered >= 24, `fact pack lifetime.questions_answered=${answered}, expected ≥24 (3×8 submitted)`);
    const react = await rpc(ctx.a, "quizverse_aahaa_react", { wow_id: feed[0].wow_id, action: "shown" });
    assert(react.ok === true, "aahaa_react not ok: " + JSON.stringify(react).slice(0, 200));
    return `feed=${feed.length} wows (top: ${feed[0].wow_id}, tier ${feed[0].tier}); fact pack answered=${answered} ≥ 24; react(shown) ok`;
  });

  // 11 · No-Hallucination validator: fabricated fails, faithful passes.
  await check(11, "Validator no-hallucination", "D4 Validator", async () => {
    assert(ctx.facts, "no fact pack from check 10");
    const lt = ctx.facts.lifetime || {};
    const fab = await adminRpc("quizverse_aahaa_validate", {
      facts: ctx.facts,
      text: "You answered 987654 questions and you felt thrilled about every single one.",
    });
    assert(fab.ok === true, "validate(fabricated) not ok: " + JSON.stringify(fab).slice(0, 200));
    assert(fab.validation && fab.validation.pass === false, "fabricated text unexpectedly PASSED the validator");
    assert((fab.validation.violations || []).length > 0, "fabricated text failed but reported no violations");
    const faithfulText = `You answered ${lt.questions_answered} questions with ${lt.accuracy_pct}% accuracy. Keep going.`;
    const ok = await adminRpc("quizverse_aahaa_validate", { facts: ctx.facts, text: faithfulText });
    assert(ok.ok === true, "validate(faithful) not ok: " + JSON.stringify(ok).slice(0, 200));
    assert(ok.validation && ok.validation.pass === true,
      "faithful rephrase unexpectedly FAILED: " + JSON.stringify(ok.validation && ok.validation.violations));
    return `fabricated → pass:false (${fab.validation.violations.length} violations: ${fab.validation.violations[0]}); faithful "${faithfulText}" → pass:true`;
  });

  // 12 · Sources registry (13 connectors) + pool observability.
  await check(12, "Sources ×13 + pool stats", "Sources", async () => {
    const src = await adminRpc("quizverse_seedq_sources", {});
    assert(src.ok === true, "sources not ok: " + JSON.stringify(src).slice(0, 200));
    const n = (src.sources || []).length;
    assert(n === 13, `expected 13 connectors, got ${n}`);
    const stats = await adminRpc("quizverse_seedq_pool_stats", {});
    assert(stats.ok === true, "pool_stats not ok: " + JSON.stringify(stats).slice(0, 200));
    assert(Array.isArray(stats.pools) && stats.pools.length >= 1, "pool_stats returned no pools");
    return `13 connectors registered; ${stats.pools.length} pools (e.g. ${stats.pools.slice(0, 3).map((p) => `${p.key}:${p.size}`).join(", ")})`;
  });

  const overall = checks.every((ch) => ch.pass) ? "PASS" : "FAIL";
  return { ts: new Date().toISOString(), host: HOST, overall, checks };
}

// ── summary table + evidence file ────────────────────────────────────────────
function printSummary(result) {
  const W = { id: 3, name: 28, del: 24, res: 6 };
  const line = dim("  " + "─".repeat(W.id + W.name + W.del + W.res + 12));
  console.log("\n" + bold("  SUMMARY — " + result.host) + "  " + dim(result.ts));
  console.log(line);
  console.log(dim(`  ${"#".padEnd(W.id)} ${"check".padEnd(W.name)} ${"deliverable".padEnd(W.del)} ${"result".padEnd(W.res)} detail`));
  console.log(line);
  for (const ch of result.checks) {
    const chip = ch.pass ? green("PASS") : red("FAIL");
    console.log(`  ${String(ch.id).padEnd(W.id)} ${ch.name.padEnd(W.name)} ${cyan(ch.deliverable.padEnd(W.del))} ${chip}   ${dim(ch.detail.slice(0, 110))}`);
  }
  console.log(line);
  const passed = result.checks.filter((ch) => ch.pass).length;
  const banner = result.overall === "PASS"
    ? green(`  ✓ ALL ${passed}/${result.checks.length} CHECKS PASS`)
    : red(`  ✗ ${result.checks.length - passed}/${result.checks.length} CHECKS FAILED`);
  console.log(banner + "\n");
}

function writeEvidence(result) {
  if (!OUT_PATH || OUT_PATH === "none") return;
  try {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(result, null, 2) + "\n");
    console.log(dim(`  evidence → ${OUT_PATH}`));
  } catch (e) {
    console.log(yellow(`  (could not write evidence file ${OUT_PATH}: ${e.message})`));
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (LOOP_SEC > 0) {
  console.log(bold(`Loop mode: re-running every ${LOOP_SEC}s — Ctrl-C to stop.`));
  for (;;) {
    try {
      const result = await runSuite();
      printSummary(result);
      writeEvidence(result);
    } catch (e) {
      console.error(red("suite crashed: " + (e && e.stack || e)));
    }
    console.log(dim(`  next run in ${LOOP_SEC}s…`));
    await sleep(LOOP_SEC * 1000);
  }
} else {
  let result;
  try {
    result = await runSuite();
  } catch (e) {
    console.error(red("suite crashed: " + (e && e.stack || e)));
    process.exit(1);
  }
  printSummary(result);
  writeEvidence(result);
  process.exit(result.overall === "PASS" ? 0 : 1);
}
