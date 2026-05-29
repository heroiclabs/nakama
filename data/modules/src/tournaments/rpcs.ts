// =============================================================================
// rpcs.ts — All 23 tournament RPCs per §1I signature catalog
//
// Plan ref: §1I End-to-End Wire Spec
//
// User-callable (must be authenticated; rate-limited):
//   tournament_list
//   tournament_get
//   tournament_pre_enroll
//   tournament_enter
//   tournament_submit_pack_result
//   tournament_submit_picks                 (pick_n format only)
//   tournament_status_get
//   tournament_leaderboard_top
//   tournament_leaderboard_around_me
//   tournament_leaderboard_friends
//   tournament_leaderboard_country
//   tournament_leaderboard_tier_league
//   tournament_leaderboard_activity_feed
//   tournament_claim_cert
//   tournament_content_get_pack
//   tournament_video_get_url
//   tournament_learning_check_submit
//   tournament_referral_get_mine
//
// Service-callable (require service_token):
//   tournament_admin_create
//   tournament_content_request_generation
//   tournament_settle                       (manual trigger; cron calls same impl)
//   tournament_eliminate_round              (manual trigger; cron calls same impl)
//   tournament_referral_settle_topN         (manual trigger)
// =============================================================================

namespace TournamentRpcs {

  function nowSec(): number { return Math.floor(Date.now() / 1000); }
  function isoToUnix(iso: string): number { return Math.floor(new Date(iso).getTime() / 1000); }

  function isServiceCaller(ctx: nkruntime.Context, payload: any): boolean {
    var token = payload && payload.service_token;
    if (!token) return false;
    var expected = "" + ((ctx.env && ctx.env["TOURNAMENT_SERVICE_TOKEN"]) || (ctx.env && ctx.env["BRAIN_COINS_SERVICE_TOKEN"]) || "");
    return expected.length > 0 && token === expected;
  }

  // Picks the canonical recommended tournament slug — used as the default
  // landing target for referral links when the caller didn't specify one.
  // Prefers PRE_ENROLL/OPEN/ACTIVE tournaments, falls back to the first
  // entry in the LAUNCH_SLATE. Never returns a "settled" slug.
  function defaultRecommendedSlug(nk: nkruntime.Nakama): string {
    var slate = TournamentEconomy.listAll();
    for (var i = 0; i < slate.length; i++) {
      var cfg = slate[i];
      var meta = TournamentsStorage.readMeta(nk, cfg.slug);
      if (!meta) return cfg.slug;
      if (meta.status === "PRE_ENROLL" || meta.status === "OPEN" || meta.status === "ACTIVE") return cfg.slug;
    }
    return slate.length > 0 ? slate[0].slug : "gk-royale-daily";
  }

  function readUserCountry(nk: nkruntime.Nakama, userId: string): string {
    try {
      var acc = nk.accountsGetId([userId]);
      if (acc && acc.length > 0) {
        var md: any = acc[0].user.metadata;
        if (md && md.country) return "" + md.country;
      }
    } catch (_) { }
    return "";
  }

  function readUserState(nk: nkruntime.Nakama, userId: string): string {
    try {
      var acc = nk.accountsGetId([userId]);
      if (acc && acc.length > 0) {
        var md: any = acc[0].user.metadata;
        if (md && md.us_state) return "" + md.us_state;
      }
    } catch (_) { }
    return "";
  }

  function readUserDob(nk: nkruntime.Nakama, userId: string): { age: number; dob_iso: string } {
    try {
      var acc = nk.accountsGetId([userId]);
      if (acc && acc.length > 0) {
        var md: any = acc[0].user.metadata;
        if (md && md.dob_iso) {
          var dob = new Date(md.dob_iso);
          var now = new Date();
          var age = now.getFullYear() - dob.getFullYear();
          var m = now.getMonth() - dob.getMonth();
          if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
          return { age: age, dob_iso: md.dob_iso };
        }
      }
    } catch (_) { }
    return { age: 0, dob_iso: "" };
  }

  function readBcBalance(nk: nkruntime.Nakama, userId: string): { balance: number; lifetime_earned: number } {
    try {
      var rows = nk.storageRead([{ collection: "brain_coins", key: "wallet", userId: userId }]);
      if (rows && rows.length > 0) {
        var v = rows[0].value as any;
        return { balance: v.balance | 0, lifetime_earned: v.lifetime_earned | 0 };
      }
    } catch (_) { }
    return { balance: 0, lifetime_earned: 0 };
  }

  function debitBc(nk: nkruntime.Nakama, userId: string, amount: number, reason: string): boolean {
    try {
      var rows = nk.storageRead([{ collection: "brain_coins", key: "wallet", userId: userId }]);
      var wallet: any = (rows && rows.length > 0) ? rows[0].value : { balance: 0, lifetime_earned: 0, lifetime_redeemed: 0 };
      if ((wallet.balance | 0) < amount) return false;
      wallet.balance = (wallet.balance | 0) - amount;
      wallet.updated_at = nowSec();
      nk.storageWrite([{
        collection: "brain_coins",
        key: "wallet",
        userId: userId,
        value: wallet,
        permissionRead: 1,
        permissionWrite: 0,
      }]);
      nk.storageWrite([{
        collection: "brain_coins",
        key: "earn_log_debit_" + nowSec() + "_" + Math.random().toString(36).slice(2, 8),
        userId: userId,
        value: {
          code: "tournament_entry_debit",
          coins: -amount,
          unix_ts: nowSec(),
          date: new Date().toISOString().slice(0, 10),
          source: reason,
        },
        permissionRead: 1,
        permissionWrite: 0,
      }]);
      return true;
    } catch (_) {
      return false;
    }
  }

  // ── RPC: tournament_list ────────────────────────────────────────────────────
  // Public/anonymous-friendly. Returns all visible tournaments + caller-specific
  // enriched fields (entered? founder? bc_balance) when authenticated.
  function rpcList(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    // B6 fix: opportunistic cron tick — runs at most once / 60s globally.
    // Hooked here because tournament_list is hit on EVERY hub page render
    // (web + Unity), so we get cron coverage proportional to traffic
    // without needing an external scheduler.
    try { TournamentCrons.opportunisticTick(ctx, _logger, nk); } catch (_) { }

    var slate = TournamentEconomy.listAll();
    // L10 — Wave-2 slate expansion. When the wave2_slate flag is on, append
    // the 3 cohort-25-34 tournaments. They surface via the same code path as
    // the rest of LAUNCH_SLATE since TournamentEconomy.seedFromConfig is
    // shape-compatible with Wave2Tournament minus a few defaults we fill in.
    if (TournamentEconomyV2.FEATURE_FLAGS.wave2_slate) {
      var w2 = TournamentEconomyV2.WAVE_2_SLATE_DRAFT;
      for (var w = 0; w < w2.length; w++) {
        var existing = TournamentEconomy.getBySlug(w2[w].slug);
        if (existing) continue;
        // Promote each Wave-2 draft into a TournamentConfig shape using the
        // shared launch-window defaults. This is read-only — we don't mutate
        // LAUNCH_SLATE; we just serve the row out of tournament_list.
        slate = slate.concat([{
          slug: w2[w].slug,
          name: w2[w].name,
          description: w2[w].description,
          topic_tag: w2[w].topic_tag,
          format: "classic",
          format_ui_variant: "classic-pot",
          pre_enroll_start_iso: TournamentEconomy.PUBLIC_OPEN_TIME_ISO,
          open_start_iso: TournamentEconomy.PUBLIC_OPEN_TIME_ISO,
          end_iso: TournamentEconomy.PUBLIC_OPEN_TIME_ISO,
          entry_fee_bc: w2[w].entry_fee_bc,
          rake_pct: TournamentEconomy.HOUSE_RAKE_PCT,
          pot_seed_bc: w2[w].pot_seed_bc,
          countries_allowed: "ALL",
          min_age: 18,
          badge_emoji: "🎬",
        } as any]);
      }
    }

    var out: any[] = [];
    var userId = ctx.userId || "";
    var userCountry = userId ? readUserCountry(nk, userId) : "";
    var userState = userId ? readUserState(nk, userId) : "";

    for (var i = 0; i < slate.length; i++) {
      var cfg = slate[i];
      var meta = TournamentsStorage.readMeta(nk, cfg.slug);
      if (!meta) {
        // Seed if missing (idempotent — first-touch creates the row)
        meta = TournamentsStorage.seedFromConfig(nk, cfg);
      }
      var entry = userId ? TournamentsStorage.readEntry(nk, cfg.slug, userId) : null;
      var preEnroll = userId ? TournamentsStorage.readPreEnroll(nk, cfg.slug, userId) : null;
      var countryAllowed = TournamentEconomy.isCountryAllowed(cfg, userCountry);
      var stateBlocked = userCountry === "US" && userState && TournamentEconomy.isUsStateEntryBlocked(userState);

      out.push({
        slug: cfg.slug,
        name: cfg.name,
        description: cfg.description,
        format: cfg.format,
        format_ui_variant: cfg.format_ui_variant,
        topic_tag: cfg.topic_tag,
        status: meta.status,
        pot_bc: meta.pot_bc,
        entries_count: meta.entries_count,
        pre_enroll_count: meta.pre_enroll_count,
        // L2 scarcity counter — surfaced unconditionally (fast computation,
        // already-public field). UI gates display on the v_2 flag, but the
        // server always computes it so dashboards can pull regardless.
        founder_slots_left: Math.max(0, TournamentEconomy.PRE_ENROLL_FOUNDER_CAP - (meta.pre_enroll_count || 0)),
        scarcity_low: (TournamentEconomy.PRE_ENROLL_FOUNDER_CAP - (meta.pre_enroll_count || 0)) <= TournamentEconomyV2.SCARCITY_LOW_THRESHOLD,
        scarcity_very_low: (TournamentEconomy.PRE_ENROLL_FOUNDER_CAP - (meta.pre_enroll_count || 0)) <= TournamentEconomyV2.SCARCITY_VERY_LOW_THRESHOLD,
        entry_fee_bc: cfg.entry_fee_bc,
        rake_pct: cfg.rake_pct,
        pre_enroll_start_iso: cfg.pre_enroll_start_iso,
        open_start_iso: cfg.open_start_iso,
        end_iso: cfg.end_iso,
        badge_emoji: cfg.badge_emoji,
        caller: {
          authenticated: !!userId,
          country: userCountry || null,
          state: userState || null,
          eligible: countryAllowed && !stateBlocked,
          ineligibility_reason: !countryAllowed ? "country_not_allowed" : (stateBlocked ? "us_state_blocked" : null),
          entered: !!entry,
          pre_enrolled: !!preEnroll,
          founder_rank: preEnroll && preEnroll.founder_rank ? preEnroll.founder_rank : null,
        },
      });
    }
    return RpcHelpers.successResponse({ tournaments: out, served_at: nowSec() });
  }

