// IVX Multiplayer Kernel — registration entry point.
//
// Mounted by `data/modules/src/main.ts` after AnalyticsAlerts. Adds:
//   - `mp_create_match` RPC (any game): creates a match of a given template.
//   - All shipped templates (sync-turn-v1 to start; more added in P5+).
//   - System RPCs for admin sign-off + dashboard ingestion.

namespace MpKernelModule {
  // Public stable IDs so external SDKs and game plugins can refer to
  // templates by string. Adding a template = bump this list + bump the
  // schema's reserved opcode allocation.
  export var TEMPLATE_IDS = {
    SYNC_TURN_V1:           "sync-turn-v1",
    ASYNC_TURN_V1:          "async-turn-v1",
    REALTIME_TICK_V1:       "realtime-tick-v1",
    LOBBY_HANDOFF_V1:       "lobby-handoff-v1",
    TOURNAMENT_V1:          "tournament-v1",
    LIVE_EVENT_V1:          "live-event-v1",
    PERSISTENT_PARTY_V1:    "persistent-party-v1",
    AVATAR_REPLICATION_V1:  "avatar-replication-v1",
    MR_ANCHOR_V1:           "mixed-reality-anchor-v1",
    CONVERSATIONAL_PARTY_V1:"conversational-party-v1"
  };

  export interface ICreateMatchRpcRequest {
    template_id: string;
    game_id: string;
    region?: string;
    template_init?: any; // Per-template; e.g. SyncTurnInitParams.
    label?: string;      // Optional override; usually built from template_init.
  }

  export interface ICreateMatchRpcResponse {
    match_id: string;
    template_id: string;
    game_id: string;
    region: string;
    server_unix_ms: number;
  }

  // Lookup table populated by registerTemplate().
  var registeredTemplateIds: { [id: string]: boolean } = {};

  export function registerTemplateId(id: string): void {
    registeredTemplateIds[id] = true;
  }

  function isKnownTemplate(id: string): boolean {
    return registeredTemplateIds[id] === true;
  }

  // The single RPC every adapter calls to spin up a match. Game plugins
  // typically expose game-specific wrappers (e.g. `quizverse_create_match`)
  // that call this with their template_init pre-filled.
  export function rpcCreateMatch(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var req: ICreateMatchRpcRequest;
    try {
      req = JSON.parse(payload || "{}") as ICreateMatchRpcRequest;
    } catch (e) {
      throw nakamaError("bad json: " + (e && (e as any).message ? (e as any).message : String(e)),
        nkruntime.Codes.INVALID_ARGUMENT);
    }
    if (!req.template_id) {
      throw nakamaError("template_id required", nkruntime.Codes.INVALID_ARGUMENT);
    }
    if (!isKnownTemplate(req.template_id)) {
      throw nakamaError("unknown template_id=" + req.template_id, nkruntime.Codes.NOT_FOUND);
    }

    var matchParams: { [k: string]: any } = {
      game_id: req.game_id || "unknown",
      region: req.region || "",
      template_init: req.template_init || {},
      creator_user_id: ctx.userId || ""
    };
    var matchId: string;
    try {
      matchId = nk.matchCreate(req.template_id, matchParams);
    } catch (err: any) {
      logger.warn("[MpKernel] matchCreate failed template=%s err=%s",
        req.template_id, (err && err.message) ? err.message : String(err));
      throw nakamaError("matchCreate failed", nkruntime.Codes.INTERNAL);
    }

    var resp: ICreateMatchRpcResponse = {
      match_id: matchId,
      template_id: req.template_id,
      game_id: req.game_id || "",
      region: req.region || "",
      server_unix_ms: Date.now()
    };
    return JSON.stringify(resp);
  }

  // Read a persisted match result. Used by admin tools + the SLO board.
  export function rpcReadMatchResult(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var req: { match_id: string };
    try {
      req = JSON.parse(payload || "{}");
    } catch (e) {
      throw nakamaError("bad json", nkruntime.Codes.INVALID_ARGUMENT);
    }
    if (!req.match_id) throw nakamaError("match_id required", nkruntime.Codes.INVALID_ARGUMENT);
    var row = MpKernelMatchResult.read(nk, req.match_id);
    if (!row) throw nakamaError("not found", nkruntime.Codes.NOT_FOUND);
    return JSON.stringify(row);
  }

  // List the registered templates so the JS adapter can validate
  // template_ids client-side at compile-time codegen.
  export function rpcListTemplates(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    _nk: nkruntime.Nakama,
    _payload: string
  ): string {
    var owners = MpKernelCodeRegistry.listAll();
    var out = {
      templates: [] as Array<{ id: string; from: number; to: number }>
    };
    for (var i = 0; i < owners.length; i++) {
      if (owners[i].template_id) {
        out.templates.push({
          id: owners[i].template_id as string,
          from: owners[i].from,
          to: owners[i].to
        });
      }
    }
    return JSON.stringify(out);
  }

  function nakamaError(msg: string, code: number): nkruntime.Error {
    return { message: msg, code: code };
  }

