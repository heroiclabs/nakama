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
    // Source of truth is `registeredTemplateIds`, populated by the
    // single-arg, auto-invoked register(initializer) so it is present on
    // EVERY pooled Goja VM (the code registry's opcode ranges are only
    // reserved on the InitModule VM via mount(), so we can't rely on
    // listAll() here without returning an empty set on pooled VMs).
    var ranges: { [id: string]: { from: number; to: number } } = {};
    try {
      var owners = MpKernelCodeRegistry.listAll();
      for (var i = 0; i < owners.length; i++) {
        if (owners[i].template_id) {
          ranges[owners[i].template_id as string] = { from: owners[i].from, to: owners[i].to };
        }
      }
    } catch (_e) { /* registry not bootstrapped on this VM — ranges optional */ }

    var out = {
      templates: [] as Array<{ id: string; from: number; to: number }>
    };
    for (var id in registeredTemplateIds) {
      if (!registeredTemplateIds.hasOwnProperty(id)) continue;
      if (registeredTemplateIds[id] !== true) continue;
      var r = ranges[id] || { from: 0, to: 0 };
      out.templates.push({ id: id, from: r.from, to: r.to });
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

  // All in-tree JS templates, keyed by their stable templateId. The order
  // here is the registration order. Native Go templates (realtime-tick,
  // avatar-replication) are id-only — their match handler is mounted by the
  // Go plugin's own InitModule.
  var JS_TEMPLATE_IDS = [
    TEMPLATE_IDS.SYNC_TURN_V1,
    TEMPLATE_IDS.ASYNC_TURN_V1,
    TEMPLATE_IDS.LOBBY_HANDOFF_V1,
    TEMPLATE_IDS.TOURNAMENT_V1,
    TEMPLATE_IDS.LIVE_EVENT_V1,
    TEMPLATE_IDS.PERSISTENT_PARTY_V1,
    TEMPLATE_IDS.CONVERSATIONAL_PARTY_V1,
    TEMPLATE_IDS.MR_ANCHOR_V1
  ];

  // Resolve a template object by id. Only called from mount() (InitModule
  // VM, after every namespace IIFE has evaluated) so the references are safe.
  function templateById(id: string): any {
    return MpKernelMatch.getTemplate(id);
  }

  // Register the built-in echo generators used by the SDK conformance suite
  // and any game that doesn't ship its own generator. Pure (no initializer /
  // nk / logger) and idempotent, so it is safe to call lazily on EVERY pooled
  // Goja VM at match-init time (see data/modules/zz_mp_kernel_handlers.js).
  // It must NOT run at namespace-IIFE-eval time: MpKernelSyncTurn /
  // MpKernelAsyncTurn evaluate AFTER MpKernelModule in the bundle, so an
  // eager call would hit an undefined namespace.
  export function registerBuiltinGenerators(): void {
    try { MpKernelSyncTurn.registerGenerator(ECHO_GENERATOR); } catch (_e) {}
    try { MpKernelAsyncTurn.registerGenerator(ASYNC_ECHO_GENERATOR); } catch (_e) {}
  }

  // VM-pool-safe registration. This is a SINGLE-parameter `register(initializer)`
  // on purpose: postbuild.js's autoInvokeRegister re-invokes zero/one-arg
  // register() functions at IIFE scope on EVERY Goja VM (not just the initial
  // VM that runs InitModule), which is the only way the `__rpc_*` stubs get
  // populated on the pooled VMs that actually serve RPC traffic. The previous
  // two-arg `register(initializer, logger)` was skipped by autoInvokeRegister,
  // so mp_create_match / mp_list_templates / mp_read_match_result resolved to
  // `undefined` on pooled VMs → HTTP 500 "Could not run Rpc function".
  //
  // CRITICAL: this body must only touch MpKernelModule-internal symbols and
  // must NOT call any `initializer.<x>()` other than registerRpc — both are
  // requirements for autoInvokeRegister to treat it as safe, and the function
  // runs at MpKernelModule's IIFE-end (before the template namespaces have
  // evaluated). Template-object wiring + opcode-range reservation that needs
  // those later namespaces lives in mount(), called from InitModule.
  export function register(initializer: nkruntime.Initializer): void {
    // Whitelist every template id so `mp_create_match` (isKnownTemplate) and
    // `mp_list_templates` work on every VM. Pure literal-id calls only.
    for (var i = 0; i < JS_TEMPLATE_IDS.length; i++) {
      registerTemplateId(JS_TEMPLATE_IDS[i]);
    }
    registerTemplateId(TEMPLATE_IDS.REALTIME_TICK_V1);
    registerTemplateId(TEMPLATE_IDS.AVATAR_REPLICATION_V1);

    initializer.registerRpc("mp_create_match",      rpcCreateMatch);
    initializer.registerRpc("mp_read_match_result", rpcReadMatchResult);
    initializer.registerRpc("mp_list_templates",    rpcListTemplates);
  }

  // Full boot path — invoked once from src/main.ts InitModule, AFTER every
  // namespace IIFE has evaluated (so template objects are resolvable). Does
  // the opcode-range reservation + the runtime services (voice / agents /
  // moderation / interest). Match handlers themselves are mounted by
  // postbuild.js section 5b (direct registerMatch in the InitModule wrapper);
  // generators are registered lazily at match-init time. This is also where
  // we (re-)run register() so the RPCs are registered on the initial VM.
  export function mount(initializer: nkruntime.Initializer, logger: nkruntime.Logger): void {
    register(initializer);

    try {
      MpKernelCodeRegistry.bootstrapKernelRanges();
    } catch (err: any) {
      logger.error("[MpKernel] bootstrapKernelRanges failed: " +
        (err && err.message ? err.message : String(err)) +
        " — kernel boot continues; opcode-range overlap detection disabled");
    }

    // Reserve each JS template's opcode range in the code registry. Wrapped
    // per-template so a single missing namespace can't abort the rest.
    for (var i = 0; i < JS_TEMPLATE_IDS.length; i++) {
      var id = JS_TEMPLATE_IDS[i];
      try {
        var tmpl = templateById(id);
        if (!tmpl || !tmpl.opRange || typeof tmpl.opRange.from !== "number" || typeof tmpl.opRange.to !== "number") {
          logger.error("[MpKernel] template '" + id + "' missing/invalid at mount — opcode range not reserved (handler still mounts via postbuild)");
          continue;
        }
        MpKernelMatch.registerTemplate(tmpl);
      } catch (err: any) {
        logger.error("[MpKernel] template '" + id + "' range reserve failed: " +
          (err && err.message ? err.message : String(err)) + " — continuing");
      }
    }

    // Native Go templates: id already whitelisted in register(); reserve their
    // opcode ranges here so JS templates can't collide with their wires.
    try {
      MpKernelCodeRegistry.reserve({
        name: TEMPLATE_IDS.REALTIME_TICK_V1, from: 0x6000, to: 0x6FFF,
        template_id: TEMPLATE_IDS.REALTIME_TICK_V1
      });
    } catch (e) {
      logger.debug("[MpKernel] realtime-tick range already reserved: " +
        ((e && (e as any).message) ? (e as any).message : String(e)));
    }
    try {
      MpKernelCodeRegistry.reserve({
        name: TEMPLATE_IDS.AVATAR_REPLICATION_V1, from: 0xF000, to: 0xFFFF,
        template_id: TEMPLATE_IDS.AVATAR_REPLICATION_V1
      });
    } catch (e) {
      logger.debug("[MpKernel] avatar-replication range already reserved: " +
        ((e && (e as any).message) ? (e as any).message : String(e)));
    }

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