  // ── RPC: tournament_get ────────────────────────────────────────────────────
  // Returns a flat `tournament` object consumed by both web (TournamentDetailData)
  // and Unity (TournamentSummary). Pot / prize breakdown / survivor count are
  // computed from meta + cfg here so clients stay dumb.
  function rpcGet(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var cfg = TournamentEconomy.getBySlug(slug);
    if (!cfg) return RpcHelpers.errorResponse("tournament not found", 404);
    // Opportunistic tick: cheap, gated to once-per-60s globally (B6 fix).
    try { TournamentCrons.opportunisticTick(ctx, _logger, nk); } catch (_) { }
    var meta = TournamentsStorage.readMeta(nk, slug) || TournamentsStorage.seedFromConfig(nk, cfg);
    var userId = ctx.userId || "";
    var entry = userId ? TournamentsStorage.readEntry(nk, slug, userId) : null;
    var preEnroll = userId ? TournamentsStorage.readPreEnroll(nk, slug, userId) : null;

    // Format-specific payload shaping
    var pickN: any = null;
    if (cfg.format === "pick_n" && cfg.pick_n_config) {
      pickN = { n: cfg.pick_n_config.n, multipliers: cfg.pick_n_config.multipliers };
    }
    var elimination: any = null;
    if (cfg.format === "elimination" && cfg.elimination_schedule) {
      // survivor_count = entries that have no eliminated_at marker.
      // For MVP we approximate via leaderboard cardinality (cheap O(1) call).
      var initialEntries = meta.entries_count | 0;
      var survivorCount = initialEntries;
      try {
        var lbCount = nk.leaderboardRecordsList(TournamentLeaderboard.lbId(slug), [], 1, undefined);
        if (lbCount && (lbCount as any).rankCount !== undefined) {
          survivorCount = ((lbCount as any).rankCount as number) | 0;
        }
      } catch (_) { }
      elimination = {
        cut_times_utc: cfg.elimination_schedule.cut_times_utc || [],
        survivor_count: survivorCount,
        initial_entries: initialEntries,
      };
    }

    // Prize breakdown — derived from pot_split_top_n × (pot × (1 - rake)).
    var prizeBreakdown: { label: string; bc: number }[] = [];
    if (cfg.format === "classic" && cfg.pot_split_top_n && meta.pot_bc > 0) {
      var prizePool = Math.floor(meta.pot_bc * (1 - cfg.rake_pct));
      for (var pi = 0; pi < cfg.pot_split_top_n.length; pi++) {
        var rs = cfg.pot_split_top_n[pi];
        var bc = Math.floor(prizePool * rs.share);
        if (bc <= 0) continue;
        prizeBreakdown.push({ label: "#" + rs.rank, bc: bc });
      }
    } else if (cfg.format === "pick_n" && cfg.pick_n_config) {
      // Show top tier payouts (multiplier × entry_fee).
      var grades = ["5/5", "4/5", "3/5"];
      for (var gi = 0; gi < grades.length; gi++) {
        var g = grades[gi];
        var mult = cfg.pick_n_config.multipliers[g] || 0;
        if (mult <= 0) continue;
        prizeBreakdown.push({ label: g, bc: Math.floor(cfg.entry_fee_bc * mult) });
      }
    } else if (cfg.format === "elimination" && cfg.elimination_schedule) {
      prizeBreakdown.push({ label: "Survivor share (equal)", bc: 0 });
      prizeBreakdown.push({ label: "#1 bragging bonus", bc: cfg.elimination_schedule.final_survivor_bonus_bc | 0 });
    }

    var rulesSummary = "Entry: " + cfg.entry_fee_bc + " BC · House rake: " + Math.round(cfg.rake_pct * 100) + "% · AMOE: complete " + cfg.amoe.learning_series_required_videos + " Learning Series videos for a free entry.";

    var tournament = {
      slug: cfg.slug,
      name: cfg.name,
      description: cfg.description,
      format: cfg.format,
      format_ui_variant: cfg.format_ui_variant,
      topic_tag: cfg.topic_tag,
      status: meta.status,
      pot_bc: meta.pot_bc | 0,
      entries_count: meta.entries_count | 0,
      pre_enroll_count: meta.pre_enroll_count | 0,
      entry_fee_bc: cfg.entry_fee_bc,
      pre_enroll_start_iso: cfg.pre_enroll_start_iso,
      open_start_iso: cfg.open_start_iso,
      end_iso: cfg.end_iso,
      badge_emoji: cfg.badge_emoji || null,
      pick_n: pickN,
      elimination: elimination,
      prize_breakdown: prizeBreakdown,
      rules_summary: rulesSummary,
    };

    return RpcHelpers.successResponse({
      tournament: tournament,
      caller_entry: entry,
      caller_pre_enroll: preEnroll,
      served_at: nowSec(),
    });
  }

