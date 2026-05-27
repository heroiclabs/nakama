// =============================================================================
// crons.ts — Tournament background jobs
//
// Plan ref: §1G pre-gen + §2 settlement + §1H eliminate cron
//
// Crons are tick-based (Nakama has no native cron; we use a single-shot
// "scheduler tick" RPC that ops invokes via http_key, OR auto-invoke from
// the existing AnalyticsAlerts opportunistic scheduler).
//
// Jobs:
//   open_pending     — flips PRE_ENROLL → OPEN when public_open_time hits
//   eliminate_round  — runs at each elimination cut time per cfg schedule
//   settle_finished  — runs after cfg.end_iso elapsed → calls settle()
//   pregenerate_content — slow drip of CF pack generation during pre-enrollment
//   referral_settle  — one-shot on Jul 1 to freeze referral leaderboard prizes
// =============================================================================

namespace TournamentCrons {

  function nowSec(): number { return Math.floor(Date.now() / 1000); }
  function isoToUnix(iso: string): number { return Math.floor(new Date(iso).getTime() / 1000); }
  function unixToIso(ts: number): string { return new Date(ts * 1000).toISOString(); }

  // B6 fix: opportunistic tick — runs at most once per 60s globally.
  // Called from high-traffic read RPCs (tournament_list / tournament_get) so
  // the lifecycle advances without needing an external scheduler. The 60s
  // gate is keyed on a system-owned storage row so concurrent requests
  // dedupe across nodes.
  const OPPORTUNISTIC_TICK_GATE_KEY = "opportunistic_tick_gate";
  const OPPORTUNISTIC_TICK_INTERVAL_SEC = 60;

