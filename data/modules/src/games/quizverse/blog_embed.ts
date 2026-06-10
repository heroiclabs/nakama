// ---------------------------------------------------------------------------
//  blog_embed.ts — QuizVerse "Blog Quiz" embeddable widget backend
//
//  Powers the link-building widget: a blogger pastes a blog URL (or raw
//  content) on /widgets/blog-quiz, we generate a quiz from it ONCE, mint a
//  permanent embed_id, and the blogger drops a <script> tag. Every reader on
//  the partner site plays the SAME cached quiz; readers accrue *pending*
//  QuizVerse coins that are credited only when they install / sign in to the
//  app (decided by product: coins-on-claim, anti-farm + maximises installs).
//
//  Backlink loop: each embed renders a dofollow "Powered by QuizVerse" footer
//  and a "claim your coins in the app" CTA, so partner sites get free
//  interactive content + a reader incentive and QuizVerse gets a backlink.
//
//  RPCs (literal IDs at registration — Goja AST-walker requirement)
//    quizverse_blog_embed_create     session (ghost ok) → content → quiz + embed_id
//    quizverse_blog_embed_get        http_key/public    → cached quiz by embed_id
//    quizverse_embed_quiz_complete   http_key/public    → record pending coins (device)
//    quizverse_embed_claim_pending   session            → credit pending coins → wallet
//
//  Storage
//    qv_blog_embeds  / <embed_id>     (SYSTEM) — the generated quiz + metadata
//    qv_blog_embeds  / src_<hash>     (SYSTEM) — source-url dedup index → embed_id
//    qv_embed_pending / <device_id>   (SYSTEM) — per-device pending/claimed ledger
//
//  Env (must be in RUNTIME_ENV_KEYS to be visible via ctx.env):
//    ANTHROPIC_API_KEY and/or OPENAI_API_KEY — quiz generation LLM
//
//  Zero-defect notes: ES5 only (no arrow fns to registerRpc, no global mutable
//  state, no Node built-ins), build + restart required to load.
// ---------------------------------------------------------------------------

namespace BlogEmbed {

  var COLLECTION_EMBEDS  = "qv_blog_embeds";
  var COLLECTION_PENDING = "qv_embed_pending";

  // Economy: one blog quiz earns a fixed reward, once per device per embed
  // (lifetime), with a daily cap on distinct embeds to stop coin farming.
  var COINS_PER_EMBED    = 20;
  var MAX_EMBEDS_PER_DAY = 10;
  // Generation guardrails.
  var MIN_CONTENT_CHARS  = 200;
  var MAX_CONTENT_CHARS  = 12000;
  var MAX_QUESTIONS       = 8;
  var DEFAULT_QUESTIONS   = 5;
  var OPTIONS_PER_Q       = 4;