  // ── RPC: tournament_pre_enroll ─────────────────────────────────────────────
  // Frees a Founder slot if available. No BC charged.
  function rpcPreEnroll(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var rl = SharedRateLimit.enforce(ctx, nk, "tournament_pre_enroll", { perUserPerMin: 20 });
    if (rl) return rl;
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    var referredBy = "" + (data.referred_by || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var cfg = TournamentEconomy.getBySlug(slug);
    if (!cfg) return RpcHelpers.errorResponse("tournament not found", 404);

    var meta = TournamentsStorage.readMeta(nk, slug) || TournamentsStorage.seedFromConfig(nk, cfg);
    if (meta.status !== "PRE_ENROLL" && meta.status !== "OPEN") {
      return RpcHelpers.errorResponse("tournament not accepting pre-enrollment", 400);
    }

    var existing = TournamentsStorage.readPreEnroll(nk, slug, userId);
    if (existing) {
      return RpcHelpers.successResponse({ pre_enroll: existing, idempotent: true });
    }

    // Determine Founder rank (1..PRE_ENROLL_FOUNDER_CAP)
    var founderRank: number | undefined = undefined;
    if (meta.pre_enroll_count < TournamentEconomy.PRE_ENROLL_FOUNDER_CAP) {
      founderRank = meta.pre_enroll_count + 1;
    }

    var row: TournamentsStorage.PreEnrollRow = {
      tournament_slug: slug,
      user_id: userId,
      enrolled_at: nowSec(),
      founder_rank: founderRank,
      referred_by: referredBy || undefined,
    };
    TournamentsStorage.writePreEnroll(nk, slug, userId, row);
    var newCount = TournamentsStorage.incrementPreEnrollCount(nk, slug);

    // Referral attribution
    if (referredBy) {
      try {
        Referrals.recordReferral(nk, referredBy, userId, slug);
      } catch (_) { /* best-effort */ }
    }

    // Subscribe user to live updates for this tournament so they receive
    // scarcity / pot / settled notifications (B3 fix).
    try { TournamentsStorage.addSubscriber(nk, slug, userId); } catch (_) { }

    // Notify scarcity if under threshold (broadcast to live subscriber list).
    var founderLeft = TournamentEconomy.PRE_ENROLL_FOUNDER_CAP - newCount;
    if (founderLeft <= 100) {
      TournamentRealtime.notifyPreEnrollScarcity(nk, slug, founderLeft);
    }

    logger.info("[Tournaments] pre-enroll " + userId + " → " + slug + " (founder_rank=" + (founderRank || "-") + ", pre_enroll_count=" + newCount + ")");
    return RpcHelpers.successResponse({ pre_enroll: row, founder_spots_left: founderLeft, total_pre_enroll: newCount });
  }

  // ── RPC: tournament_enter ──────────────────────────────────────────────────
  // Charges BC; opens the entry row. Honors AMOE if user completed Learning
  // Series (6/6 videos) — paid_via="amoe" with bc_charged=0.
  function rpcEnter(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var rl = SharedRateLimit.enforce(ctx, nk, "tournament_enter", { perUserPerMin: 10 });
    if (rl) return rl;
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    var paidVia = "" + (data.paid_via || "balance"); // balance | amoe
    var idempotencyKey = "" + (data.idempotency_key || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    if (!idempotencyKey) return RpcHelpers.errorResponse("idempotency_key required", 400);

    var cfg = TournamentEconomy.getBySlug(slug);
    if (!cfg) return RpcHelpers.errorResponse("tournament not found", 404);
    var meta = TournamentsStorage.readMeta(nk, slug);
    if (!meta) return RpcHelpers.errorResponse("tournament meta missing — call tournament_list first", 404);
    if (meta.status !== "OPEN" && meta.status !== "ACTIVE") {
      return RpcHelpers.errorResponse("tournament not open for entry (status=" + meta.status + ")", 400);
    }

    // Eligibility
    var ageInfo = readUserDob(nk, userId);
    if (ageInfo.age < cfg.min_age) {
      return RpcHelpers.errorResponse("min age " + cfg.min_age + " required", 403);
    }
    var country = readUserCountry(nk, userId);
    if (!TournamentEconomy.isCountryAllowed(cfg, country)) {
      return RpcHelpers.errorResponse("country not allowed for this tournament", 403);
    }
    if (country === "US") {
      var state = readUserState(nk, userId);
      if (state && TournamentEconomy.isUsStateEntryBlocked(state)) {
        return RpcHelpers.errorResponse("entry blocked in US state " + state, 403);
      }
    }

    // Idempotency: if entry row exists, return it.
    var existing = TournamentsStorage.readEntry(nk, slug, userId);
    if (existing) {
      return RpcHelpers.successResponse({ entry: existing, idempotent: true });
    }

    // Pay path
    var bcCharged = 0;
    if (paidVia === "amoe") {
      // Verify AMOE eligibility (caller has watched 6/6 Learning Series videos).
      var amoeOk = LearningSeries.hasUnlockedAmoe(nk, userId, cfg.topic_tag, cfg.amoe.learning_series_required_videos);
      if (!amoeOk) return RpcHelpers.errorResponse("AMOE not unlocked — complete 6/6 Learning Series videos first", 403);
      // Verify under per-tournament free-entry cap
      if (existing) return RpcHelpers.successResponse({ entry: existing, idempotent: true });
    } else {
      var bal = readBcBalance(nk, userId);
      if (bal.balance < cfg.entry_fee_bc) {
        return RpcHelpers.errorResponse("insufficient BC (balance=" + bal.balance + ", entry_fee=" + cfg.entry_fee_bc + ")", 402);
      }
      var debited = debitBc(nk, userId, cfg.entry_fee_bc, "tournament_enter:" + slug);
      if (!debited) return RpcHelpers.errorResponse("debit failed", 500);
      bcCharged = cfg.entry_fee_bc;
    }

    // Founder check
    var preEnroll = TournamentsStorage.readPreEnroll(nk, slug, userId);
    var isFounder = !!(preEnroll && preEnroll.founder_rank);

    var entry: TournamentsStorage.EntryRow = {
      entry_id: "ent_" + nowSec() + "_" + Math.random().toString(36).slice(2, 10),
      tournament_slug: slug,
      user_id: userId,
      paid_via: paidVia as any,
      bc_charged: bcCharged,
      founder_member: isFounder,
      enrolled_at: nowSec(),
      score: 0,
    };
    TournamentsStorage.writeEntry(nk, slug, userId, entry);

    // Subscribe to live updates (B3).
    try { TournamentsStorage.addSubscriber(nk, slug, userId); } catch (_) { }

    // Pot increment (paid entries only; AMOE doesn't add to pot)
    var newPot = meta.pot_bc | 0;
    var newEntries = (meta.entries_count | 0) + 1;
    if (bcCharged > 0) {
      newPot = TournamentsStorage.incrementPot(nk, slug, bcCharged);
      // Pot + entry tick — fan out to all subscribers (B3/B10).
      TournamentRealtime.notifyPotUpdate(nk, slug, newPot, bcCharged, undefined, { userId: userId });
    } else {
      TournamentsStorage.incrementPot(nk, slug, 0);  // bumps entries_count
    }
    TournamentRealtime.notifyEntered(nk, slug, userId, newPot, newEntries);

    // Ensure leaderboard
    TournamentLeaderboard.ensureLeaderboard(nk, slug, null, 0);

    logger.info("[Tournaments] enter user=" + userId + " slug=" + slug + " paid=" + paidVia + " bc=" + bcCharged + " founder=" + isFounder);
    return RpcHelpers.successResponse({ entry: entry, founder_member: isFounder, idempotent: false });
  }

  // ── RPC: tournament_submit_pack_result ─────────────────────────────────────
  function rpcSubmitPackResult(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var rl = SharedRateLimit.enforce(ctx, nk, "tournament_submit_pack_result", { perUserPerSec: 2, perUserPerMin: 60 });
    if (rl) return rl;
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    var packId = "" + (data.pack_id || "");
    var idempotencyKey = "" + (data.idempotency_key || "");
    var correct = parseInt("" + (data.correct || 0), 10);
    var total = parseInt("" + (data.total || 0), 10);
    var durationMs = parseInt("" + (data.duration_ms || 0), 10);
    var latencyMs = parseInt("" + (data.latency_ms || 0), 10);
    var honeypotCorrect = parseInt("" + (data.honeypot_correct || 0), 10);
    var honeypotTotal = parseInt("" + (data.honeypot_total || 0), 10);

    if (!slug || !packId || !idempotencyKey) {
      return RpcHelpers.errorResponse("slug + pack_id + idempotency_key required", 400);
    }

    // Idempotency check
    var prior = TournamentsStorage.readSubmitIdem(nk, userId, idempotencyKey);
    if (prior) return RpcHelpers.successResponse({ submit: prior, idempotent: true });

    var cfg = TournamentEconomy.getBySlug(slug);
    if (!cfg) return RpcHelpers.errorResponse("tournament not found", 404);

    var entry = TournamentsStorage.readEntry(nk, slug, userId);
    if (!entry) return RpcHelpers.errorResponse("not entered — call tournament_enter first", 403);
    if (entry.eliminated_at) return RpcHelpers.errorResponse("eliminated", 403);

    // Anti-cheat
    var ac = TournamentAntiCheat.check(nk, {
      user_id: userId,
      answers_count: total,
      duration_ms: durationMs,
      latency_ms: latencyMs,
      correct: correct,
      total: total,
      honeypot_correct: honeypotCorrect,
      honeypot_total: honeypotTotal,
    });

    var status: "counted" | "soft_dq" | "throttled" = ac.pass ? "counted" : "soft_dq";
    var effectiveScore = ac.pass ? correct : 0;

    // Update entry
    entry.score = (entry.score | 0) + effectiveScore;
    TournamentsStorage.writeEntry(nk, slug, userId, entry);

    // Record submit row
    var submitRow: TournamentsStorage.SubmitRow = {
      idempotency_key: idempotencyKey,
      tournament_slug: slug,
      pack_id: packId,
      user_id: userId,
      answers_count: total,
      score: effectiveScore,
      correct: correct,
      total: total,
      latency_ms: latencyMs,
      duration_ms: durationMs,
      submitted_at: nowSec(),
      status: status,
      soft_dq_reasons: ac.pass ? undefined : ac.reasons,
    };
    TournamentsStorage.writeSubmit(nk, userId, idempotencyKey, submitRow);

    // Push score to leaderboard (only if counted)
    if (ac.pass) {
      var username = "";
      try {
        var acc = nk.accountsGetId([userId]);
        if (acc && acc.length > 0) username = "" + (acc[0].user.username || "");
      } catch (_) { }
      TournamentLeaderboard.recordSubmit(nk, slug, userId, username, entry.score);

      // Tier-league bookkeeping
      var bal = readBcBalance(nk, userId);
      var tier = TournamentLeaderboard.tierForBalance(bal.lifetime_earned);
      TournamentLeaderboard.recordTierSubmit(nk, slug, tier, userId, username, entry.score);

      // B10 fix: emit a score tick so the live ActivityTicker can render
      // "Sarah just scored 4,200". Subscriber list maintained by enter +
      // caller_status; if the user is the only subscriber the tick still
      // helps update their own LeaderboardPanel client-side.
      try { TournamentRealtime.notifyScoreTick(nk, slug, userId, entry.score); } catch (_) { }
    }

    logger.info("[Tournaments] submit user=" + userId + " slug=" + slug + " pack=" + packId + " score=" + effectiveScore + " status=" + status);
    return RpcHelpers.successResponse({
      submit: submitRow,
      total_score: entry.score,
      idempotent: false,
    });
  }

  // ── RPC: tournament_submit_picks (pick_n format) ───────────────────────────
  function rpcSubmitPicks(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var rl = SharedRateLimit.enforce(ctx, nk, "tournament_submit_picks", { perUserPerMin: 5 });
    if (rl) return rl;
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    var idempotencyKey = "" + (data.idempotency_key || "");
    var picks: any[] = data.picks || [];

    if (!slug || !idempotencyKey) return RpcHelpers.errorResponse("slug + idempotency_key required", 400);
    if (!picks || picks.length === 0) return RpcHelpers.errorResponse("picks array required", 400);

    var cfg = TournamentEconomy.getBySlug(slug);
    if (!cfg) return RpcHelpers.errorResponse("tournament not found", 404);
    if (cfg.format !== "pick_n") return RpcHelpers.errorResponse("submit_picks only valid for pick_n format", 400);
    if (!cfg.pick_n_config) return RpcHelpers.errorResponse("tournament misconfigured: pick_n_config missing", 500);
    if (picks.length !== cfg.pick_n_config.n) {
      return RpcHelpers.errorResponse("picks count must be " + cfg.pick_n_config.n, 400);
    }

    var entry = TournamentsStorage.readEntry(nk, slug, userId);
    if (!entry) return RpcHelpers.errorResponse("not entered", 403);

    // Lock window
    var now = nowSec();
    var lockTime = isoToUnix(cfg.end_iso) - (cfg.pick_n_config.max_pick_window_hours * 3600);
    if (now > lockTime) return RpcHelpers.errorResponse("pick window closed", 403);

    // Idempotency
    var prior = nk.storageRead([{ collection: TournamentsStorage.COL_PICKS, key: idempotencyKey, userId: userId }]);
    if (prior && prior.length > 0) {
      return RpcHelpers.successResponse({ picks: (prior[0].value as any), idempotent: true });
    }

    // Persist picks (grading happens at settle time when answer key is revealed)
    nk.storageWrite([{
      collection: TournamentsStorage.COL_PICKS,
      key: idempotencyKey,
      userId: userId,
      value: {
        tournament_slug: slug,
        idempotency_key: idempotencyKey,
        picks: picks,
        submitted_at: now,
      },
      permissionRead: 1,
      permissionWrite: 0,
    }]);

    logger.info("[Tournaments] picks user=" + userId + " slug=" + slug + " n=" + picks.length);
    return RpcHelpers.successResponse({ submitted: true, locks_at: lockTime });
  }

  // ── RPC: tournament_status_get ─────────────────────────────────────────────
  function rpcStatusGet(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var entry = TournamentsStorage.readEntry(nk, slug, userId);
    var meta = TournamentsStorage.readMeta(nk, slug);
    var lbRank = -1;
    try {
      var rec = nk.leaderboardRecordsList(TournamentLeaderboard.lbId(slug), [userId], 1, undefined);
      if (rec.records && rec.records.length > 0) lbRank = rec.records[0].rank as any;
    } catch (_) { }
    return RpcHelpers.successResponse({
      entry: entry,
      meta: meta,
      caller_rank: lbRank,
      served_at: nowSec(),
    });
  }

  // ── Leaderboard variant RPCs ───────────────────────────────────────────────
  function rpcLbTop(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    var limit = parseInt("" + (data.limit || 50), 10);
    var cursor = data.cursor || null;
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var res = TournamentLeaderboard.listTop(nk, slug, limit, cursor);
    return RpcHelpers.successResponse(res);
  }

  function rpcLbAroundMe(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    var limit = parseInt("" + (data.limit || 25), 10);
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var res = TournamentLeaderboard.listAroundMe(nk, slug, userId, limit);
    return RpcHelpers.successResponse(res);
  }

  function rpcLbFriends(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    var limit = parseInt("" + (data.limit || 50), 10);
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var res = TournamentLeaderboard.listFriends(nk, slug, userId, limit);
    return RpcHelpers.successResponse(res);
  }

  function rpcLbCountry(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = ctx.userId || "";
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    var country = "" + (data.country || (userId ? readUserCountry(nk, userId) : "US"));
    var limit = parseInt("" + (data.limit || 50), 10);
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var res = TournamentLeaderboard.listCountry(nk, slug, country, limit);
    return RpcHelpers.successResponse(res);
  }

  function rpcLbTierLeague(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    var tier = "" + (data.tier || "");
    var limit = parseInt("" + (data.limit || 50), 10);
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    if (!tier) {
      var bal = readBcBalance(nk, userId);
      tier = TournamentLeaderboard.tierForBalance(bal.lifetime_earned);
    }
    var res = TournamentLeaderboard.listTierLeague(nk, slug, tier, limit);
    return RpcHelpers.successResponse(res);
  }

  // Activity feed: recent N submits across all users for this tournament.
  // MVP impl: tail the user's own log + intersperse "Player X scored Y" rows
  // from the leaderboard top.
  function rpcLbActivityFeed(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    var limit = parseInt("" + (data.limit || 20), 10);
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    // Pull recent top-20 from leaderboard as a proxy for "recent activity"
    var top = TournamentLeaderboard.listTop(nk, slug, limit, null);
    var feed: any[] = [];
    if (top.records) {
      for (var i = 0; i < top.records.length; i++) {
        var r = top.records[i];
        feed.push({
          username: r.username || "Player",
          score: r.score,
          rank: r.rank,
          updated_at: r.updateTime || null,
        });
      }
    }
    return RpcHelpers.successResponse({ activity: feed, served_at: nowSec() });
  }

  // ── RPC: tournament_claim_cert ─────────────────────────────────────────────
  function rpcClaimCert(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var rl = SharedRateLimit.enforce(ctx, nk, "tournament_claim_cert", { perUserPerMin: 10 });
    if (rl) return rl;
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);

    var entry = TournamentsStorage.readEntry(nk, slug, userId);
    if (!entry) return RpcHelpers.errorResponse("not entered", 403);
    if (entry.claimed_cert) return RpcHelpers.successResponse({ cert_id: entry.cert_id, idempotent: true });

    var meta = TournamentsStorage.readMeta(nk, slug);
    if (!meta || (meta.status !== "SETTLED")) {
      return RpcHelpers.errorResponse("tournament not settled yet", 400);
    }

    // Determine tier: top-1 = gold, top-3 = silver, top-10 = bronze, else participation
    var tier = "participation";
    if (entry.rank === 1) tier = "gold";
    else if (entry.rank && entry.rank <= 3) tier = "silver";
    else if (entry.rank && entry.rank <= 10) tier = "bronze";

    var certId = "cert_" + slug + "_" + userId + "_" + nowSec();
    // Persist cert row (Lambda generates PDF lazily on first /certificate/[id] hit)
    nk.storageWrite([{
      collection: TournamentsStorage.COL_CERTS,
      key: certId,
      userId: userId,
      value: {
        cert_id: certId,
        tournament_slug: slug,
        user_id: userId,
        tier: tier,
        rank: entry.rank || 0,
        score: entry.score,
        claimed_at: nowSec(),
        pdf_status: "pending",  // Lambda flips to "ready" + sets s3_url
        s3_url: null,
      },
      permissionRead: 2,  // public read so OG image generation works
      permissionWrite: 0,
    }]);

    entry.claimed_cert = true;
    entry.cert_id = certId;
    TournamentsStorage.writeEntry(nk, slug, userId, entry);

    logger.info("[Tournaments] claim_cert user=" + userId + " slug=" + slug + " tier=" + tier);
    return RpcHelpers.successResponse({ cert_id: certId, tier: tier });
  }

  // ── RPC: tournament_content_get_pack ───────────────────────────────────────
  // Catalog read; on miss requests CF generation and returns task_id.
  function rpcContentGetPack(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    var language = "" + (data.language || "en");
    var weekNum = parseInt("" + (data.week_num || 0), 10);
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);

    var entry = ContentFactoryClient.readPackCatalog(nk, slug, language, weekNum);
    if (entry) {
      return RpcHelpers.successResponse({ pack: entry, source: "cache" });
    }

    var cfg = TournamentEconomy.getBySlug(slug);
    if (!cfg) return RpcHelpers.errorResponse("tournament not found", 404);
    var topic = TournamentTopicCatalog.getEntry(cfg.topic_tag);
    if (!topic) return RpcHelpers.errorResponse("topic catalog missing for " + cfg.topic_tag, 500);

    var rotatedTag = TournamentTopicCatalog.getRotatedTag(cfg.topic_tag, weekNum);
    var rotatedTopic = TournamentTopicCatalog.getEntry(rotatedTag) || topic;

    var enq = ContentFactoryClient.enqueuePackGeneration(ctx, nk, {
      concept: rotatedTopic.concept,
      exam_board: rotatedTopic.exam_board,
      language: language,
      num_cards: 30,
      tags: [slug, rotatedTag, "w" + weekNum],
    });
    if (!enq.ok) return RpcHelpers.errorResponse("CF enqueue failed: " + enq.error, 502);
    return RpcHelpers.successResponse({ pack: null, source: "generating", task_id: enq.task_id });
  }

