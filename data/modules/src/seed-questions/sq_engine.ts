// sq_engine.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seed Questions — pool management + per-user staging engine.
//
// Pool:    ingestIntoPool() QA-gates connector output and merges it (by stable
//          content-hash id) into the system pool for (mode, topic).
//
// Staging: ensureStaged() guarantees a user always has TARGET_READY_SETS
//          (2–3) ready sets for (mode, topic):
//            unseen-only  → excludes qv_seen ledger ids + already-staged ids
//            quality-only → excludes quarantined ids (user-review ledger)
//            adaptive     → 60% at the user's target difficulty, 20% one
//                           easier, 20% one harder (from quiz history)
//            recycle      → when the unseen pool runs dry, oldest-seen
//                           questions are recycled (flagged) instead of
//                           starving the client — mirrors quizverse_quiz_generate.

namespace SeedQEngine {

  // ── Pool ────────────────────────────────────────────────────────────────────
  export function readPool(nk: nkruntime.Nakama, mode: string, topic: string): any {
    return SeedQ.readSystem(nk, SeedQ.COLL_POOL, SeedQ.poolKey(mode, topic)) || { questions: [], updated_ms: 0 };
  }

  function indexPoolKey(nk: nkruntime.Nakama, mode: string, topic: string): void {
    var idx = SeedQ.readSystem(nk, SeedQ.COLL_POOL_INDEX, "index") || { keys: {} };
    if (!idx.keys) idx.keys = {};
    var key = SeedQ.poolKey(mode, topic);
    if (!idx.keys[key]) {
      idx.keys[key] = { mode: mode, topic: topic, added_ms: SeedQ.nowMs() };
      SeedQ.writeSystem(nk, SeedQ.COLL_POOL_INDEX, "index", idx);
    }
  }

  export function ingestIntoPool(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    mode: string,
    topic: string,
    candidates: SeedQ.SeedQuestion[]
  ): { accepted: number; rejected: number; duplicates: number; pool_size: number } {
    var pool = readPool(nk, mode, topic);
    var existing: { [id: string]: boolean } = {};
    for (var i = 0; i < pool.questions.length; i++) existing[pool.questions[i].id] = true;

    var accepted = 0, rejected = 0, duplicates = 0;
    for (var c = 0; c < candidates.length; c++) {
      var q = candidates[c];
      if (!q || !q.id) { rejected++; continue; }
      if (existing[q.id]) { duplicates++; continue; }

      // Provenance for media questions that arrived unchecked.
      if (q.media_url && (!q.media_provenance || !q.media_provenance.checked)) {
        q.media_provenance = SeedQQuality.checkProvenance(ctx, nk, logger, q.media_url);
      }

      var qa = SeedQQuality.autoQa(q);
      q.quality = qa;
      if (qa.status !== "approved") { rejected++; continue; }

      existing[q.id] = true;
      pool.questions.push(q);
      accepted++;
    }

    // Rolling cap: keep the newest POOL_MAX_QUESTIONS.
    if (pool.questions.length > SeedQ.POOL_MAX_QUESTIONS) {
      pool.questions = pool.questions.slice(pool.questions.length - SeedQ.POOL_MAX_QUESTIONS);
    }
    pool.updated_ms = SeedQ.nowMs();
    SeedQ.writeSystem(nk, SeedQ.COLL_POOL, SeedQ.poolKey(mode, topic), pool);
    indexPoolKey(nk, mode, topic);

    return { accepted: accepted, rejected: rejected, duplicates: duplicates, pool_size: pool.questions.length };
  }