  export function opportunisticTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): boolean {
    var now = nowSec();
    var lastRanAt = 0;
    try {
      var rows = nk.storageRead([{
        collection: "tournament_cron_state",
        key: OPPORTUNISTIC_TICK_GATE_KEY,
        userId: Constants.SYSTEM_USER_ID,
      }]);
      if (rows && rows.length > 0) {
        var v: any = rows[0].value;
        if (v && typeof v.last_ran_at === "number") lastRanAt = v.last_ran_at;
      }
    } catch (_) { }
    if (now - lastRanAt < OPPORTUNISTIC_TICK_INTERVAL_SEC) return false;
    // Mark BEFORE running so concurrent callers don't double-fire.
    try {
      nk.storageWrite([{
        collection: "tournament_cron_state",
        key: OPPORTUNISTIC_TICK_GATE_KEY,
        userId: Constants.SYSTEM_USER_ID,
        value: { last_ran_at: now },
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (_) { }
    try { tick(ctx, logger, nk); } catch (e: any) {
      logger.warn("[TournamentCron] opportunistic tick failed: " + (e && e.message));
    }
    return true;
  }

  // B8 fix: daily tournaments (open_start_iso → end_iso window ≤ 25h) get
  // rolled forward when they settle. We shift open_start_iso + end_iso
  // forward by one day, reset pot to seed, reset entries_count, bump a
  // daily_instance counter, and put status back to OPEN. Old leaderboard
  // records stay (preserve history); the cron also rotates the active
  // leaderboard ID via daily_instance suffix.
  function isDailyTournament(cfg: TournamentEconomy.TournamentConfig): boolean {
    var span = isoToUnix(cfg.end_iso) - isoToUnix(cfg.open_start_iso);
    return span > 0 && span <= 25 * 3600;
  }

  function rollDailyForward(nk: nkruntime.Nakama, cfg: TournamentEconomy.TournamentConfig, meta: TournamentsStorage.MetaRow): TournamentsStorage.MetaRow {
    var now = nowSec();
    var anyMeta: any = meta;
    var prevWindowEnd = isoToUnix(anyMeta.window_end_iso || cfg.end_iso);
    var newOpenIso = unixToIso(prevWindowEnd + 1);                // start where prev ended
    var newEndIso = unixToIso(prevWindowEnd + 24 * 3600);          // 24h window
    anyMeta.window_open_iso = newOpenIso;
    anyMeta.window_end_iso = newEndIso;
    anyMeta.daily_instance = (anyMeta.daily_instance || 1) + 1;
    meta.status = "OPEN";
    meta.pot_bc = cfg.pot_seed_bc | 0;
    meta.entries_count = 0;
    // Pre-enroll count carries over (founder ranks are sticky to the slug).
    TournamentsStorage.writeMeta(nk, cfg.slug, meta);
    return meta;
  }

  // Single-tick driver: walks every slate config, advances any whose schedule
  // has elapsed.
  export function tick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): any {
    var slate = TournamentEconomy.listAll();
    var now = nowSec();
    var actions: any[] = [];

    for (var i = 0; i < slate.length; i++) {
      var cfg = slate[i];
      var meta = TournamentsStorage.readMeta(nk, cfg.slug);
      if (!meta) {
        meta = TournamentsStorage.seedFromConfig(nk, cfg);
        actions.push({ slug: cfg.slug, action: "seeded" });
        continue;
      }

      // PRE_ENROLL → OPEN transition
      if (meta.status === "PRE_ENROLL" && now >= isoToUnix(cfg.open_start_iso)) {
        meta.status = "OPEN";
        // Initialize daily window tracking (B8): the first window matches
        // the cfg dates; daily roll-forward will then update on settle.
        var anyMetaInit: any = meta;
        if (!anyMetaInit.window_open_iso) anyMetaInit.window_open_iso = cfg.open_start_iso;
        if (!anyMetaInit.window_end_iso)  anyMetaInit.window_end_iso  = cfg.end_iso;
        TournamentsStorage.writeMeta(nk, cfg.slug, meta);
        TournamentLeaderboard.ensureLeaderboard(nk, cfg.slug, null, 0);
        // Bracket shell — ONLY for elimination format (gate fix). Classic
        // and pick_n don't have head-to-head matches, so a bracket would
        // be useless and pollutes the Bracket service dashboard.
        if (cfg.format === "elimination") {
          try {
            var br = BracketClient.createBracketShell(ctx, nk, cfg.slug, cfg.name, 64);
            if (br.ok && br.bracket_id) {
              (meta as any).bracket_id = br.bracket_id;
              TournamentsStorage.writeMeta(nk, cfg.slug, meta);
            }
          } catch (_) { }
        }
        actions.push({ slug: cfg.slug, action: "opened" });
        continue;
      }

      // OPEN → ACTIVE (cosmetic transition once first entry lands; here we
      // just leave OPEN — we don't differentiate today). Skipped.

      // Eliminate-round trigger
      if (cfg.format === "elimination" && cfg.elimination_schedule && meta.status === "OPEN") {
        var cuts = cfg.elimination_schedule.cut_times_utc || [];
        for (var c = 0; c < cuts.length; c++) {
          var cutAt = isoToUnix(cuts[c]);
          if (now < cutAt) continue;
          // Idempotency: skip if we've already processed this round
          var roundKey = "elim_round_done_" + cfg.slug + "_" + c;
          var existing = nk.storageRead([{ collection: TournamentsStorage.COL_ELIMINATIONS, key: roundKey, userId: Constants.SYSTEM_USER_ID }]);
          if (existing && existing.length > 0) continue;
          var elim = TournamentSettlement.eliminateRound(ctx, logger, nk, cfg.slug, c + 1);
          nk.storageWrite([{
            collection: TournamentsStorage.COL_ELIMINATIONS,
            key: roundKey,
            userId: Constants.SYSTEM_USER_ID,
            value: { slug: cfg.slug, round: c + 1, ran_at: now, result: elim },
            permissionRead: 0,
            permissionWrite: 0,
          }]);
          actions.push({ slug: cfg.slug, action: "eliminated_round", round: c + 1, result: elim });

          // Bracket handoff (plan §3): at the FIRST cut, seed top-64 into the
          // Bracket service. On every subsequent cut, advance the bracket
          // by one round (postMatchResult for every match in the open
          // round). Both calls are idempotent against bracket_seeded_at /
          // bracket_round on the meta row.
          var bMetaAny: any = TournamentsStorage.readMeta(nk, cfg.slug) || {};
          var bracketId = bMetaAny.bracket_id;
          if (bracketId) {
            if (c === 0 && !bMetaAny.bracket_seeded_at) {
              // First cut → seed players
              var lb = TournamentLeaderboard.listTop(nk, cfg.slug, 64, null);
              var lbRecs = (lb && lb.records) ? lb.records : [];
              var seedPlayers: { user_id: string; username: string; seed_score: number }[] = [];
              for (var pi = 0; pi < lbRecs.length; pi++) {
                var lbr = lbRecs[pi];
                seedPlayers.push({
                  user_id: lbr.ownerId || "",
                  username: lbr.username || ("Player_" + (pi + 1)),
                  seed_score: lbr.score | 0,
                });
              }
              if (seedPlayers.length > 0) {
                var seed = BracketClient.seedPlayers(ctx, nk, bracketId, seedPlayers);
                if (seed.ok) {
                  bMetaAny.bracket_seeded_at = now;
                  bMetaAny.bracket_seeded_count = seedPlayers.length;
                  var rds = 1, nn = seedPlayers.length;
                  while (nn > 1) { rds++; nn = Math.ceil(nn / 2); }
                  if (rds > 6) rds = 6;
                  bMetaAny.bracket_total_rounds = rds;
                  bMetaAny.bracket_round = 1;
                  TournamentsStorage.writeMeta(nk, cfg.slug, bMetaAny);
                  actions.push({ slug: cfg.slug, action: "bracket_seeded", count: seedPlayers.length, rounds: rds });
                } else {
                  actions.push({ slug: cfg.slug, action: "bracket_seed_failed", error: seed.error });
                }
              }
            } else if (c > 0 && bMetaAny.bracket_seeded_at) {
              // Subsequent cut → advance bracket round via S2S to Bracket
              var st = BracketClient.getBracketState(ctx, nk, bracketId);
              if (st.ok && st.state) {
                var bState: any = st.state;
                var bMatches: any[] = bState.current_round_matches || bState.matches || [];
                var advancedCount = 0;
                for (var mi = 0; mi < bMatches.length; mi++) {
                  var bm = bMatches[mi];
                  var bMatchId = "" + (bm.id || bm.match_id || "");
                  if (!bMatchId || bm.winner_user_id || bm.status === "COMPLETED") continue;
                  var bp1 = "" + (bm.player1_user_id || (bm.players && bm.players[0] && bm.players[0].user_id) || "");
                  var bp2 = "" + (bm.player2_user_id || (bm.players && bm.players[1] && bm.players[1].user_id) || "");
                  if (!bp1 || !bp2) continue;
                  var bs1 = 0, bs2 = 0;
                  try {
                    var rec2 = nk.leaderboardRecordsList(TournamentLeaderboard.lbId(cfg.slug), [bp1, bp2], 2, undefined);
                    for (var rrr = 0; rrr < (rec2.records || []).length; rrr++) {
                      var rrow2: any = rec2.records[rrr];
                      if (rrow2.ownerId === bp1) bs1 = rrow2.score | 0;
                      if (rrow2.ownerId === bp2) bs2 = rrow2.score | 0;
                    }
                  } catch (_) { }
                  var bwinner = bs1 >= bs2 ? bp1 : bp2;
                  var post = BracketClient.postMatchResult(ctx, nk, bracketId, bMatchId, bwinner, { p1: bs1, p2: bs2 });
                  if (post.ok) advancedCount++;
                }
                if (advancedCount > 0) {
                  bMetaAny.bracket_round = (bMetaAny.bracket_round || 1) + 1;
                  TournamentsStorage.writeMeta(nk, cfg.slug, bMetaAny);
                  actions.push({ slug: cfg.slug, action: "bracket_advanced", round: bMetaAny.bracket_round, matches: advancedCount });
                }
              }
            }
          }
        }
      }

      // End → SETTLING → SETTLED transition (uses the current daily window
      // when present, else falls back to cfg.end_iso).
      var anyMetaForEnd: any = meta;
      var effectiveEndIso = anyMetaForEnd.window_end_iso || cfg.end_iso;
      if ((meta.status === "OPEN" || meta.status === "ACTIVE") && now >= isoToUnix(effectiveEndIso)) {
        var res = TournamentSettlement.settle(ctx, logger, nk, cfg.slug);
        actions.push({ slug: cfg.slug, action: "settled", result: res });

        // B8: daily tournaments roll forward into the next 24h window so
        // gk-royale-daily / pick-5-daily don't go dark after Jul 1.
        if (isDailyTournament(cfg)) {
          var reloaded = TournamentsStorage.readMeta(nk, cfg.slug);
          if (reloaded && reloaded.status === "SETTLED") {
            var rolled = rollDailyForward(nk, cfg, reloaded);
            actions.push({
              slug: cfg.slug,
              action: "daily_rolled_forward",
              new_window_open_iso: (rolled as any).window_open_iso,
              new_window_end_iso: (rolled as any).window_end_iso,
              daily_instance: (rolled as any).daily_instance,
            });
          }
        }
        continue;
      }
    }

    return { ok: true, actions: actions, ran_at: now };
  }

  // Pre-generation drip job. Walks (slug × language × weekNum) combinations
  // and enqueues CF pack generation for the first N missing entries.
  // Called by ops on a slow timer (every 30s = 1 pack/30s); fits 1248-pack
  // budget into the 35-day pre-enrollment window comfortably.
  export function pregenerateTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, maxJobs: number): any {
    var slate = TournamentEconomy.listAll();
    var langs = ["en", "es", "hi", "pt", "fr", "de", "ja", "ko", "zh", "ar", "ru", "id"];
    var weeksAhead = 4;
    var enqueued: any[] = [];

    for (var i = 0; i < slate.length && enqueued.length < maxJobs; i++) {
      var cfg = slate[i];
      var topic = TournamentTopicCatalog.getEntry(cfg.topic_tag);
      if (!topic) continue;
      var allowedLangs = topic.languages_supported || ["en"];

      for (var w = 0; w < weeksAhead && enqueued.length < maxJobs; w++) {
        for (var l = 0; l < allowedLangs.length && enqueued.length < maxJobs; l++) {
          var lang = allowedLangs[l];
          if (langs.indexOf(lang) < 0) continue;
          // Skip if catalog already has this entry
          var existing = ContentFactoryClient.readPackCatalog(nk, cfg.slug, lang, w);
          if (existing) continue;
          var rotated = TournamentTopicCatalog.getRotatedTag(cfg.topic_tag, w);
          var rt = TournamentTopicCatalog.getEntry(rotated) || topic;
          var enq = ContentFactoryClient.enqueuePackGeneration(ctx, nk, {
            concept: rt.concept,
            exam_board: rt.exam_board,
            language: lang,
            num_cards: 30,
            tags: [cfg.slug, rotated, "w" + w, lang],
          });
          enqueued.push({ slug: cfg.slug, language: lang, week_num: w, ok: enq.ok, task_id: enq.task_id || null });
        }
      }
    }
    logger.info("[TournamentCron:pregen] enqueued " + enqueued.length + " CF jobs");
    return { ok: true, enqueued: enqueued, ran_at: nowSec() };
  }

  // ── RPC: tournament_cron_tick (service-only) ───────────────────────────────
  function rpcTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var expected = "" + ((ctx.env && ctx.env["TOURNAMENT_SERVICE_TOKEN"]) || (ctx.env && ctx.env["BRAIN_COINS_SERVICE_TOKEN"]) || "");
    if (!data.service_token || data.service_token !== expected) return RpcHelpers.errorResponse("service-only", 401);
    var res = tick(ctx, logger, nk);
    return RpcHelpers.successResponse(res);
  }

  // ── RPC: tournament_cron_pregen (service-only) ─────────────────────────────
  function rpcPregenTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var expected = "" + ((ctx.env && ctx.env["TOURNAMENT_SERVICE_TOKEN"]) || (ctx.env && ctx.env["BRAIN_COINS_SERVICE_TOKEN"]) || "");
    if (!data.service_token || data.service_token !== expected) return RpcHelpers.errorResponse("service-only", 401);
    var max = parseInt("" + (data.max_jobs || 1), 10);
    var res = pregenerateTick(ctx, logger, nk, max);
    return RpcHelpers.successResponse(res);
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("tournament_cron_tick", rpcTick);
    initializer.registerRpc("tournament_cron_pregen", rpcPregenTick);
  }
}