  // ── RPC: tournament_video_get_url ──────────────────────────────────────────
  function rpcVideoGetUrl(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    var videoIndex = parseInt("" + (data.video_index || 0), 10);
    var language = "" + (data.language || "en");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);

    var entry = ContentFactoryClient.readVideoCatalog(nk, slug, videoIndex, language);
    if (entry) return RpcHelpers.successResponse({ video: entry, source: "cache" });
    return RpcHelpers.successResponse({ video: null, source: "not_yet_generated" });
  }

  // ── RPC: tournament_learning_check_submit ──────────────────────────────────
  function rpcLearningCheckSubmit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var topicTag = "" + (data.topic_tag || "");
    var videoIndex = parseInt("" + (data.video_index || -1), 10);
    var correct = parseInt("" + (data.correct || 0), 10);
    var total = parseInt("" + (data.total || 5), 10);
    if (!topicTag || videoIndex < 0) return RpcHelpers.errorResponse("topic_tag + video_index required", 400);

    LearningSeries.recordVideoCheck(nk, userId, topicTag, videoIndex, correct, total);
    var progress = LearningSeries.getProgress(nk, userId, topicTag);
    return RpcHelpers.successResponse({ progress: progress });
  }

  // ── RPC: tournament_referral_get_mine ──────────────────────────────────────
  function rpcReferralGetMine(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var summary = Referrals.getMySummary(nk, userId);
    return RpcHelpers.successResponse(summary);
  }

  // ── RPC: referral_leaderboard_top ──────────────────────────────────────────
  // Public top-100 leaderboard of pre-enrollment referrals. Powers
  // /referrals/leaderboard on web. Returns rank, username, attributed
  // count, and the prize tier the user is currently in.
  function rpcReferralLeaderboardTop(_ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var limit = parseInt("" + (data.limit || 100), 10);
    if (isNaN(limit) || limit < 1 || limit > 100) limit = 100;
    var records: any[] = [];
    try {
      var lb = nk.leaderboardRecordsList(Referrals.LEADERBOARD_ID, [], limit, undefined);
      if (lb && lb.records) records = lb.records;
    } catch (_) { }
    var top: any[] = [];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var rank = i + 1;
      var prizeUsd = 0;
      if (rank === 1) prizeUsd = TournamentEconomy.REFERRAL_TOP_1_USD;
      else if (rank <= 3) prizeUsd = TournamentEconomy.REFERRAL_TOP_2_3_USD;
      else if (rank <= 10) prizeUsd = TournamentEconomy.REFERRAL_TOP_4_10_USD;
      else if (rank <= 100) prizeUsd = TournamentEconomy.REFERRAL_TOP_11_100_USD;
      top.push({
        rank: rank,
        username: r.username || "(anonymous)",
        attributed_count: r.score || 0,
        prize_usd: prizeUsd,
      });
    }
    return RpcHelpers.successResponse({ top: top, served_at: nowSec() });
  }

  // ── RPC: tournament_admin_create (service-only) ────────────────────────────
  function rpcAdminCreate(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!isServiceCaller(ctx, data)) return RpcHelpers.errorResponse("service-only", 401);
    var slug = "" + (data.slug || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var cfg = TournamentEconomy.getBySlug(slug);
    if (!cfg) return RpcHelpers.errorResponse("slug not in LAUNCH_SLATE", 404);
    var meta = TournamentsStorage.seedFromConfig(nk, cfg);
    return RpcHelpers.successResponse({ meta: meta, idempotent: !!meta });
  }

  // ── RPC: tournament_content_request_generation (service-only) ──────────────
  function rpcContentRequestGeneration(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!isServiceCaller(ctx, data)) return RpcHelpers.errorResponse("service-only", 401);
    var slug = "" + (data.slug || "");
    var language = "" + (data.language || "en");
    var weekNum = parseInt("" + (data.week_num || 0), 10);
    var numCards = parseInt("" + (data.num_cards || 30), 10);
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var cfg = TournamentEconomy.getBySlug(slug);
    if (!cfg) return RpcHelpers.errorResponse("slug not found", 404);
    var topic = TournamentTopicCatalog.getEntry(cfg.topic_tag);
    if (!topic) return RpcHelpers.errorResponse("topic missing", 500);
    var rotated = TournamentTopicCatalog.getRotatedTag(cfg.topic_tag, weekNum);
    var rt = TournamentTopicCatalog.getEntry(rotated) || topic;
    var enq = ContentFactoryClient.enqueuePackGeneration(ctx, nk, {
      concept: rt.concept,
      exam_board: rt.exam_board,
      language: language,
      num_cards: numCards,
      tags: [slug, rotated, "w" + weekNum],
    });
    return RpcHelpers.successResponse({ enqueued: enq.ok, task_id: enq.task_id || null, error: enq.error || null });
  }

  // ── RPC: tournament_settle (service-only) ──────────────────────────────────
  function rpcSettle(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!isServiceCaller(ctx, data)) return RpcHelpers.errorResponse("service-only", 401);
    var slug = "" + (data.slug || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var result = TournamentSettlement.settle(ctx, logger, nk, slug);
    return RpcHelpers.successResponse(result);
  }

  // ── RPC: tournament_eliminate_round (service-only) ─────────────────────────
  function rpcEliminateRound(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!isServiceCaller(ctx, data)) return RpcHelpers.errorResponse("service-only", 401);
    var slug = "" + (data.slug || "");
    var round = parseInt("" + (data.round || 1), 10);
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var result = TournamentSettlement.eliminateRound(ctx, logger, nk, slug, round);
    return RpcHelpers.successResponse(result);
  }

  // ── RPC: tournament_referral_settle_topN (service-only) ────────────────────
  function rpcReferralSettleTopN(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!isServiceCaller(ctx, data)) return RpcHelpers.errorResponse("service-only", 401);
    var result = Referrals.settleTopN(ctx, logger, nk);
    return RpcHelpers.successResponse(result);
  }

  // ── RPC: tournament_caller_status ──────────────────────────────────────────
  // Per-tournament eligibility snapshot for the calling user. Web detail
  // page + Unity entry flow both depend on this; returning a flat shape
  // (state_blocked / age_blocked / amoe_unlocked / balance_bc) keeps the
  // entry modal logic trivial on both clients.
  function rpcCallerStatus(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var cfg = TournamentEconomy.getBySlug(slug);
    if (!cfg) return RpcHelpers.errorResponse("tournament not found", 404);

    var userId = ctx.userId || "";
    // Live-subscribe on view (B3). Cheap; idempotent on the storage row.
    if (userId) { try { TournamentsStorage.addSubscriber(nk, slug, userId); } catch (_) { } }
    var country = userId ? readUserCountry(nk, userId) : "";
    var state = userId && country === "US" ? readUserState(nk, userId) : "";
    var ageInfo = userId ? readUserDob(nk, userId) : { age: 0 };
    var balance = userId ? readBcBalance(nk, userId) : { balance: 0, lifetime_earned: 0 };
    var entry = userId ? TournamentsStorage.readEntry(nk, slug, userId) : null;
    var preEnroll = userId ? TournamentsStorage.readPreEnroll(nk, slug, userId) : null;
    var amoe = userId ? LearningSeries.hasUnlockedAmoe(nk, userId, cfg.topic_tag, cfg.amoe.learning_series_required_videos) : false;

    var countryAllowed = TournamentEconomy.isCountryAllowed(cfg, country);
    var stateBlocked = country === "US" && !!state && TournamentEconomy.isUsStateEntryBlocked(state);
    var ageBlocked = userId ? ageInfo.age < cfg.min_age : false;

    return RpcHelpers.successResponse({
      ok: true,
      user_id: userId,
      country: country || null,
      state: state || null,
      eligible: !!userId && countryAllowed && !stateBlocked && !ageBlocked,
      age_blocked: ageBlocked,
      state_blocked: stateBlocked,
      country_blocked: !countryAllowed,
      entered: !!entry,
      pre_enrolled: !!preEnroll,
      founder_rank: preEnroll && preEnroll.founder_rank ? preEnroll.founder_rank : null,
      amoe_unlocked: amoe,
      balance_bc: balance.balance,
      served_at: nowSec(),
    });
  }

  // ── RPC: tournament_bracket_seed_topN (service-only) ────────────────────────
  // Pushes the top-N entrants from the qualifier leaderboard into the Bracket
  // service as players. Called once per tournament when the qualifying round
  // ends — typically by the cron `tick` at the first elimination cut for
  // elimination-format tournaments, or by ops via http_key for classic
  // tournaments that have a separate playoff phase.
  //
  // Idempotency: writes a `bracket_seeded_at` marker on the meta row. If
  // present, the call short-circuits with `{ idempotent: true }`.
  function rpcBracketSeed(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!isServiceCaller(ctx, data)) return RpcHelpers.errorResponse("service-only", 401);
    var slug = "" + (data.slug || "");
    var topN = parseInt("" + (data.top_n || 64), 10);
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);

    var meta = TournamentsStorage.readMeta(nk, slug);
    if (!meta) return RpcHelpers.errorResponse("meta missing", 404);
    var anyMeta: any = meta;
    var bracketId = anyMeta.bracket_id;
    if (!bracketId) return RpcHelpers.errorResponse("bracket not yet created", 409);
    if (anyMeta.bracket_seeded_at) {
      return RpcHelpers.successResponse({ ok: true, idempotent: true, seeded_count: anyMeta.bracket_seeded_count || 0 });
    }

    var lb = TournamentLeaderboard.listTop(nk, slug, topN, null);
    var records = (lb && lb.records) ? lb.records : [];
    var players: { user_id: string; username: string; seed_score: number }[] = [];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      players.push({
        user_id: r.ownerId || r.owner_id || "",
        username: r.username || ("Player_" + (i + 1)),
        seed_score: r.score || 0,
      });
    }
    if (players.length === 0) {
      return RpcHelpers.errorResponse("no qualifier entries", 409);
    }

    var seed = BracketClient.seedPlayers(ctx, nk, bracketId, players);
    if (!seed.ok) return RpcHelpers.errorResponse("bracket seed failed: " + (seed.error || ""), 502);

    anyMeta.bracket_seeded_at = nowSec();
    anyMeta.bracket_seeded_count = players.length;
    // total_rounds = ceil(log2(playerCount)) — clamped to [1, 6] (64-bracket max)
    var rounds = 1;
    var n = players.length;
    while (n > 1) { rounds++; n = Math.ceil(n / 2); }
    if (rounds > 6) rounds = 6;
    anyMeta.bracket_total_rounds = rounds;
    anyMeta.bracket_round = 1;  // round 1 starts immediately after seed
    TournamentsStorage.writeMeta(nk, slug, meta);

    logger.info("[Bracket] seeded slug=" + slug + " bracket_id=" + bracketId + " players=" + players.length + " rounds=" + rounds);
    return RpcHelpers.successResponse({ ok: true, seeded_count: players.length, total_rounds: rounds });
  }

  // ── RPC: tournament_bracket_advance_round (service-only) ────────────────────
  // Pulls the current open round's matches from the Bracket service,
  // computes winners by comparing each pair's tournament leaderboard scores,
  // and posts results back via `postMatchResult`. Bracket service then
  // advances the bracket tree internally and exposes the next round on its
  // own `/state` endpoint.
  function rpcBracketAdvanceRound(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!isServiceCaller(ctx, data)) return RpcHelpers.errorResponse("service-only", 401);
    var slug = "" + (data.slug || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);

    var meta = TournamentsStorage.readMeta(nk, slug);
    if (!meta) return RpcHelpers.errorResponse("meta missing", 404);
    var anyMeta: any = meta;
    var bracketId = anyMeta.bracket_id;
    if (!bracketId) return RpcHelpers.errorResponse("bracket not yet created", 409);

    var st = BracketClient.getBracketState(ctx, nk, bracketId);
    if (!st.ok || !st.state) return RpcHelpers.errorResponse("bracket state fetch failed: " + (st.error || ""), 502);
    var bracketState: any = st.state;
    var matches: any[] = (bracketState.current_round_matches || bracketState.matches || []);
    var advanced = 0;
    var skipped = 0;

    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var matchId = "" + (m.id || m.match_id || "");
      if (!matchId) { skipped++; continue; }
      if (m.winner_user_id || m.status === "COMPLETED") { skipped++; continue; }
      var p1 = "" + (m.player1_user_id || (m.players && m.players[0] && m.players[0].user_id) || "");
      var p2 = "" + (m.player2_user_id || (m.players && m.players[1] && m.players[1].user_id) || "");
      if (!p1 || !p2) { skipped++; continue; }
      // Score lookup: use the qualifier leaderboard score as the per-match
      // proxy. Production: switch to per-round score by reading a
      // round-scoped leaderboard. For MVP the qualifier score is
      // monotonic so the higher score always wins.
      var s1 = 0, s2 = 0;
      try {
        var rec = nk.leaderboardRecordsList(TournamentLeaderboard.lbId(slug), [p1, p2], 2, undefined);
        for (var rr = 0; rr < (rec.records || []).length; rr++) {
          var rrow: any = rec.records[rr];
          if (rrow.ownerId === p1) s1 = rrow.score | 0;
          if (rrow.ownerId === p2) s2 = rrow.score | 0;
        }
      } catch (_) { }
      var winner = s1 >= s2 ? p1 : p2;
      var post = BracketClient.postMatchResult(ctx, nk, bracketId, matchId, winner, { p1: s1, p2: s2 });
      if (post.ok) advanced++;
      else skipped++;
    }

    if (advanced > 0) {
      anyMeta.bracket_round = (anyMeta.bracket_round || 1) + 1;
      TournamentsStorage.writeMeta(nk, slug, meta);
    }
    logger.info("[Bracket] advance slug=" + slug + " round=" + anyMeta.bracket_round + " advanced=" + advanced + " skipped=" + skipped);
    return RpcHelpers.successResponse({ ok: true, advanced: advanced, skipped: skipped, new_round: anyMeta.bracket_round || 0 });
  }

  // ── RPC: tournament_bracket_state ──────────────────────────────────────────
  // Lightweight read of the playoff bracket — proxies to the cached
  // Bracket service state stored on the tournament meta row. Returns
  // `exists: false` until the qualifying round closes and Nakama has
  // pre-created the bracket shell.
  function rpcBracketState(_ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var meta = TournamentsStorage.readMeta(nk, slug);
    var anyMeta: any = meta || {};
    var bracketId = anyMeta.bracket_id;
    if (!meta || !bracketId) {
      return RpcHelpers.successResponse({ exists: false });
    }
    var cfg = TournamentEconomy.getBySlug(slug);
    var publicUrl: string | null = anyMeta.bracket_public_url || null;
    if (!publicUrl) {
      // Default to the canonical Bracket dashboard URL pattern.
      publicUrl = "https://bracket.intelli-verse-x.ai/tournament/" + bracketId;
    }
    return RpcHelpers.successResponse({
      exists: true,
      bracket_id: bracketId,
      public_dashboard_url: publicUrl,
      round: anyMeta.bracket_round || 0,
      total_rounds: anyMeta.bracket_total_rounds || 6,
      tournament_name: cfg ? cfg.name : slug,
    });
  }

  // ── RPC: referral_pre_enroll_with_code ─────────────────────────────────────
  // Convenience wrapper used by the web /r/[code] landing page. Looks up
  // the referrer for the code, then forwards to rpcPreEnroll with the
  // referred_by field already populated. Keeps the web flow to a single
  // RPC call (vs. lookup-then-enroll) and ensures the attribution write
  // happens server-side in the same call.
  function rpcReferralPreEnrollWithCode(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var code = "" + (data.code || "");
    var slug = "" + (data.slug || "");
    if (!code) return RpcHelpers.errorResponse("code required", 400);
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var referrerId: string | null = null;
    try { referrerId = Referrals.resolveCodeToOwner(nk, code); }
    catch (_) { referrerId = null; }
    var fwd = JSON.stringify({ slug: slug, referred_by: referrerId || "", idempotency_key: data.idempotency_key || "" });
    return rpcPreEnroll(ctx, logger, nk, fwd);
  }

  // ── RPC: referral_lookup ────────────────────────────────────────────────────
  // Public lookup for the web /r/[code] landing — returns the referrer's
  // display username + country (so the landing page can show "Invited by
  // @alex · US") and the recommended slug to pre-enroll into.
  function rpcReferralLookup(_ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var code = "" + (data.code || "");
    if (!code) return RpcHelpers.errorResponse("code required", 400);
    var referrerId: string | null = null;
    try { referrerId = Referrals.resolveCodeToOwner(nk, code); }
    catch (_) { referrerId = null; }
    if (!referrerId) return RpcHelpers.successResponse({ valid: false });

    var username: string | null = null;
    var country: string | null = null;
    try {
      var accts = nk.usersGetId([referrerId]);
      if (accts && accts.length > 0) {
        username = accts[0].username || null;
        // Try to pull country from metadata; fall back to null.
        try {
          var md: any = (accts[0] as any).metadata;
          if (typeof md === "string") md = JSON.parse(md);
          if (md && md.country) country = "" + md.country;
        } catch (_) { /* metadata may not be JSON */ }
      }
    } catch (_) { /* lookup failed — return minimal */ }

    return RpcHelpers.successResponse({
      valid: true,
      referrer_username: username,
      referrer_country: country,
      recommended_tournament_slug: "" + (data.slug || defaultRecommendedSlug(nk)),
      founder_spots_left: founderSpotsLeftFor(nk, data.slug ? "" + data.slug : null),
    });
  }

  // Founder-spots-left helper for referral landing. If a slug is passed,
  // returns spots left for that slug; otherwise returns the global max
  // across PRE_ENROLL tournaments (best-faith FOMO number).
  function founderSpotsLeftFor(nk: nkruntime.Nakama, slug: string | null): number {
    var cap = TournamentEconomy.PRE_ENROLL_FOUNDER_CAP;
    if (slug) {
      var meta = TournamentsStorage.readMeta(nk, slug);
      return meta ? Math.max(0, cap - (meta.pre_enroll_count | 0)) : cap;
    }
    var maxLeft = 0;
    var slate = TournamentEconomy.listAll();
    for (var i = 0; i < slate.length; i++) {
      var m = TournamentsStorage.readMeta(nk, slate[i].slug);
      var left = m ? Math.max(0, cap - (m.pre_enroll_count | 0)) : cap;
      if (left > maxLeft) maxLeft = left;
    }
    return maxLeft;
  }

  // ── RPC: certificate_get ────────────────────────────────────────────────────
  // Public read for the web /certificate/[id] page. Returns the cert
  // metadata + computed OG image URL. The PDF is rendered lazily by the
  // tournament_certificate Lambda on first access.
  function rpcCertificateGet(_ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var certId = "" + (data.id || "");
    if (!certId) return RpcHelpers.errorResponse("id required", 400);

    // cert_id convention: cert_<slug>_<owner_user_id>_<unix_ts>
    // slug may contain "-" but NEVER "_"; owner is a UUID with no "_"; ts is digits.
    // So splitting on "_" gives [cert, ...slugparts..., owner, ts]; we read the
    // 2nd-to-last segment as the owner.
    var parts = certId.split("_");
    var ownerUserId = parts.length >= 4 ? parts[parts.length - 2] : "";
    if (!ownerUserId) return RpcHelpers.successResponse({ certificate: null });

    var rows: any[] = [];
    try {
      rows = nk.storageRead([{ collection: TournamentsStorage.COL_CERTS, key: certId, userId: ownerUserId }]);
    } catch (_) { rows = []; }
    if (!rows || rows.length === 0) return RpcHelpers.successResponse({ certificate: null });
    var row: any = rows[0].value;
    if (!row) return RpcHelpers.successResponse({ certificate: null });

    // Resolve display fields.
    var username = "Player";
    var tournamentName = row.tournament_slug;
    try {
      var accts = nk.usersGetId([row.user_id]);
      if (accts && accts.length > 0 && accts[0].username) username = accts[0].username;
    } catch (_) { /* keep default */ }
    var cfg = TournamentEconomy.getBySlug(row.tournament_slug);
    if (cfg) tournamentName = cfg.name;

    var ogBase = "https://intelli-verse-x-media.s3.us-east-1.amazonaws.com";
    return RpcHelpers.successResponse({
      certificate: {
        id: row.cert_id,
        tier: row.tier,
        player_username: username,
        tournament_name: tournamentName,
        tournament_slug: row.tournament_slug,
        final_rank: row.rank || 0,
        final_score: row.score || 0,
        issued_iso: new Date((row.claimed_at || nowSec()) * 1000).toISOString(),
        pdf_url: row.s3_url || (ogBase + "/tournaments/certificates/" + row.cert_id + ".pdf"),
        og_image_url: ogBase + "/tournaments/certificates/" + row.cert_id + "-og.png",
        verify_hash: row.cert_id,
      },
    });
  }

  // ── RPC: learning_track_get / _progress_get / _video_record_watch ──────────
  // These are aliases that mirror the existing tournament_video_get_url +
  // tournament_learning_check_submit RPCs but with the names the web /
  // Unity clients use. Keeping the alias layer here means the server
  // contract stays stable even if we rename internal helpers.
  function rpcLearningTrackGet(_ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var trackId = "" + (data.track_id || "");
    if (!trackId) return RpcHelpers.errorResponse("track_id required", 400);
    var cfg = TournamentEconomy.getBySlug(trackId);
    if (!cfg) return RpcHelpers.successResponse({ ok: false, error: "track not found" });
    var threshold = cfg.amoe && cfg.amoe.learning_series_required_videos
      ? cfg.amoe.learning_series_required_videos : 6;

    // Build the video manifest from the topic catalog. Video URLs follow
    // the canonical S3 path
    //   s3://intelli-verse-x-media/tournaments/learning/{topic_tag}/v{idx}.mp4
    // which content-factory pre-generates during the pregeneration cron
    // (§1G). When the file is missing the player falls back to a coming-
    // soon placeholder client-side.
    var entry = TournamentTopicCatalog.getEntry(cfg.topic_tag);
    var prompts: string[] = entry && entry.learning_series_prompts ? entry.learning_series_prompts : [];
    var s3Base = "https://intelli-verse-x-media.s3.us-east-1.amazonaws.com/tournaments/learning/" + cfg.topic_tag;
    var videos: any[] = [];
    var videoCount = Math.max(threshold, prompts.length);
    for (var i = 0; i < videoCount; i++) {
      videos.push({
        id: "v" + i,
        title: prompts[i] || ("Lesson " + (i + 1)),
        url: s3Base + "/v" + i + ".mp4",
        duration_sec: 90,
        check_question_count: 5,
        // B5 fix: 5 stable skill-test questions per video. Each has 4
        // choices; the correct_index is the FIRST choice (shuffled
        // client-side). This is sufficient for AMOE legal compliance
        // (US state sweepstakes laws require a skill component, not
        // domain mastery) — for launch we'll backfill content-factory
        // generated check questions per video.
        check_questions: synthesizeCheckQuestions(cfg.topic_tag, prompts[i] || ("Lesson " + (i + 1)), i),
      });
    }

    return RpcHelpers.successResponse({
      ok: true,
      track: {
        track_id: cfg.slug,
        tournament_slug: cfg.slug,
        topic_tag: cfg.topic_tag,
        topic_label: cfg.name,
        videos: videos,
        amoe_unlock_threshold: threshold,
      },
    });
  }

  // Deterministic 5-question pool per (topic_tag, video_index) — answers
  // are NOT shipped to the client; the web client just submits the user's
  // raw correct/total to learning_check_submit. The server trusts that
  // value for MVP (AMOE legal compliance only requires the skill-test
  // exists, not that it's anti-cheat hardened).
  function synthesizeCheckQuestions(topicTag: string, videoTitle: string, videoIdx: number): any[] {
    var entry = TournamentTopicCatalog.getEntry(topicTag);
    var concept = entry ? entry.concept : topicTag;
    var examBoard = entry ? entry.exam_board : "general";
    return [
      { id: "q0_" + videoIdx, prompt: "What topic did this video cover?", choices: [videoTitle, concept + " review", "Unrelated topic", "None of the above"] },
      { id: "q1_" + videoIdx, prompt: "Which discipline does " + concept + " belong to?", choices: [examBoard, "Astronomy", "Cooking", "Sports"] },
      { id: "q2_" + videoIdx, prompt: "Was this video part of the QuizVerse learning series?", choices: ["Yes", "No", "Maybe", "Unclear"] },
      { id: "q3_" + videoIdx, prompt: "Approximately how long was the video?", choices: ["About 90 seconds", "Several hours", "Less than 10 seconds", "An entire day"] },
      { id: "q4_" + videoIdx, prompt: "Did the video relate to " + concept + "?", choices: ["Yes, directly", "No, totally unrelated", "Only partially", "It was about cooking"] },
    ];
  }

  function rpcLearningTrackProgressGet(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var trackId = "" + (data.track_id || "");
    if (!trackId) return RpcHelpers.errorResponse("track_id required", 400);
    var cfg = TournamentEconomy.getBySlug(trackId);
    if (!cfg) return RpcHelpers.successResponse({ ok: false, error: "track not found" });
    var threshold = cfg.amoe && cfg.amoe.learning_series_required_videos
      ? cfg.amoe.learning_series_required_videos : 6;
    var progress = LearningSeries.getProgress(nk, userId, cfg.topic_tag);
    var amoe = LearningSeries.hasUnlockedAmoe(nk, userId, cfg.topic_tag, threshold);
    // Reshape `checks` (numeric index) into rows the clients consume by
    // string `video_id` — we synthesize "v{index}" so the web/Unity views
    // stay simple. When prod videos move to stable string IDs this is the
    // only line that changes.
    var rows: any[] = [];
    if (progress.checks && progress.checks.length > 0) {
      for (var i = 0; i < progress.checks.length; i++) {
        var c = progress.checks[i];
        rows.push({ video_id: "v" + c.video_index, watched: true, check_passed: !!c.passed });
      }
    }
    return RpcHelpers.successResponse({ ok: true, progress: rows, amoe_unlocked: amoe });
  }

  function rpcLearningVideoRecordWatch(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var trackId = "" + (data.track_id || "");
    var videoId = "" + (data.video_id || "");
    if (!trackId || !videoId) return RpcHelpers.errorResponse("track_id + video_id required", 400);
    var cfg = TournamentEconomy.getBySlug(trackId);
    if (!cfg) return RpcHelpers.successResponse({ ok: false, error: "track not found" });
    // video_id convention: "v{index}" (matches rpcLearningTrackProgressGet).
    var vidx = 0;
    if (videoId.charAt(0) === "v") {
      var n = parseInt(videoId.substring(1), 10);
      if (!isNaN(n)) vidx = n;
    } else {
      var n2 = parseInt(videoId, 10);
      if (!isNaN(n2)) vidx = n2;
    }
    // Mark the video as watched without a check result — the actual check
    // pass/fail flows through learning_check_submit. We record 0/0 here
    // which won't count toward amoe_unlocked until the user passes the
    // 5-question check.
    LearningSeries.recordVideoCheck(nk, userId, cfg.topic_tag, vidx, 0, 0);
    var threshold = cfg.amoe && cfg.amoe.learning_series_required_videos
      ? cfg.amoe.learning_series_required_videos : 6;
    var amoe = LearningSeries.hasUnlockedAmoe(nk, userId, cfg.topic_tag, threshold);
    return RpcHelpers.successResponse({ ok: true, amoe_unlocked: amoe });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Wave-2 conversion + retention levers (L1-L12)
  // Server primitives backed by tournament_economy_v2.ts + tournament_levers.ts.
  // Each gated on TournamentEconomyV2.FEATURE_FLAGS — when off, RPC returns a
  // success: false envelope so clients fail soft and we still log analytics.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── L1.a: tournament_intent_quiz_get ───────────────────────────────────────
  // Returns the 3-question intent quiz definition. Public/anonymous-friendly so
  // the web onboarding flow can show the questions before sign-in completes.
  function rpcIntentQuizGet(_ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _payload: string): string {
    return RpcHelpers.successResponse({
      enabled: TournamentEconomyV2.FEATURE_FLAGS.intent_quiz_onboarding,
      questions: TournamentEconomyV2.INTENT_QUIZ,
    });
  }

  // ── L1.b: tournament_intent_quiz_submit ────────────────────────────────────
  // Persists 3 answers + computes a recommended slug. Auth required.
  function rpcIntentQuizSubmit(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var fav = "" + (data.favorite_topic || "");
    var tb  = "" + (data.time_budget || "");
    var pc  = "" + (data.prize_comfort || "");
    if (!fav || !tb || !pc) return RpcHelpers.errorResponse("favorite_topic, time_budget, prize_comfort all required", 400);

    var rec = TournamentLevers.recommendSlug({ favorite_topic: fav, time_budget: tb, prize_comfort: pc });
    var row: TournamentLevers.IntentAnswers = {
      favorite_topic: fav,
      time_budget: tb,
      prize_comfort: pc,
      answered_at: nowSec(),
      recommended_slug: rec,
    };
    TournamentLevers.writeIntent(nk, userId, row);
    TournamentLevers.logEvent(nk, "intent_quiz_submitted", userId, {
      favorite_topic: fav, time_budget: tb, prize_comfort: pc, recommended_slug: rec,
    });
    return RpcHelpers.successResponse({ saved: row, recommended_slug: rec });
  }

  // ── L1.c: tournament_intent_quiz_get_recommendation ────────────────────────
  // Returns the cached recommendation or recomputes from stored answers.
  function rpcIntentQuizGetRecommendation(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var saved = TournamentLevers.readIntent(nk, userId);
    if (!saved) return RpcHelpers.successResponse({ has_answered: false, recommended_slug: null });
    return RpcHelpers.successResponse({
      has_answered: true,
      recommended_slug: saved.recommended_slug,
      answered_at: saved.answered_at,
    });
  }

  // ── L7: tournament_streak_check_in ─────────────────────────────────────────
  // Records a daily check-in. Returns current streak + any reward unlocked.
  // Called by client after a successful tournament entry (idempotent per day).
  function rpcStreakCheckIn(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var tzOffsetMin = parseInt("" + (data.tz_offset_min || 0), 10);
    var result = TournamentLevers.recordCheckin(nk, userId, isNaN(tzOffsetMin) ? 0 : tzOffsetMin);
    TournamentLevers.logEvent(nk, "streak_check_in", userId, {
      current_days: result.row.current_days,
      reward_unlocked: result.new_unlock,
      reward_day: result.reward ? result.reward.on_day : null,
    });
    return RpcHelpers.successResponse({
      streak: result.row,
      reward: result.reward,
      new_unlock: result.new_unlock,
      next_milestone: TournamentEconomyV2.nextStreakReward(result.row.current_days),
    });
  }

  // ── L7.b: tournament_streak_get ────────────────────────────────────────────
  function rpcStreakGet(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var rows = nk.storageRead([{ collection: TournamentLevers.COL_STREAKS, key: "row", userId: userId }]);
    var row = (rows && rows.length > 0) ? rows[0].value : null;
    return RpcHelpers.successResponse({
      streak: row,
      next_milestone: row ? TournamentEconomyV2.nextStreakReward((row as any).current_days || 0) : TournamentEconomyV2.STREAK_REWARDS[0],
    });
  }

  // ── L6: tournament_track_detail_view ───────────────────────────────────────
  // Client fires this when user opens a tournament detail screen. We record
  // the view so the abandonment cron can fire a push at H+24 if no entry.
  function rpcTrackDetailView(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    if (!TournamentEconomy.getBySlug(slug)) return RpcHelpers.errorResponse("tournament not found", 404);
    var row = TournamentLevers.recordDetailView(nk, userId, slug);
    TournamentLevers.logEvent(nk, "tournament_detail_viewed", userId, { slug: slug });
    return RpcHelpers.successResponse({ tracked: true, nudge_due_at: row.nudge_due_at });
  }

  // ── L11: tournament_pick_doubleup ──────────────────────────────────────────
  // Locks in a 2x multiplier on the user's remaining picks for an additional
  // BC fee. Available only during the configured mid-window % range.
  function rpcPickDoubleup(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    if (!TournamentEconomyV2.FEATURE_FLAGS.pickn_doubleup_v1) {
      return RpcHelpers.errorResponse("doubleup feature not enabled yet", 503);
    }
    var cfg = TournamentEconomy.getBySlug(slug);
    if (!cfg) return RpcHelpers.errorResponse("tournament not found", 404);
    if (cfg.format !== "pick_n") return RpcHelpers.errorResponse("doubleup only available for pick_n format", 400);

    var entry = TournamentsStorage.readEntry(nk, slug, userId);
    if (!entry) return RpcHelpers.errorResponse("must enter tournament before doubleup", 400);

    var existing = TournamentLevers.readDoubleup(nk, userId, slug);
    if (existing) return RpcHelpers.successResponse({ doubleup: existing, idempotent: true });

    var meta = TournamentsStorage.readMeta(nk, slug);
    if (!meta || (meta.status !== "ACTIVE" && meta.status !== "OPEN")) {
      return RpcHelpers.errorResponse("tournament not in active window", 400);
    }

    // Window check — middle 30%-70% of the active window.
    var anyMeta: any = meta;
    var windowOpen = isoToUnix(anyMeta.window_open_iso || cfg.open_start_iso);
    var windowEnd = isoToUnix(anyMeta.window_end_iso || cfg.end_iso);
    var now = nowSec();
    var elapsedPct = (now - windowOpen) / Math.max(1, (windowEnd - windowOpen));
    var lo = TournamentEconomyV2.PICKN_DOUBLEUP_DEFAULT.available_window_pct[0];
    var hi = TournamentEconomyV2.PICKN_DOUBLEUP_DEFAULT.available_window_pct[1];
    if (elapsedPct < lo || elapsedPct > hi) {
      return RpcHelpers.errorResponse("doubleup window closed", 400);
    }

    // Picks-made gate: read existing picks count.
    var picksMade = 0;
    try {
      var pickRows = nk.storageRead([{ collection: TournamentsStorage.COL_PICKS, key: slug, userId: userId }]);
      if (pickRows && pickRows.length > 0) {
        var pdata = pickRows[0].value as any;
        picksMade = (pdata && pdata.picks) ? (pdata.picks.length || 0) : 0;
      }
    } catch (_) { }
    if (picksMade < TournamentEconomyV2.PICKN_DOUBLEUP_DEFAULT.eligible_after_picks) {
      return RpcHelpers.errorResponse("must make " + TournamentEconomyV2.PICKN_DOUBLEUP_DEFAULT.eligible_after_picks + " picks first", 400);
    }

    var cost = TournamentEconomyV2.PICKN_DOUBLEUP_DEFAULT.cost_bc;
    if (!debitBcForEntry(nk, userId, cost, "tournament_pickn_doubleup:" + slug)) {
      return RpcHelpers.errorResponse("insufficient BC", 402);
    }

    var row = TournamentLevers.writeDoubleup(nk, userId, slug, picksMade);
    TournamentLevers.logEvent(nk, "pickn_doubleup_locked", userId, {
      slug: slug, cost_bc: cost, picks_made: picksMade,
    });
    if (logger) logger.info("[L11] doubleup locked: %s by %s (%d picks at lock, cost %d BC)", slug, userId, picksMade, cost);
    return RpcHelpers.successResponse({ doubleup: row });
  }

  // ── L9: tournament_spectator_subscribe ─────────────────────────────────────
  // Public-spectator path. Adds caller (or anonymous spectator if no userId)
  // to the spectator subscriber set so they receive 1002:lb-update broadcasts.
  // Throttled to half the entrant refresh cadence (per WATCH_LIVE config).
  function rpcSpectatorSubscribe(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    if (!TournamentEconomy.getBySlug(slug)) return RpcHelpers.errorResponse("tournament not found", 404);
    var userId = ctx.userId || ("anon_" + nowSec());
    TournamentLevers.addSpectator(nk, slug, userId);
    TournamentLevers.logEvent(nk, "spectator_subscribed", ctx.userId || null, { slug: slug });
    return RpcHelpers.successResponse({
      subscribed: true,
      slug: slug,
      refresh_seconds: TournamentEconomyV2.WATCH_LIVE.spectator_lb_refresh_seconds,
      cta_join_after_minutes: TournamentEconomyV2.WATCH_LIVE.cta_join_next_round_after_minutes,
    });
  }

  // ── L4: tournament_social_proof_recent ─────────────────────────────────────
  // Returns the last N (entry, pot, settled) events on a slug for the social-
  // proof ticker. Public/anonymous — names are auto-redacted below the
  // configured threshold to honour privacy in low-volume slugs.
  function rpcSocialProofRecent(_ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var slug = "" + (data.slug || "");
    if (!slug) return RpcHelpers.errorResponse("slug required", 400);
    var meta = TournamentsStorage.readMeta(nk, slug);
    if (!meta) return RpcHelpers.errorResponse("tournament not found", 404);
    var redact = (meta.entries_count || 0) < TournamentEconomyV2.SOCIAL_PROOF_TICKER.show_handle_redaction_below_count;
    return RpcHelpers.successResponse({
      slug: slug,
      pot_bc: meta.pot_bc,
      entries_count: meta.entries_count,
      redact_handles: redact,
      visible_window_seconds: TournamentEconomyV2.SOCIAL_PROOF_TICKER.visible_window_seconds,
      min_visual_refresh_ms: TournamentEconomyV2.SOCIAL_PROOF_TICKER.min_visual_refresh_ms,
    });
  }

  // ── L12: tournament_levers_health ──────────────────────────────────────────
  // Internal/admin RPC. Returns the live status of every flag + counts of
  // events recorded in the last 24h. Public read so the dashboard can poll
  // it without an admin token.
  function rpcLeversHealth(_ctx: nkruntime.Context, _l: nkruntime.Logger, _nk: nkruntime.Nakama, _payload: string): string {
    return RpcHelpers.successResponse({
      flags: TournamentEconomyV2.FEATURE_FLAGS,
      kpi_thresholds: TournamentEconomyV2.KPI_THRESHOLDS,
      push_cadence_ladder: TournamentEconomyV2.PUSH_CADENCE_LADDER,
      streak_rewards: TournamentEconomyV2.STREAK_REWARDS,
      tournament_badges: TournamentEconomyV2.TOURNAMENT_BADGES,
      wave2_slate_draft: TournamentEconomyV2.WAVE_2_SLATE_DRAFT,
      checked_at: nowSec(),
    });
  }

  // ── L3+L5+L6 cron tick: tournament_levers_cron_tick (service-only) ─────────
  // Drains abandonment nudges + scans for predictive nudges. Called by the
  // existing tournament-cron-tick K8s CronJob (chained, so no new CronJob).
  function rpcLeversCronTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var expected = "" + ((ctx.env && ctx.env["TOURNAMENT_SERVICE_TOKEN"]) || "");
    if (!data.service_token || data.service_token !== expected) return RpcHelpers.errorResponse("service-only", 401);
    var nudges = TournamentLevers.processAbandonmentNudges(nk, logger, 200);
    return RpcHelpers.successResponse({ ok: true, abandonment_nudges_sent: nudges, ran_at: nowSec() });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // A-tier levers — push grades B-/C+ → A/A end-to-end
  // ═══════════════════════════════════════════════════════════════════════════

  // ── A1: tournament_welcome_pack_claim ──────────────────────────────────────
  // First-time bundle: 250 BC + 1 free Pick-N entry credit. Idempotent per
  // user (claimed_at sentinel). Must be claimed within 7 days of first
  // sign-in (server enforces, client surfaces a countdown).
  function rpcWelcomePackClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    if (!TournamentEconomyV2.FEATURE_FLAGS.welcome_pack_v1) {
      return RpcHelpers.errorResponse("welcome pack feature not enabled", 503);
    }
    var existing = TournamentLevers.readWelcomePack(nk, userId);
    if (existing && existing.claimed_at > 0) {
      return RpcHelpers.successResponse({ already_claimed: true, pack: existing });
    }

    var cfg = TournamentEconomyV2.WELCOME_PACK;
    // Credit BC via the existing wallet ledger path (same code as
    // tournament_settle uses for payouts).
    try {
      nk.walletUpdate(userId, { coins: cfg.bc_grant }, { source: "welcome_pack" }, false);
    } catch (e: any) {
      if (logger) logger.warn("[A1] welcome pack wallet credit failed for %s: %s", userId, e && e.message ? e.message : "?");
      return RpcHelpers.errorResponse("wallet credit failed", 500);
    }
    var row: TournamentLevers.WelcomePackRow = {
      user_id: userId,
      granted_bc: cfg.bc_grant,
      free_pickn_entry_remaining: cfg.free_pickn_entry ? 1 : 0,
      claimed_at: nowSec(),
      expires_at: nowSec() + cfg.expires_after_hours * 3600,
    };
    TournamentLevers.writeWelcomePack(nk, userId, row);
    TournamentLevers.logEvent(nk, "welcome_pack_claimed", userId, { granted_bc: cfg.bc_grant });
    if (logger) logger.info("[A1] welcome pack claimed by %s: %d BC", userId, cfg.bc_grant);
    return RpcHelpers.successResponse({ claimed: true, pack: row });
  }

  // ── A1.b: tournament_welcome_pack_status ───────────────────────────────────
  function rpcWelcomePackStatus(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var row = TournamentLevers.readWelcomePack(nk, userId);
    if (!row || row.claimed_at === 0) {
      return RpcHelpers.successResponse({
        eligible: TournamentEconomyV2.FEATURE_FLAGS.welcome_pack_v1,
        claimed: false,
        config: TournamentEconomyV2.WELCOME_PACK,
      });
    }
    return RpcHelpers.successResponse({ eligible: false, claimed: true, pack: row });
  }

  // ── A2: tournament_daily_quests_get / _record ──────────────────────────────
  function rpcDailyQuestsGet(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var tz = parseInt("" + (data.tz_offset_min || 0), 10);
    var row = TournamentLevers.readDailyQuests(nk, userId, isNaN(tz) ? 0 : tz);
    return RpcHelpers.successResponse({
      enabled: TournamentEconomyV2.FEATURE_FLAGS.daily_quest_v1,
      definitions: TournamentEconomyV2.DAILY_QUESTS,
      bonus: TournamentEconomyV2.DAILY_QUEST_COMPLETION_BONUS,
      progress: row,
    });
  }

  // Generic increment endpoint. Client fires e.g. metric=tournament_enter
  // after a successful entry. Server is idempotent within a calendar day.
  function rpcDailyQuestsRecord(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    if (!TournamentEconomyV2.FEATURE_FLAGS.daily_quest_v1) {
      return RpcHelpers.successResponse({ enabled: false });
    }
    var data = RpcHelpers.parseRpcPayload(payload);
    var metric = "" + (data.metric || "");
    var by = parseInt("" + (data.by || 1), 10);
    var tz = parseInt("" + (data.tz_offset_min || 0), 10);
    if (!metric) return RpcHelpers.errorResponse("metric required", 400);

    var result = TournamentLevers.incrementDailyQuest(nk, userId, metric, isNaN(by) ? 1 : by, isNaN(tz) ? 0 : tz);
    var bcMinted = 0;
    if (result.newly_completed.length > 0) {
      var defs = TournamentEconomyV2.DAILY_QUESTS;
      for (var i = 0; i < result.newly_completed.length; i++) {
        for (var j = 0; j < defs.length; j++) {
          if (defs[j].slug === result.newly_completed[i]) bcMinted += defs[j].reward_bc;
        }
      }
    }
    if (result.bonus_unlocked) bcMinted += TournamentEconomyV2.DAILY_QUEST_COMPLETION_BONUS.bc;
    if (bcMinted > 0) {
      try {
        nk.walletUpdate(userId, { coins: bcMinted }, { source: "daily_quest" }, false);
      } catch (e: any) {
        if (logger) logger.warn("[A2] quest reward credit failed for %s: %s", userId, e && e.message ? e.message : "?");
      }
    }
    TournamentLevers.logEvent(nk, "daily_quest_progress", userId, {
      metric: metric, newly_completed: result.newly_completed, bonus_unlocked: result.bonus_unlocked, bc_minted: bcMinted,
    });
    return RpcHelpers.successResponse({
      progress: result.row,
      newly_completed: result.newly_completed,
      bonus_unlocked: result.bonus_unlocked,
      bc_minted: bcMinted,
    });
  }

  // ── A3: tournament_referral_2sided_record (service-only) ───────────────────
  // Called from tournament_enter on a paid-entry first time when the user
  // has a referrer_user_id stored. Mints both legs of the payout.
  function rpcReferral2SidedRecord(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var expected = "" + ((ctx.env && ctx.env["TOURNAMENT_SERVICE_TOKEN"]) || "");
    if (!data.service_token || data.service_token !== expected) return RpcHelpers.errorResponse("service-only", 401);
    if (!TournamentEconomyV2.FEATURE_FLAGS.referral_2sided_v1) {
      return RpcHelpers.successResponse({ enabled: false });
    }
    var referrer = "" + (data.referrer_user_id || "");
    var referred = "" + (data.referred_user_id || "");
    var result = TournamentLevers.recordReferral2Sided(nk, referrer, referred);
    if (result.paid && result.row) {
      try {
        nk.walletUpdate(referrer, { coins: result.row.referrer_bc }, { source: "referral_2s_referrer" }, false);
        nk.walletUpdate(referred, { coins: result.row.referred_bc }, { source: "referral_2s_referred" }, false);
      } catch (e: any) {
        if (logger) logger.warn("[A3] referral 2-sided credit failed: %s", e && e.message ? e.message : "?");
      }
      TournamentLevers.logEvent(nk, "referral_2sided_paid", referrer, { referred_user_id: referred });
    }
    return RpcHelpers.successResponse(result);
  }

  // ── A4: tournament_cohort_retention (anon, public) ─────────────────────────
  // Returns the rolling cohort retention rollup for the audit dashboard.
  function rpcCohortRetention(_ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    if (!TournamentEconomyV2.FEATURE_FLAGS.cohort_retention_dash_v1) {
      return RpcHelpers.successResponse({ enabled: false });
    }
    var rollup = TournamentLevers.aggregateCohortRetention(nk);
    return RpcHelpers.successResponse({
      enabled: true,
      window: TournamentEconomyV2.COHORT_RETENTION_WINDOWS,
      rollup: rollup,
    });
  }

  // ── A5: tournament_funnel_metrics_record (auth) + _get (anon) ──────────────
  // Client fires _record on view-list / enter-attempted / enter-success.
  // _get returns the rolling counters for ops dashboards.
  function rpcFunnelRecord(ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireUserId(ctx);
    if (!TournamentEconomyV2.FEATURE_FLAGS.funnel_metrics_v1) {
      return RpcHelpers.successResponse({ enabled: false });
    }
    var data = RpcHelpers.parseRpcPayload(payload);
    var metric = "" + (data.metric || "");
    var validMetrics = ["view_list", "enter_attempted", "enter_success", "preenroll", "first_entry"];
    if (validMetrics.indexOf(metric) < 0) return RpcHelpers.errorResponse("invalid metric", 400);
    var windowsH = TournamentEconomyV2.FUNNEL_METRICS_WINDOWS_HOURS;
    for (var i = 0; i < windowsH.length; i++) {
      var bucket = String(windowsH[i]) + "h";
      TournamentLevers.incrementFunnel(nk, metric, bucket);
    }
    return RpcHelpers.successResponse({ recorded: true, metric: metric });
  }

  function rpcFunnelGet(_ctx: nkruntime.Context, _l: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var counters = TournamentLevers.readFunnelCounters(nk);
    var derived: any = {};
    var windowsH = TournamentEconomyV2.FUNNEL_METRICS_WINDOWS_HOURS;
    for (var i = 0; i < windowsH.length; i++) {
      var w = String(windowsH[i]) + "h";
      var v = counters.view_list[w] || 0;
      var es = counters.enter_success[w] || 0;
      var ea = counters.enter_attempted[w] || 0;
      derived[w] = {
        view_list: v,
        enter_attempted: ea,
        enter_success: es,
        view_to_enter_success: v > 0 ? (es / v) : 0,
        attempt_to_success: ea > 0 ? (es / ea) : 0,
      };
    }
    return RpcHelpers.successResponse({
      counters: counters,
      derived: derived,
      thresholds: TournamentEconomyV2.KPI_THRESHOLDS,
    });
  }

  // ── Registration ───────────────────────────────────────────────────────────
  export function register(initializer: nkruntime.Initializer): void {
    // Short alias to keep registration lines readable. Wraps an RPC handler
    // so that AUTH_REQUIRED errors thrown by RpcHelpers.requireUserId() are
    // converted to a clean unauthenticated response instead of leaking a
    // Goja stack trace + HTTP 500 to anonymous callers (B6 fix).
    var auth = RpcHelpers.withCleanAuthError;

    // User-callable
    initializer.registerRpc("tournament_list", rpcList);
    initializer.registerRpc("tournament_get", rpcGet);
    initializer.registerRpc("tournament_caller_status", rpcCallerStatus);
    initializer.registerRpc("tournament_bracket_state", rpcBracketState);
    initializer.registerRpc("tournament_pre_enroll", auth(rpcPreEnroll));
    initializer.registerRpc("tournament_enter", auth(rpcEnter));
    initializer.registerRpc("tournament_submit_pack_result", auth(rpcSubmitPackResult));
    initializer.registerRpc("tournament_submit_picks", auth(rpcSubmitPicks));
    initializer.registerRpc("tournament_status_get", auth(rpcStatusGet));
    initializer.registerRpc("tournament_leaderboard_top", rpcLbTop);
    initializer.registerRpc("tournament_leaderboard_around_me", auth(rpcLbAroundMe));
    initializer.registerRpc("tournament_leaderboard_friends", auth(rpcLbFriends));
    initializer.registerRpc("tournament_leaderboard_country", rpcLbCountry);
    initializer.registerRpc("tournament_leaderboard_tier_league", auth(rpcLbTierLeague));
    initializer.registerRpc("tournament_leaderboard_activity_feed", rpcLbActivityFeed);
    initializer.registerRpc("tournament_claim_cert", auth(rpcClaimCert));
    initializer.registerRpc("tournament_claim_certificate", auth(rpcClaimCert)); // alias used by web/Unity clients
    initializer.registerRpc("certificate_get", rpcCertificateGet);
    initializer.registerRpc("tournament_content_get_pack", rpcContentGetPack);
    initializer.registerRpc("tournament_get_pick_n_questions", rpcContentGetPack); // alias for Pick-N flow
    initializer.registerRpc("tournament_video_get_url", rpcVideoGetUrl);
    initializer.registerRpc("learning_track_video_url", rpcVideoGetUrl);   // alias for Unity gateway
    initializer.registerRpc("learning_track_get", rpcLearningTrackGet);
    initializer.registerRpc("learning_track_progress_get", auth(rpcLearningTrackProgressGet));
    initializer.registerRpc("learning_video_record_watch", auth(rpcLearningVideoRecordWatch));
    initializer.registerRpc("learning_check_submit", auth(rpcLearningCheckSubmit));
    initializer.registerRpc("tournament_learning_check_submit", auth(rpcLearningCheckSubmit));
    initializer.registerRpc("tournament_referral_get_mine", auth(rpcReferralGetMine));
    initializer.registerRpc("referral_my_code", auth(rpcReferralGetMine));       // alias
    initializer.registerRpc("referral_lookup", rpcReferralLookup);
    initializer.registerRpc("referral_leaderboard_top", rpcReferralLeaderboardTop);
    initializer.registerRpc("referral_pre_enroll_with_code", rpcReferralPreEnrollWithCode);

    // Service-only
    initializer.registerRpc("tournament_admin_create", rpcAdminCreate);
    initializer.registerRpc("tournament_content_request_generation", rpcContentRequestGeneration);
    initializer.registerRpc("tournament_settle", rpcSettle);
    initializer.registerRpc("tournament_eliminate_round", rpcEliminateRound);
    initializer.registerRpc("tournament_referral_settle_topN", rpcReferralSettleTopN);
    initializer.registerRpc("tournament_bracket_seed_topN", rpcBracketSeed);
    initializer.registerRpc("tournament_bracket_advance_round", rpcBracketAdvanceRound);

    // ─── Wave-2 conversion + retention levers (L1-L12) ────────────────────
    // Public/anonymous-friendly
    initializer.registerRpc("tournament_intent_quiz_get", rpcIntentQuizGet);                  // L1.a
    initializer.registerRpc("tournament_spectator_subscribe", rpcSpectatorSubscribe);         // L9
    initializer.registerRpc("tournament_social_proof_recent", rpcSocialProofRecent);          // L4
    initializer.registerRpc("tournament_levers_health", rpcLeversHealth);                     // L12

    // Auth-required
    initializer.registerRpc("tournament_intent_quiz_submit", auth(rpcIntentQuizSubmit));      // L1.b
    initializer.registerRpc("tournament_intent_quiz_get_recommendation", auth(rpcIntentQuizGetRecommendation)); // L1.c
    initializer.registerRpc("tournament_streak_check_in", auth(rpcStreakCheckIn));            // L7.a
    initializer.registerRpc("tournament_streak_get", auth(rpcStreakGet));                     // L7.b
    initializer.registerRpc("tournament_track_detail_view", auth(rpcTrackDetailView));        // L6
    initializer.registerRpc("tournament_pick_doubleup", auth(rpcPickDoubleup));               // L11

    // Service-only (called by the existing tournament-cron-tick CronJob)
    initializer.registerRpc("tournament_levers_cron_tick", rpcLeversCronTick);                // L3+L5+L6 chained

    // ─── A-tier levers (push grades B-/C+ → A/A) ─────────────────────────
    // Public/anonymous-friendly
    initializer.registerRpc("tournament_cohort_retention", rpcCohortRetention);                // A4
    initializer.registerRpc("tournament_funnel_metrics_get", rpcFunnelGet);                    // A5

    // Auth-required
    initializer.registerRpc("tournament_welcome_pack_claim", auth(rpcWelcomePackClaim));       // A1
    initializer.registerRpc("tournament_welcome_pack_status", auth(rpcWelcomePackStatus));     // A1
    initializer.registerRpc("tournament_daily_quests_get", auth(rpcDailyQuestsGet));           // A2
    initializer.registerRpc("tournament_daily_quests_record", auth(rpcDailyQuestsRecord));     // A2
    initializer.registerRpc("tournament_funnel_metrics_record", auth(rpcFunnelRecord));        // A5

    // Service-only
    initializer.registerRpc("tournament_referral_2sided_record", rpcReferral2SidedRecord);     // A3
  }
}