  // ── Adaptive selection ──────────────────────────────────────────────────────
  // Buckets candidates by |difficulty - target| and drains them in the
  // 60/20/20 mix so the set is challenging-but-winnable for THIS user.
  function selectAdaptive(candidates: SeedQ.SeedQuestion[], target: number, n: number): SeedQ.SeedQuestion[] {
    var atTarget: SeedQ.SeedQuestion[] = [];
    var easier: SeedQ.SeedQuestion[] = [];
    var harder: SeedQ.SeedQuestion[] = [];
    var rest: SeedQ.SeedQuestion[] = [];

    for (var i = 0; i < candidates.length; i++) {
      var d = candidates[i].difficulty || 3;
      if (d === target) atTarget.push(candidates[i]);
      else if (d === target - 1) easier.push(candidates[i]);
      else if (d === target + 1) harder.push(candidates[i]);
      else rest.push(candidates[i]);
    }
    SeedQ.shuffle(atTarget); SeedQ.shuffle(easier); SeedQ.shuffle(harder); SeedQ.shuffle(rest);

    var wantTarget = Math.ceil(n * 0.6);
    var wantEasier = Math.ceil(n * 0.2);
    var out: SeedQ.SeedQuestion[] = [];
    out = out.concat(atTarget.slice(0, wantTarget));
    out = out.concat(easier.slice(0, wantEasier));
    out = out.concat(harder.slice(0, n - out.length));
    // Backfill from whatever remains, nearest first.
    if (out.length < n) out = out.concat(atTarget.slice(wantTarget));
    if (out.length < n) out = out.concat(easier.slice(wantEasier));
    if (out.length < n) out = out.concat(rest);
    out = out.slice(0, n);
    return SeedQ.shuffle(out);
  }

  // ── Staging ─────────────────────────────────────────────────────────────────
  // Low-watermark for Dynamic Replenishment (Deliverable 1 §3.1): when a user's
  // unseen pool drops below this, we queue a priority ingest combo so the next
  // cron tick replenishes THIS (mode, topic) first.
  var LOW_WATERMARK = 20;
  var NEXT_REFRESH_ETA_SEC = 900; // seedq ingest cron cadence (15 min)

  export interface StageResult {
    doc: any;
    ready: SeedQ.StagedSet[];
    built: number;
    pool_size: number;
    pool_available: number;
    recycled: boolean;
    pool_exhausted: boolean;
    content_generation_queued: boolean;
    next_refresh_eta_sec: number;
    fresh_count: number;
    review_count: number;
    adaptive: SeedQ.AdaptiveProfile;
  }

  // Queues a (mode, topic) combo at the FRONT of the ingest rotation. The next
  // ingestTick drains priority entries before resuming the round-robin cursor —
  // this is the Nakama-side equivalent of the `topic_exhaustion_warning` →
  // ContentX flow from the Repetition Fatigue plan.
  export function queuePriorityCombo(nk: nkruntime.Nakama, logger: nkruntime.Logger, mode: string, topic: string): void {
    try {
      var state = SeedQ.readSystem(nk, SeedQ.COLL_INGEST_STATE, "state") || { cursor: 0, runs: 0, last_run_ms: 0, combos: null };
      if (!state.priority) state.priority = [];
      for (var i = 0; i < state.priority.length; i++) {
        if (state.priority[i].mode === mode && state.priority[i].topic === topic) return; // already queued
      }
      // Pick the best-matching source from the combo matrix (same mode wins,
      // then same topic); archive_org is the broadest fallback connector.
      var combos = (state.combos && state.combos.length > 0) ? state.combos : defaultCombos();
      var source = "archive_org";
      for (var c = 0; c < combos.length; c++) {
        if (combos[c].mode === mode) { source = combos[c].source; break; }
        if (SeedQ.slugify(combos[c].topic) === SeedQ.slugify(topic)) source = combos[c].source;
      }
      state.priority.push({ source: source, mode: mode, topic: topic, queued_ms: SeedQ.nowMs() });
      if (state.priority.length > 20) state.priority = state.priority.slice(state.priority.length - 20);
      SeedQ.writeSystem(nk, SeedQ.COLL_INGEST_STATE, "state", state);
      logger.info("[SeedQ] priority replenishment queued: " + source + " → " + mode + "/" + topic);
    } catch (e: any) {
      logger.warn("[SeedQ] queuePriorityCombo failed: " + (e && e.message ? e.message : String(e)));
    }
  }