  // Built-in "echo" generator. SDK adapters and the conformance suite use
  // this to smoke-test the kernel end-to-end without needing a real game
  // plugin loaded. Game plugins MUST register their own generator id (e.g.
  // "quizverse:classic") and not collide with this one.
  var ECHO_GENERATOR: MpKernelSyncTurn.IGenerator = {
    generatorId: "echo",
    initBlob: function (init: any) {
      var maxTurns = init && init.max_turns ? init.max_turns : 1;
      return { remaining: maxTurns, served: 0 };
    },
    nextTurn: function (ctx) {
      var blob = ctx.blob || { remaining: 1, served: 0 };
      if (blob.remaining <= 0) return null;
      blob.remaining--;
      blob.served++;
      var isFinal = blob.remaining <= 0;
      return {
        turn_payload: { kind: "echo", index: ctx.turn_index },
        result_payload_for_correct: { ack: true },
        score_for_correct_full: 1,
        score_for_wrong: 0,
        score_for_no_submit: 0,
        input_window_ms: ctx.template_init && ctx.template_init.default_input_window_ms ? ctx.template_init.default_input_window_ms : 5000,
        is_final_turn: isFinal
      };
    },
    scoreSubmission: function (_submission, _correct, _responseMs, baseReward) {
      // Any submission counts as "correct" for echo.
      return baseReward;
    },
    buildResolvedPayload: function (correctPayload, verdicts, responseMs) {
      return {
        kind: "echo_resolved",
        result_payload: correctPayload,
        verdicts: verdicts,
        response_ms: responseMs
      };
    }
  };

  // Built-in async-turn echo generator. Two-player ping-pong: each move
  // toggles the active actor; "ended:true" in the move payload finishes
  // the game with that actor as winner. Used by SDK conformance tests.
  var ASYNC_ECHO_GENERATOR: MpKernelAsyncTurn.IAsyncTurnGenerator = {
    generatorId: "async-echo",
    initState: function (init: any, persisted: any | null) {
      if (persisted && persisted.state) {
        return {
          state: persisted.state,
          actor: persisted.actor || init.starting_actor || "",
          ended: !!persisted.ended,
          winner_user_id: persisted.winner_user_id || ""
        };
      }
      return {
        state: { moves: 0, history: [] as any[] },
        actor: init.starting_actor || "",
        ended: false
      };
    },
    applyMove: function (state: any, userId: string, payload: any) {
      var s = state || { moves: 0, history: [] };
      s.moves = (s.moves || 0) + 1;
      s.history = s.history || [];
      s.history.push({ user: userId, payload: payload || {} });
      var ended = !!(payload && payload.ended);
      return {
        state: s,
        actor: ended ? "" : "", // Game plugin should override; echo doesn't track opponent
        ended: ended,
        winner_user_id: ended ? userId : "",
        broadcast_payload: { move_index: s.moves, payload: payload || {} }
      };
    },
    buildResult: function (state: any, actors: string[], winnerUserId: string, ended: boolean) {
      return {
        moves: state ? state.moves || 0 : 0,
        history: state ? state.history || [] : [],
        actors: actors,
        winner_user_id: winnerUserId,
        ended: ended
      };
    }
  };