  // ── small helpers ─────────────────────────────────────────────────────────
  function nowSec(): number { return Math.floor(Date.now() / 1000); }
  function todayUtc(): string { return new Date().toISOString().slice(0, 10); }
  function startOfTodayUnix(): number {
    var d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  }
  function envStr(ctx: nkruntime.Context, key: string): string {
    return "" + ((ctx.env && ctx.env[key]) || "");
  }
  function clampInt(v: any, lo: number, hi: number, dflt: number): number {
    var n = parseInt("" + v, 10);
    if (!isFinite(n)) return dflt;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }
  function randId(prefix: string): string {
    return prefix + nowSec().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }
  // Cheap deterministic hash for the source-url dedup index (djb2).
  function hashStr(s: string): string {
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
  }
  function hostFromUrl(url: string): string {
    try {
      var m = ("" + url).match(/^https?:\/\/([^\/?#]+)/i);
      return m ? m[1].toLowerCase() : "";
    } catch (_e) { return ""; }
  }

  // ── quiz data shape (carries its own text — unlike the i18n /play embed) ────
  interface EmbedQuestion {
    id: string;
    prompt: string;
    options: string[];
    correctIndex: number;
    insight: string;
  }
  interface EmbedQuiz {
    embed_id: string;
    title: string;
    source_url: string;
    source_host: string;
    locale: string;
    questions: EmbedQuestion[];
    created_unix: number;
    created_by: string;          // ghost/user id that generated it
    plays: number;
  }

  // ── LLM call (Anthropic preferred, OpenAI fallback) ─────────────────────────
  // Returns the raw model text, or "" on any failure. Mirrors the provider
  // shapes used by ai_player.js so we stay consistent across the runtime.
  function callLlm(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, system: string, user: string): string {
    var anthropic = envStr(ctx, "ANTHROPIC_API_KEY");
    var openai = envStr(ctx, "OPENAI_API_KEY");
    var maxTokens = 2000;
    try {
      if (anthropic) {
        var ra = nk.httpRequest("https://api.anthropic.com/v1/messages", "post", {
          "Content-Type": "application/json",
          "x-api-key": anthropic,
          "anthropic-version": "2023-06-01"
        }, JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: maxTokens,
          system: system,
          messages: [{ role: "user", content: user }]
        }), 20000);
        if (ra && ra.code >= 200 && ra.code < 300 && ra.body) {
          var pa: any = JSON.parse(ra.body);
          if (pa && pa.content && pa.content.length > 0 && pa.content[0].text) {
            return "" + pa.content[0].text;
          }
        } else {
          logger.warn("[BlogEmbed] anthropic HTTP " + (ra ? ra.code : "?"));
        }
      }
      if (openai) {
        var ro = nk.httpRequest("https://api.openai.com/v1/chat/completions", "post", {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + openai
        }, JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        }), 20000);
        if (ro && ro.code >= 200 && ro.code < 300 && ro.body) {
          var po: any = JSON.parse(ro.body);
          if (po && po.choices && po.choices.length > 0 && po.choices[0].message) {
            return "" + po.choices[0].message.content;
          }
        } else {
          logger.warn("[BlogEmbed] openai HTTP " + (ro ? ro.code : "?"));
        }
      }
    } catch (err: any) {
      logger.error("[BlogEmbed] callLlm threw: " + (err && err.message ? err.message : String(err)));
    }
    return "";
  }

  // Extract the first JSON array from a model response (handles ```json fences).
  function parseQuestionsJson(text: string): any[] {
    if (!text) return [];
    var t = "" + text;
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1]) t = fence[1];
    var start = t.indexOf("[");
    var end = t.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    try {
      var arr = JSON.parse(t.slice(start, end + 1));
      return (arr && arr.length) ? arr : [];
    } catch (_e) { return []; }
  }

  // Coerce + validate raw model questions into safe EmbedQuestion records.
  function normalizeQuestions(raw: any[], want: number): EmbedQuestion[] {
    var out: EmbedQuestion[] = [];
    for (var i = 0; i < raw.length && out.length < want; i++) {
      var q = raw[i] || {};
      var prompt = "" + (q.prompt || q.question || "");
      var opts = q.options || q.choices || [];
      if (!prompt || !opts || opts.length !== OPTIONS_PER_Q) continue;
      var options: string[] = [];
      var ok = true;
      for (var j = 0; j < OPTIONS_PER_Q; j++) {
        var o = "" + (opts[j] || "");
        if (!o) { ok = false; break; }
        options.push(o);
      }
      if (!ok) continue;
      var ci = clampInt(q.correctIndex != null ? q.correctIndex : q.correct_index, 0, OPTIONS_PER_Q - 1, 0);
      out.push({
        id: "beq-" + (out.length + 1),
        prompt: prompt.slice(0, 400),
        options: options,
        correctIndex: ci,
        insight: ("" + (q.insight || q.explanation || "")).slice(0, 400)
      });
    }
    return out;
  }

  function generateQuiz(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, content: string, title: string, locale: string, want: number): EmbedQuestion[] {
    var system =
      "You are a quiz generator for QuizVerse. Given article content, write " + want +
      " engaging multiple-choice questions that test comprehension of the article. " +
      "Each question must have exactly " + OPTIONS_PER_Q + " options and one correct answer. " +
      "Write in locale '" + locale + "'. Respond ONLY with a JSON array; each item: " +
      '{"prompt": string, "options": [string x' + OPTIONS_PER_Q + '], "correctIndex": number (0-based), "insight": short explanation}.';
    var user = "ARTICLE TITLE: " + (title || "(untitled)") + "\n\nARTICLE CONTENT:\n" + content.slice(0, MAX_CONTENT_CHARS);
    var text = callLlm(ctx, logger, nk, system, user);
    return normalizeQuestions(parseQuestionsJson(text), want);
  }

  // ── RPC: quizverse_blog_embed_create ────────────────────────────────────────
  // Auth: any Nakama session (ghost ok — the generator page is open/no-login,
  // the browser already holds a device-id ghost session). Rate-limiting lives
  // in the Next.js /api/blog-quiz/generate route (per-IP).
  function rpcCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);

    var content = "" + (data.content || data.text || "");
    var url = "" + (data.url || "");
    var title = ("" + (data.title || "")).slice(0, 200);
    var locale = ("" + (data.locale || "en")).slice(0, 12);
    var want = clampInt(data.num_questions, 3, MAX_QUESTIONS, DEFAULT_QUESTIONS);

    if (content.length < MIN_CONTENT_CHARS) {
      return RpcHelpers.errorResponse("content too short — need at least " + MIN_CONTENT_CHARS + " characters of blog text", 400);
    }

    // Dedup: same source URL → return the existing embed (idempotent, saves LLM
    // spend and keeps one stable backlink target per blog post).
    if (url) {
      try {
        var idxKey = "src_" + hashStr(url.toLowerCase());
        var existing = Storage.readSystemJson<any>(nk, COLLECTION_EMBEDS, idxKey);
        if (existing && existing.embed_id) {
          var prev = Storage.readSystemJson<EmbedQuiz>(nk, COLLECTION_EMBEDS, existing.embed_id);
          if (prev && prev.questions && prev.questions.length > 0) {
            return RpcHelpers.successResponse({ embed_id: prev.embed_id, title: prev.title, quiz: prev, reused: true });
          }
        }
      } catch (_e: any) { /* fall through to generate */ }
    }

    var questions = generateQuiz(ctx, logger, nk, content, title, locale, want);
    if (!questions || questions.length === 0) {
      return RpcHelpers.errorResponse("quiz_generation_failed — AI did not return usable questions", 502);
    }

    var embedId = randId("be_");
    var quiz: EmbedQuiz = {
      embed_id: embedId,
      title: title || (hostFromUrl(url) ? ("Quiz: " + hostFromUrl(url)) : "Blog Quiz"),
      source_url: url,
      source_host: hostFromUrl(url),
      locale: locale,
      questions: questions,
      created_unix: nowSec(),
      created_by: userId,
      plays: 0
    };

    try {
      Storage.writeSystemJson(nk, COLLECTION_EMBEDS, embedId, quiz);
      if (url) {
        Storage.writeSystemJson(nk, COLLECTION_EMBEDS, "src_" + hashStr(url.toLowerCase()), { embed_id: embedId, created_unix: nowSec() });
      }
    } catch (err: any) {
      logger.error("[BlogEmbed] store failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("store_failed", 500);
    }

    return RpcHelpers.successResponse({ embed_id: embedId, title: quiz.title, quiz: quiz, reused: false });
  }

  // ── RPC: quizverse_blog_embed_get ────────────────────────────────────────────
  // Public (called server-to-server from /api/blog-quiz/[embedId] via http_key).
  // Returns the cached quiz so any reader on any partner site can play it.
  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var embedId = "" + (data.embed_id || "");
    if (!embedId) return RpcHelpers.errorResponse("embed_id required", 400);

    var quiz = Storage.readSystemJson<EmbedQuiz>(nk, COLLECTION_EMBEDS, embedId);
    if (!quiz || !quiz.questions) return RpcHelpers.errorResponse("embed not found", 404);

    // best-effort play counter
    try { quiz.plays = (quiz.plays | 0) + 1; Storage.writeSystemJson(nk, COLLECTION_EMBEDS, embedId, quiz); } catch (_e: any) { }

    return RpcHelpers.successResponse({
      embed_id: quiz.embed_id,
      title: quiz.title,
      locale: quiz.locale,
      source_host: quiz.source_host,
      coins_reward: COINS_PER_EMBED,
      questions: quiz.questions
    });
  }

  // ── pending coin ledger (per device, SYSTEM-owned) ──────────────────────────
  interface PendingLedger {
    device_id: string;
    pending_coins: number;
    claimed_coins: number;
    earned: { [embedId: string]: { coins: number; ts: number; host: string } };
    updated: number;
  }
  function readPending(nk: nkruntime.Nakama, deviceId: string): PendingLedger {
    try {
      var p = Storage.readSystemJson<PendingLedger>(nk, COLLECTION_PENDING, deviceId);
      if (p && p.earned) return p;
    } catch (_e: any) { }
    return { device_id: deviceId, pending_coins: 0, claimed_coins: 0, earned: {}, updated: 0 };
  }
  function countEarnedToday(ledger: PendingLedger): number {
    var start = startOfTodayUnix();
    var n = 0;
    for (var k in ledger.earned) {
      if (Object.prototype.hasOwnProperty.call(ledger.earned, k) && ledger.earned[k] && ledger.earned[k].ts >= start) n++;
    }
    return n;
  }

  // ── RPC: quizverse_embed_quiz_complete ───────────────────────────────────────
  // Public (server-to-server via http_key). Records pending coins for a device
  // after it finishes a blog quiz. Idempotent per (embed_id, device): a given
  // blog quiz rewards a given device once, ever. Daily cap on distinct embeds.
  function rpcComplete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var embedId = "" + (data.embed_id || "");
    var deviceId = "" + (data.device_id || "");
    var host = ("" + (data.host || "")).slice(0, 120);
    if (!embedId || !deviceId) return RpcHelpers.errorResponse("embed_id + device_id required", 400);

    // Embed must exist (don't mint coins for fabricated embed ids).
    var quiz = Storage.readSystemJson<EmbedQuiz>(nk, COLLECTION_EMBEDS, embedId);
    if (!quiz) return RpcHelpers.errorResponse("embed not found", 404);

    var ledger = readPending(nk, deviceId);

    if (ledger.earned[embedId]) {
      return RpcHelpers.successResponse({ pending_coins: ledger.pending_coins, credited: 0, skipped: "already_earned" });
    }
    if (countEarnedToday(ledger) >= MAX_EMBEDS_PER_DAY) {
      return RpcHelpers.successResponse({ pending_coins: ledger.pending_coins, credited: 0, skipped: "daily_cap" });
    }

    ledger.earned[embedId] = { coins: COINS_PER_EMBED, ts: nowSec(), host: host || quiz.source_host || "" };
    ledger.pending_coins = (ledger.pending_coins | 0) + COINS_PER_EMBED;
    ledger.updated = nowSec();
    try {
      Storage.writeSystemJson(nk, COLLECTION_PENDING, deviceId, ledger);
    } catch (err: any) {
      logger.error("[BlogEmbed] pending write failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("pending_write_failed", 500);
    }

    return RpcHelpers.successResponse({ pending_coins: ledger.pending_coins, credited: COINS_PER_EMBED, reward: COINS_PER_EMBED });
  }

  // ── RPC: quizverse_embed_claim_pending ───────────────────────────────────────
  // Auth: user session. Credits the device's pending coins into the caller's
  // Nakama wallet (native `coins`), then zeroes pending (one-time).
  //
  // Security model: the embed runs on a third-party site, so the player's
  // embed device-id differs from their app device-id. The high-entropy
  // device_id therefore acts as a one-time *bearer claim token* (like a gift
  // code) carried into the app via the CTA deep link. Whoever presents a valid
  // session + the token claims the balance once; pending is zeroed on claim so
  // it can't be double-spent. Stakes are low (soft currency, capped per day).
  function rpcClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var deviceId = "" + (data.device_id || "");
    if (!deviceId) return RpcHelpers.errorResponse("device_id required", 400);

    var ledger = readPending(nk, deviceId);
    var amount = ledger.pending_coins | 0;
    if (amount <= 0) {
      return RpcHelpers.successResponse({ credited: 0, pending_coins: 0, message: "nothing to claim" });
    }

    try {
      nk.walletUpdate(userId, { coins: amount }, { source: "blog_embed_claim", device_id: deviceId, claimed_at: nowSec() }, true);
    } catch (err: any) {
      logger.error("[BlogEmbed] walletUpdate failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("wallet_credit_failed", 500);
    }

    ledger.claimed_coins = (ledger.claimed_coins | 0) + amount;
    ledger.pending_coins = 0;
    ledger.updated = nowSec();
    try { Storage.writeSystemJson(nk, COLLECTION_PENDING, deviceId, ledger); } catch (_e: any) { /* coins already granted; best-effort */ }

    return RpcHelpers.successResponse({ credited: amount, pending_coins: 0, currency: "coins", claimed_total: ledger.claimed_coins });
  }

  // ── Registration ──────────────────────────────────────────────────────────────
  export function register(initializer: nkruntime.Initializer): void {
    // withCleanAuthError wraps a handler once at registration time, but when
    // register() is auto-invoked at IIFE scope by the postbuild script,
    // RpcHelpers may not be initialised yet — it lives in a later IIFE and load
    // order is case-sensitive on Linux. An eager RpcHelpers.withCleanAuthError(...)
    // here would throw at startup and take down the entire JS runtime (see the
    // hermes.ts / quests/quest_engine.ts incident). Use a lazy wrapper so the
    // wrap is deferred to first-call time, by which point RpcHelpers exists.
    type StrictRpc = (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) => string;
    function auth(fn: nkruntime.RpcFunction): nkruntime.RpcFunction {
      var wrapped: StrictRpc | null = null;
      return function(ctx, logger, nk, payload): string {
        if (!wrapped) {
          const strictFn = fn as StrictRpc;
          wrapped = (typeof RpcHelpers !== "undefined" && RpcHelpers.withCleanAuthError)
            ? RpcHelpers.withCleanAuthError(strictFn)
            : strictFn;
        }
        return wrapped(ctx, logger, nk, payload);
      };
    }
    // Literal RPC IDs — Goja AST walker cannot resolve namespaced constants.
    initializer.registerRpc("quizverse_blog_embed_create", auth(rpcCreate));
    initializer.registerRpc("quizverse_blog_embed_get", rpcGet);
    initializer.registerRpc("quizverse_embed_quiz_complete", rpcComplete);
    initializer.registerRpc("quizverse_embed_claim_pending", auth(rpcClaim));
  }
}