  export function ensureStaged(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    mode: string,
    topic: string,
    wantSets: number,
    setSize: number
  ): StageResult {
    var key = SeedQ.poolKey(mode, topic);
    var doc = SeedQ.readUser(nk, SeedQ.COLL_STAGED, key, userId) || { sets: [], updated_ms: 0 };
    if (!doc.sets) doc.sets = [];

    // Drop consumed sets past their TTL so the doc never balloons.
    var now = SeedQ.nowMs();
    var kept: SeedQ.StagedSet[] = [];
    for (var i = 0; i < doc.sets.length; i++) {
      var s = doc.sets[i];
      if (s.status === "consumed" && (now - (s.consumed_ms || 0)) > SeedQ.CONSUMED_SET_TTL_MS) continue;
      kept.push(s);
    }
    doc.sets = kept;

    // Exclude only questions sitting in READY sets. Consumed questions live in
    // the qv_seen ledger already — they must stay eligible for the recycle path
    // (D1: "recycle oldest-seen rather than starve"), otherwise an exhausted
    // user gets zero sets until the consumed-set TTL expires.
    var ready: SeedQ.StagedSet[] = [];
    var stagedIds: { [id: string]: boolean } = {};
    for (var r = 0; r < doc.sets.length; r++) {
      var st = doc.sets[r];
      if (st.status !== "ready") continue;
      for (var qi = 0; qi < st.question_ids.length; qi++) stagedIds[st.question_ids[qi]] = true;
      ready.push(st);
    }

    var adaptive = SeedQ.computeAdaptiveProfile(nk, userId, topic);
    var pool = readPool(nk, mode, topic);
    var built = 0;
    var recycled = false;
    var poolAvailable = 0;
    var seenIds = SeedQ.getSeenIdSet(nk, userId, mode, topic);
    var quarantined = SeedQQuality.getQuarantineSet(nk, mode, topic);

    // Always compute the per-user unseen supply — repeat_policy metadata (D1
    // §6.2) needs it even when no new sets are built this call.
    var unseen: SeedQ.SeedQuestion[] = [];
    var seenPool: SeedQ.SeedQuestion[] = [];
    for (var p = 0; p < pool.questions.length; p++) {
      var q = pool.questions[p];
      if (!q || quarantined[q.id] || stagedIds[q.id]) continue;
      if (q.quality && q.quality.status !== "approved") continue;
      if (seenIds[q.id]) seenPool.push(q);
      else unseen.push(q);
    }
    poolAvailable = unseen.length;

    if (ready.length < wantSets && pool.questions.length > 0) {
      while (ready.length < wantSets) {
        var candidates = unseen;
        if (candidates.length < setSize && seenPool.length > 0) {
          // Pool exhausted for this user → recycle oldest-seen rather than starve.
          candidates = unseen.concat(seenPool);
          recycled = true;
        }
        if (candidates.length < Math.min(setSize, 4)) break; // not enough content, even recycled

        var chosen = selectAdaptive(candidates, adaptive.target_difficulty, setSize);
        if (chosen.length === 0) break;

        // Remove chosen from future candidate lists.
        var chosenIds: { [id: string]: boolean } = {};
        var ids: string[] = [];
        var served: SeedQ.SeedQuestion[] = [];
        var setFresh = 0, setReview = 0;
        for (var ci = 0; ci < chosen.length; ci++) {
          chosenIds[chosen[ci].id] = true;
          ids.push(chosen[ci].id);
          // Serve a copy with the media URL optimized (squoosh-equivalent).
          var copy = JSON.parse(JSON.stringify(chosen[ci]));
          copy.media_url = SeedQ.optimizeMediaUrl(copy.media_url);
          // Honest-repeat disclosure (D1 §6.2): mark recycled questions so the
          // client renders "N new + M Smart Review repeats", never a silent repeat.
          if (seenIds[copy.id]) { copy.recycled = true; setReview++; }
          else setFresh++;
          served.push(copy);
        }
        var nextUnseen: SeedQ.SeedQuestion[] = [];
        for (var ui = 0; ui < unseen.length; ui++) if (!chosenIds[unseen[ui].id]) nextUnseen.push(unseen[ui]);
        unseen = nextUnseen;
        var nextSeenPool: SeedQ.SeedQuestion[] = [];
        for (var si = 0; si < seenPool.length; si++) if (!chosenIds[seenPool[si].id]) nextSeenPool.push(seenPool[si]);
        seenPool = nextSeenPool;

        var newSet: SeedQ.StagedSet = {
          set_id: "set_" + now.toString(36) + "_" + SeedQ.randSuffix(),
          mode: mode,
          topic: topic,
          status: "ready",
          difficulty_target: adaptive.target_difficulty,
          question_ids: ids,
          questions: served,
          fresh_count: setFresh,
          review_count: setReview,
          created_ms: now,
          consumed_ms: 0
        };
        doc.sets.push(newSet);
        ready.push(newSet);
        for (var ni = 0; ni < ids.length; ni++) stagedIds[ids[ni]] = true;
        built++;
      }
    }

    if (built > 0 || kept.length !== doc.sets.length) {
      doc.updated_ms = now;
      SeedQ.writeUser(nk, SeedQ.COLL_STAGED, key, userId, doc);
    }

    // Aggregate honest-repeat counts over the ready sets (repeat_policy §6.2).
    var freshTotal = 0, reviewTotal = 0;
    for (var rc2 = 0; rc2 < ready.length; rc2++) {
      var rs: any = ready[rc2];
      if (rs.fresh_count !== undefined) { freshTotal += rs.fresh_count; reviewTotal += rs.review_count || 0; }
      else freshTotal += rs.question_ids.length; // pre-metadata sets: assume fresh
    }

    // Deliverable 1 — Dynamic Replenishment + the "Wow" Intercept.
    // Exhausted for this user = the pool has content but nothing unseen is
    // left (we're recycling or couldn't build at all).
    var exhausted = pool.questions.length > 0 && poolAvailable === 0 && (recycled || ready.length === 0);
    var generationQueued = false;
    var QUEUE_COOLDOWN_MS = 5 * 60 * 1000;
    var lastQueueMs = doc.last_replenish_queue_ms || 0;
    if (poolAvailable < LOW_WATERMARK && (now - lastQueueMs) >= QUEUE_COOLDOWN_MS) {
      queuePriorityCombo(nk, logger, mode, topic);
      doc.last_replenish_queue_ms = now;
      generationQueued = true;
      SeedQ.writeUser(nk, SeedQ.COLL_STAGED, key, userId, doc);
    }
    if (exhausted) {
      // "You beat the game" — queue the wow.e.pool_exhausted Aahaa moment and
      // suppress the App Store rating prompt (never ask while exhausted).
      AahaaEngine.notePoolExhausted(nk, logger, userId, mode, topic);
    }

    return {
      doc: doc,
      ready: ready,
      built: built,
      pool_size: pool.questions.length,
      pool_available: poolAvailable,
      recycled: recycled,
      pool_exhausted: exhausted,
      content_generation_queued: generationQueued,
      next_refresh_eta_sec: generationQueued ? NEXT_REFRESH_ETA_SEC : 0,
      fresh_count: freshTotal,
      review_count: reviewTotal,
      adaptive: adaptive
    };
  }