  // Single boot path: registers all built-in templates + RPCs.
  export function register(initializer: nkruntime.Initializer, logger: nkruntime.Logger): void {
    MpKernelCodeRegistry.bootstrapKernelRanges();

    // Templates ship one-by-one; P1 ships SyncTurnMatch, P5 adds
    // AsyncTurnMatch + LobbyHandoffMatch.
    MpKernelMatch.registerTemplate(initializer, MpKernelSyncTurn.template, logger);
    registerTemplateId(MpKernelSyncTurn.template.templateId);
    MpKernelSyncTurn.registerGenerator(ECHO_GENERATOR);

    MpKernelMatch.registerTemplate(initializer, MpKernelAsyncTurn.template, logger);
    registerTemplateId(MpKernelAsyncTurn.template.templateId);
    MpKernelAsyncTurn.registerGenerator(ASYNC_ECHO_GENERATOR);

    MpKernelMatch.registerTemplate(initializer, MpKernelLobbyHandoff.template, logger);
    registerTemplateId(MpKernelLobbyHandoff.template.templateId);

    MpKernelMatch.registerTemplate(initializer, MpKernelTournament.template, logger);
    registerTemplateId(MpKernelTournament.template.templateId);

    MpKernelMatch.registerTemplate(initializer, MpKernelLiveEvent.template, logger);
    registerTemplateId(MpKernelLiveEvent.template.templateId);

    MpKernelMatch.registerTemplate(initializer, MpKernelPersistentParty.template, logger);
    registerTemplateId(MpKernelPersistentParty.template.templateId);

    MpKernelMatch.registerTemplate(initializer, MpKernelConvParty.template, logger);
    registerTemplateId(MpKernelConvParty.template.templateId);

    MpKernelMatch.registerTemplate(initializer, MpKernelMrAnchor.template, logger);
    registerTemplateId(MpKernelMrAnchor.template.templateId);

    // RealtimeTickMatch lives in a native Go plugin (data/modules/realtime_tick.so)
    // so it can run at 10–30 Hz without paying the Goja per-tick cost. The Go
    // plugin registers the match handler under "realtime-tick-v1" at boot via
    // its own InitModule. Here we ONLY whitelist the template_id so
    // `mp_create_match` will accept it — without this guard the RPC returns
    // NOT_FOUND even though the Go side is ready. Also reserve the opcode
    // range so other JS templates can't collide with realtime-tick wires.
    registerTemplateId(TEMPLATE_IDS.REALTIME_TICK_V1);
    try {
      MpKernelCodeRegistry.register({
        name: TEMPLATE_IDS.REALTIME_TICK_V1,
        from: 0x6000,
        to: 0x6FFF,
        template_id: TEMPLATE_IDS.REALTIME_TICK_V1
      });
    } catch (e) {
      // Range already reserved (re-register on hot reload). Idempotent.
      logger.debug("[MpKernel] realtime-tick range already reserved: " +
        ((e && (e as any).message) ? (e as any).message : String(e)));
    }

    // AvatarReplicationMatch lives in a native Go plugin
    // (data/modules/avatar_replication/main.go → avatar_replication.so) so it
    // can sustain 60–90 Hz pose tick with delta + quantization + AOI without
    // paying the Goja per-tick cost. The Go plugin registers the match
    // handler under "avatar-replication-v1" at boot via its own InitModule.
    // Here we whitelist the template_id so `mp_create_match` accepts it and
    // reserve opcode range 0xF000–0xFFFF (XR pose fast-path) so other JS
    // templates can't collide with XR wires.
    registerTemplateId(TEMPLATE_IDS.AVATAR_REPLICATION_V1);
    try {
      MpKernelCodeRegistry.register({
        name: TEMPLATE_IDS.AVATAR_REPLICATION_V1,
        from: 0xF000,
        to: 0xFFFF,
        template_id: TEMPLATE_IDS.AVATAR_REPLICATION_V1
      });
    } catch (e) {
      logger.debug("[MpKernel] avatar-replication range already reserved: " +
        ((e && (e as any).message) ? (e as any).message : String(e)));
    }

    initializer.registerRpc("mp_create_match",       rpcCreateMatch);
    initializer.registerRpc("mp_read_match_result",  rpcReadMatchResult);
    initializer.registerRpc("mp_list_templates",     rpcListTemplates);

    // Voice-provider plumbing: register the `mp_voice_token` RPC. The
    // active LiveKit minter is constructed lazily on first RPC call
    // (config from storage `ivx_runtime_configs / mp_voice_livekit`,
    // with fallback to a literal env map set via
    // `MpKernelVoiceProviders.installEnv({...})` for tests/local dev).
    try {
      var voiceEnvOverride = (MpKernel as any).voiceEnv as ({ [k: string]: string } | undefined);
      if (voiceEnvOverride) {
        MpKernelVoiceProviders.installEnv(voiceEnvOverride);
      }
      MpKernelVoiceProviders.register(initializer, logger);
    } catch (e: any) {
      logger.warn("[MpKernel] voice-providers register failed: " +
        ((e && e.message) ? e.message : String(e)));
    }

    // First-class AI-agent kernel service. Templates obtain agent
    // operations via the (MpKernel as any).agentSpawn / agentSpeak hooks
    // wired by this call. Goja runtime has no `process.env`; gate via
    // a kernel-level constant set by adapters at boot if a deployment
    // wants to suppress the agent service entirely.
    if (!(MpKernel as any).disableAgents) {
      try {
        MpKernelAgent.register(initializer, logger);
      } catch (e: any) {
        logger.warn("[MpKernel] agent service register failed: " +
          ((e && e.message) ? e.message : String(e)));
      }
    } else {
      logger.info("[MpKernel] agents disabled via MpKernel.disableAgents");
    }

    // Real-time moderation pipeline (voice ASR → text classifier →
    // action). Mounts MpKernel.moderateAgentSpeech / moderateUserText
    // hooks so templates can opt in without a hard dependency.
    try {
      MpKernelModeration.register(initializer, logger);
    } catch (e: any) {
      logger.warn("[MpKernel] moderation register failed: " +
        ((e && e.message) ? e.message : String(e)));
    }

    // Server-side interest management (spatial hashing). Used by
    // MixedRealityAnchorMatch + any TS template that needs AOI on the
    // JS side. The Go AvatarReplicationMatch keeps its own native AOI.
    try {
      MpKernelInterest.register(initializer, logger);
    } catch (e: any) {
      logger.warn("[MpKernel] interest register failed: " +
        ((e && e.message) ? e.message : String(e)));
    }

    logger.info("[MpKernel] kernel registered; templates=%d generators=echo",
      MpKernelCodeRegistry.listAll().length);
  }
}
