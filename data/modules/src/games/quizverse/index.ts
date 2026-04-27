// QuizVerse multiplayer plugin — wires the QuizVerse turn generator into
// the IVX SyncTurnMatch template and exposes thin wrapper RPCs for
// client adapters that prefer game-specific endpoints over the generic
// `mp_create_match`.
//
// Mounted from src/main.ts AFTER MpKernelModule.register() so that the
// kernel + sync-turn template are already alive when we register our
// generators.

namespace QuizVersePlugin {
  // RPC ids — keep stable; adapters depend on these strings.
  export var RPC_CREATE_MATCH = "quizverse_create_match";
  export var RPC_LOAD_PACK    = "quizverse_load_pack";
  export var RPC_LIST_PACKS   = "quizverse_list_packs";

  function nakamaError(msg: string, code: number): nkruntime.Error {
    return { message: msg, code: code };
  }

  function buildBattle(raw: any): QuizVerseGame.IBattleConfig | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    var modeNum = (typeof raw.mode === "number") ? raw.mode : QuizVerseGame.BattleMode.ONE_VS_ONE;
    if (modeNum < QuizVerseGame.BattleMode.ONE_VS_ONE || modeNum > QuizVerseGame.BattleMode.FIVE_VS_FIVE) {
      throw nakamaError("battle.mode must be 1..5", nkruntime.Codes.INVALID_ARGUMENT);
    }
    var topics: string[] = [];
    if (raw.topics && Object.prototype.toString.call(raw.topics) === "[object Array]") {
      for (var i = 0; i < raw.topics.length; i++) {
        if (typeof raw.topics[i] === "string") topics.push(raw.topics[i]);
      }
    }
    return {
      mode:            modeNum,
      team1_name:      (raw.team1_name && String(raw.team1_name)) || "Team 1",
      team2_name:      (raw.team2_name && String(raw.team2_name)) || "Team 2",
      timeout_seconds: (typeof raw.timeout_seconds === "number") ? raw.timeout_seconds : 180,
      room_code:       (raw.room_code && String(raw.room_code)) || "",
      challenger_id:   (raw.challenger_id && String(raw.challenger_id)) || "",
      challenger_name: (raw.challenger_name && String(raw.challenger_name)) || "",
      topics:          topics
    };
  }

  function buildInit(raw: any): QuizVerseGame.IInit {
    var out: QuizVerseGame.IInit = {
      mode:            (raw && raw.mode)            || QuizVerseGame.DefaultInit.mode,
      pack_id:         (raw && raw.pack_id)         || QuizVerseGame.DefaultInit.pack_id,
      questions_total: (raw && raw.questions_total) || QuizVerseGame.DefaultInit.questions_total,
      per_question_ms: (raw && raw.per_question_ms) || QuizVerseGame.DefaultInit.per_question_ms,
      room_code:       (raw && raw.room_code)       || "",
      ai_host_persona: (raw && raw.ai_host_persona) || "",
      enable_voice:    !!(raw && raw.enable_voice),
      battle:          (raw && raw.battle) ? buildBattle(raw.battle) : undefined
    };
    // Validate ranges so a malformed adapter cannot crash the match
    // template (e.g. infinite-turn match draining the runtime).
    if (out.questions_total < 1 || out.questions_total > 50) {
      throw nakamaError("questions_total must be 1..50", nkruntime.Codes.INVALID_ARGUMENT);
    }
    if (out.per_question_ms < 3000 || out.per_question_ms > 60000) {
      throw nakamaError("per_question_ms must be 3000..60000", nkruntime.Codes.INVALID_ARGUMENT);
    }
    var validMode = false;
    for (var k in QuizVerseGame.Mode) {
      if (QuizVerseGame.Mode.hasOwnProperty(k) && (QuizVerseGame.Mode as any)[k] === out.mode) {
        validMode = true; break;
      }
    }
    if (!validMode) {
      throw nakamaError("unknown mode: " + out.mode, nkruntime.Codes.INVALID_ARGUMENT);
    }
    // Friend-Battle requires a battle config (cardinality is what
    // determines max_players).
    if (out.mode === QuizVerseGame.Mode.FRIEND_BATTLE && !out.battle) {
      throw nakamaError("friend_battle requires battle config", nkruntime.Codes.INVALID_ARGUMENT);
    }
    return out;
  }

  // Friend-battle / Link-and-Play sanity: room code must be 4-8 alnum.
  function validateRoomCode(code: string): void {
    if (!code) return;
    if (code.length < 4 || code.length > 8) {
      throw nakamaError("room_code length 4..8", nkruntime.Codes.INVALID_ARGUMENT);
    }
    for (var i = 0; i < code.length; i++) {
      var c = code.charCodeAt(i);
      var ok = (c >= 0x30 && c <= 0x39) ||  // 0-9
               (c >= 0x41 && c <= 0x5A) ||  // A-Z
               (c >= 0x61 && c <= 0x7A);    // a-z
      if (!ok) throw nakamaError("room_code must be alnum", nkruntime.Codes.INVALID_ARGUMENT);
    }
  }

  // Wrapper around mp_create_match that fixes template_id=sync-turn-v1,
  // sets generator_id from QuizVerse mode, and pre-fills sane defaults.
  // Adapters MAY still call mp_create_match directly; this exists for
  // discoverability and to centralise QuizVerse validation logic.
  function rpcCreateMatch(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var raw: any;
    try { raw = JSON.parse(payload || "{}"); }
    catch (_e) { throw nakamaError("bad json", nkruntime.Codes.INVALID_ARGUMENT); }

    var init = buildInit(raw);
    validateRoomCode(init.room_code || "");
    // Validate pack exists before spinning up the match — better to
    // fail here than have the generator log a warning mid-game and
    // silently fall back to seed content.
    try {
      QuizVersePackStore.readPack(nk, init.pack_id);
    } catch (e: any) {
      throw nakamaError("pack not found: " + init.pack_id, nkruntime.Codes.NOT_FOUND);
    }

    // Build the kernel template_init. The SyncTurn template merges this
    // over its DefaultInit, so we only override what we need.
    var maxPlayers = 5;       // Classic default
    var minPlayers = 2;
    if (init.mode === QuizVerseGame.Mode.LINK_AND_PLAY) {
      maxPlayers = 2; minPlayers = 2;
    } else if (init.mode === QuizVerseGame.Mode.FRIEND_BATTLE) {
      var bm = (init.battle && init.battle.mode) || QuizVerseGame.BattleMode.ONE_VS_ONE;
      maxPlayers = QuizVerseGame.maxPlayersForMode(bm);
      minPlayers = maxPlayers; // Friend-Battle: must be full to start
    }

    var templateInit: any = {
      generator_id:            init.mode,
      min_players:             minPlayers,
      max_players:             maxPlayers,
      default_input_window_ms: init.per_question_ms,
      // game_id stamped on the match label so admin-dashboard filters work.
      game_id:                 "quizverse",
      // QuizVerse-specific bag forwarded to the generator's initBlob.
      mode:                    init.mode,
      pack_id:                 init.pack_id,
      questions_total:         init.questions_total,
      per_question_ms:         init.per_question_ms,
      room_code:               init.room_code || "",
      ai_host_persona:         init.ai_host_persona || "",
      enable_voice:            !!init.enable_voice,
      battle:                  init.battle || null
    };

    var matchId: string;
    try {
      matchId = nk.matchCreate(MpKernelModule.TEMPLATE_IDS.SYNC_TURN_V1, {
        game_id: "quizverse",
        region: raw.region || "",
        template_init: templateInit,
        creator_user_id: ctx.userId || ""
      });
    } catch (err: any) {
      logger.warn("[QuizVerse] matchCreate failed: " + (err && err.message ? err.message : String(err)));
      throw nakamaError("matchCreate failed", nkruntime.Codes.INTERNAL);
    }

    return JSON.stringify({
      match_id: matchId,
      template_id: MpKernelModule.TEMPLATE_IDS.SYNC_TURN_V1,
      mode: init.mode,
      game_id: "quizverse",
      pack_id: init.pack_id,
      questions_total: init.questions_total,
      per_question_ms: init.per_question_ms,
      battle: init.battle || null,
      max_players: maxPlayers,
      min_players: minPlayers,
      server_unix_ms: Date.now()
    });
  }

  // Admin-only — push a new question pack into Nakama storage. In prod
  // this is invoked by the CMS sync job in `web/packages/admin/...`,
  // gated behind admin role. Plain users cannot invoke (we check
  // ctx.userId is present and matches the SYSTEM_USER_ID env).
  function rpcLoadPack(
    ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var systemId = ctx.env && ctx.env["IVX_SYSTEM_USER_ID"];
    if (!systemId || ctx.userId !== systemId) {
      throw nakamaError("admin only", nkruntime.Codes.PERMISSION_DENIED);
    }
    var pack: QuizVerseGame.IPack;
    try { pack = JSON.parse(payload) as QuizVerseGame.IPack; }
    catch (_e) { throw nakamaError("bad json", nkruntime.Codes.INVALID_ARGUMENT); }

    if (!pack.pack_id || !pack.questions || pack.questions.length < 1) {
      throw nakamaError("pack must have pack_id + >=1 questions", nkruntime.Codes.INVALID_ARGUMENT);
    }
    // Per-question structural validation. Bad packs in storage cause
    // silent gameplay corruption (wrong correct_index across all
    // matches that load the pack), so reject up-front.
    for (var i = 0; i < pack.questions.length; i++) {
      var q = pack.questions[i];
      if (!q.question_id || !q.text || !q.options || q.options.length < 2 || q.options.length > 6) {
        throw nakamaError("question " + i + " invalid (need id,text,2..6 options)", nkruntime.Codes.INVALID_ARGUMENT);
      }
      if (typeof q.correct_index !== "number" || q.correct_index < 0 || q.correct_index >= q.options.length) {
        throw nakamaError("question " + i + " correct_index out of range", nkruntime.Codes.INVALID_ARGUMENT);
      }
    }
    QuizVersePackStore.writePack(nk, pack);
    return JSON.stringify({ ok: true, pack_id: pack.pack_id, questions: pack.questions.length });
  }

  // List currently-stored packs. Public read so adapters can show a
  // pack-picker UI without an admin token.
  function rpcListPacks(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    _payload: string
  ): string {
    var page = nk.storageList("", QuizVersePackStore.COLLECTION, 100);
    var out: Array<{ pack_id: string; questions: number; revision: number; locale: string }> = [];
    if (page && page.objects) {
      for (var i = 0; i < page.objects.length; i++) {
        var obj = page.objects[i];
        var v = obj.value as QuizVerseGame.IPack;
        out.push({
          pack_id:   obj.key,
          questions: v && v.questions ? v.questions.length : 0,
          revision:  (v && v.revision) || 0,
          locale:    (v && v.locale) || ""
        });
      }
    }
    // Always include the embedded seed so smoke tests can run before
    // any production pack has been uploaded.
    var hasSeed = false;
    for (var j = 0; j < out.length; j++) {
      if (out[j].pack_id === QuizVerseGame.SEED_PACK.pack_id) { hasSeed = true; break; }
    }
    if (!hasSeed) {
      out.push({
        pack_id:   QuizVerseGame.SEED_PACK.pack_id,
        questions: QuizVerseGame.SEED_PACK.questions.length,
        revision:  QuizVerseGame.SEED_PACK.revision || 0,
        locale:    QuizVerseGame.SEED_PACK.locale || ""
      });
    }
    return JSON.stringify({ packs: out });
  }

  export function register(
    initializer: nkruntime.Initializer,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger
  ): void {
    QuizVerseGenerator.registerNk(nk);
    var gens = QuizVerseGenerator.buildAll();
    for (var i = 0; i < gens.length; i++) {
      MpKernelSyncTurn.registerGenerator(gens[i]);
    }
    initializer.registerRpc(RPC_CREATE_MATCH, rpcCreateMatch);
    initializer.registerRpc(RPC_LOAD_PACK,    rpcLoadPack);
    initializer.registerRpc(RPC_LIST_PACKS,   rpcListPacks);
    logger.info("[QuizVerse] plugin registered; generators=" + gens.length + " modes=classic|friend_battle|link_and_play");
  }
}