  // Marks a set consumed and merges its ids into the qv_seen ledger — this is
  // what enforces "never the same question for the same user-id" across ALL
  // QuizVerse delivery paths that share the seedq scope.
  export function consumeSet(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    mode: string,
    topic: string,
    setId: string
  ): { found: boolean; merged: number } {
    var key = SeedQ.poolKey(mode, topic);
    var doc = SeedQ.readUser(nk, SeedQ.COLL_STAGED, key, userId);
    if (!doc || !doc.sets) return { found: false, merged: 0 };

    for (var i = 0; i < doc.sets.length; i++) {
      var s = doc.sets[i];
      if (s.set_id !== setId) continue;
      if (s.status === "consumed") return { found: true, merged: 0 };
      s.status = "consumed";
      s.consumed_ms = SeedQ.nowMs();
      // Consumed sets keep ids (dedup) but drop full question bodies (size).
      s.questions = [];
      doc.updated_ms = SeedQ.nowMs();
      SeedQ.writeUser(nk, SeedQ.COLL_STAGED, key, userId, doc);
      SeedQ.mergeSeenIds(nk, userId, mode, topic, s.question_ids);
      return { found: true, merged: s.question_ids.length };
    }
    return { found: false, merged: 0 };
  }

  // ── Cron ingest rotation ────────────────────────────────────────────────────
  // Default matrix of (source, mode, topic) combos the tick rotates through.
  // Live-ops can extend it by writing sq_ingest_state.combos.
  export function defaultCombos(): any[] {
    return [
      { source: "archive_org", mode: "ImageGuess", topic: "history" },
      { source: "archive_org", mode: "WhosThat", topic: "portraits" },
      { source: "archive_org", mode: "GeoExplore", topic: "maps" },
      { source: "archive_org", mode: "MediaQuiz", topic: "film" },
      { source: "wolfram", mode: "CustomTopic", topic: "math" },
      { source: "wolfram", mode: "BrainSprint", topic: "arithmetic" },
      { source: "gutenberg", mode: "CustomTopic", topic: "literature" },
      { source: "gutenberg", mode: "PickATopic", topic: "history" },
      { source: "music_tv", mode: "MediaQuiz", topic: "music" },
      { source: "music_tv", mode: "AudioQuiz", topic: "music" },
      { source: "scholar", mode: "CustomTopic", topic: "science" },
      { source: "scholar", mode: "SubjectiveQuiz", topic: "psychology" },
      { source: "justwatch", mode: "ViralIQ", topic: "trending" }
    ];
  }

  export function ingestTick(ctx: nkruntime.Context, nk: nkruntime.Nakama, logger: nkruntime.Logger, batchCombos: number, perComboCount: number): any {
    var tickStarted = SeedQ.nowMs();
    var TICK_BUDGET_MS = 25000;
    var state = SeedQ.readSystem(nk, SeedQ.COLL_INGEST_STATE, "state") || { cursor: 0, runs: 0, last_run_ms: 0, combos: null };
    var combos = (state.combos && state.combos.length > 0) ? state.combos : defaultCombos();

    var results: any[] = [];
    var rotationSlots = batchCombos;

    // Drain user-triggered priority replenishment (low-watermark / exhaustion)
    // BEFORE the round-robin rotation — exhausted pools refill first.
    if (state.priority && state.priority.length > 0) {
      var stillQueued: any[] = [];
      for (var pq = 0; pq < state.priority.length; pq++) {
        var pcombo = state.priority[pq];
        if (rotationSlots <= 0) { stillQueued.push(pcombo); continue; }
        rotationSlots--;
        try {
          var pFetched = SeedQSources.fetchQuestions(ctx, nk, logger, pcombo.source, pcombo.mode, pcombo.topic, perComboCount, pcombo.params || {});
          var pRes = ingestIntoPool(ctx, nk, logger, pcombo.mode, pcombo.topic, pFetched);
          results.push({ combo: pcombo, priority: true, fetched: pFetched.length, accepted: pRes.accepted, rejected: pRes.rejected, duplicates: pRes.duplicates, pool_size: pRes.pool_size });
        } catch (perr: any) {
          results.push({ combo: pcombo, priority: true, error: (perr && perr.message) ? perr.message : String(perr) });
        }
      }
      state.priority = stillQueued;
    }

    for (var b = 0; b < rotationSlots; b++) {
      if (SeedQ.nowMs() - tickStarted > TICK_BUDGET_MS) {
        logger.warn("[SeedQ] ingestTick time budget reached after " + results.length + " combos");
        break;
      }
      var combo = combos[(state.cursor + b) % combos.length];
      try {
        var fetched = SeedQSources.fetchQuestions(ctx, nk, logger, combo.source, combo.mode, combo.topic, perComboCount, combo.params || {});
        var res = ingestIntoPool(ctx, nk, logger, combo.mode, combo.topic, fetched);
        results.push({ combo: combo, fetched: fetched.length, accepted: res.accepted, rejected: res.rejected, duplicates: res.duplicates, pool_size: res.pool_size });
      } catch (err: any) {
        results.push({ combo: combo, error: (err && err.message) ? err.message : String(err) });
      }
    }

    state.cursor = (state.cursor + rotationSlots) % combos.length;
    state.runs = (state.runs || 0) + 1;
    state.last_run_ms = SeedQ.nowMs();
    SeedQ.writeSystem(nk, SeedQ.COLL_INGEST_STATE, "state", state);

    return { cursor: state.cursor, runs: state.runs, combo_count: combos.length, results: results };
  }
}
