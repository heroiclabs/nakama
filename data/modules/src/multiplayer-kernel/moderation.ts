// IIVXModeration — real-time moderation pipeline.
//
// Wire contract: schemas/multiplayer/services/moderation.proto.
// Applies uniformly to:
//
//   * Human voice (ASR transcript → classifier → action)
//   * Text chat (classifier → action)
//   * Agent TTS pre-check (classifier → action; fail → "agent_correct")
//   * Usernames + avatar metadata (snapshot at join)
//
// Architecture:
//
//   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
//   │ ASR client  │ -> │ classifier  │ -> │  action     │
//   │ (LiveKit    │    │ (text /     │    │ (allow /    │
//   │  audio sink)│    │  category)  │    │  redact /   │
//   └─────────────┘    └─────────────┘    │  mute / kick│
//                                         └─────────────┘
//
// All decisions are logged append-only into `safety_decision_log`
// storage collection + emitted as Satori events for the SLO board.
//
// What this module is NOT:
//
//   * NOT the ASR transcoder (LiveKit voice provider hands us text).
//   * NOT the policy authority — game plugins customize via the
//     `setClassifier` / `setActionPolicy` injection points.
//   * NOT a synchronous gate on every voice frame. Decisions are
//     batched per `voice_window_ms` (default 2000 ms).

namespace MpKernelModeration {
  export var Op = {
    MOD_DECISION:        0x3000,
    MOD_WARN:            0x3001,
    MOD_MUTE:            0x3002,
    MOD_KICK:            0x3003,
    MOD_APPEAL_OPENED:   0x3004,
    MOD_APPEAL_RESOLVED: 0x3005
  };

  export var Surface = {
    UNSPECIFIED: 0,
    VOICE:       1,
    TEXT_CHAT:   2,
    AGENT_TTS:   3,
    USERNAME:    4,
    AVATAR:      5
  };

  export var Action = {
    UNSPECIFIED:    0,
    ALLOW:          1,
    WARN:           2,
    REDACT:         3,
    MUTE:           4,
    KICK:           5,
    BAN:            6,
    AGENT_CORRECT:  7
  };

  export var Severity = {
    UNSPECIFIED: 0,
    LOW:         1,
    MEDIUM:      2,
    HIGH:        3,
    CRITICAL:    4
  };

  export interface IModerationParams {
    enable_voice_asr:        boolean;
    enable_text:             boolean;
    enable_agent_pre_check:  boolean;
    voice_window_ms:         number;
    max_warnings_before_mute: number;
    classifier_model:        string;
    asr_model:               string;
    strict_mode:             boolean;
    locale_allowlist_csv:    string;
  }

  export var DEFAULTS: IModerationParams = {
    enable_voice_asr:         false, // ASR is opt-in (privacy + cost)
    enable_text:              true,
    enable_agent_pre_check:   true,
    voice_window_ms:          2_000,
    max_warnings_before_mute: 3,
    classifier_model:         "ivx-builtin-allowlist-v1",
    asr_model:                "openai-whisper-1",
    strict_mode:              false,
    locale_allowlist_csv:     ""
  };

  var params: IModerationParams = DEFAULTS;

  export function configure(p: Partial<IModerationParams>): void {
    params = (Object as any).assign({}, DEFAULTS, params, p);
  }

  export function getParams(): IModerationParams { return params; }

  export interface IClassifierResult {
    severity: number;     // Severity enum
    categories: string[]; // "hate" | "self-harm" | "spam" | "harassment" | ...
    detail: string;
    redacted_text?: string;
  }

  export interface IClassifier {
    /** Classify a single chunk. Synchronous, KEEP IT FAST (≤5 ms). */
    classify(text: string, surface: number, locale: string): IClassifierResult;
    /** Optional descriptive name surfaced into SafetyDecision. */
    modelName(): string;
  }

  export interface IActionPolicy {
    /**
     * Map a classifier verdict → action. Per-deployment override; e.g.
     * stricter for kids titles, lighter for esports spectator chat.
     */
    decide(verdict: IClassifierResult, surface: number, prevWarnings: number): { action: number; detail: string; appealable: boolean };
  }

  // -------- Built-in providers (so game plugins can run with no setup) --------

  // The default classifier is intentionally simple: a denylist of
  // obvious slurs / spam markers + URL-flooding heuristic. Real
  // deployments inject Perspective / Azure Content Safety / Llama Guard.
  export var BUILTIN_CLASSIFIER: IClassifier = (function () {
    var DENY = [
      // Profanity / slurs are intentionally NOT enumerated here — operators
      // load a deployment-specific list. We ship spam / scam markers only.
      "free v-bucks", "click here to claim", "telegram://", "discord.gg/",
      "scam", "phishing", "earn $$", "0% apr", "hack tool"
    ];
    function lc(s: string): string { return (s || "").toLowerCase(); }
    function looksUrlSpam(s: string): boolean {
      var m = (s || "").match(/https?:\/\//g);
      return m !== null && m.length >= 3;
    }
    return {
      classify: function (text, surface, _locale): IClassifierResult {
        var t = lc(text);
        var categories: string[] = [];
        for (var i = 0; i < DENY.length; i++) {
          if (t.indexOf(DENY[i]) >= 0) {
            categories.push("spam"); break;
          }
        }
        if (looksUrlSpam(t)) categories.push("spam");
        var sev = categories.length === 0 ? Severity.UNSPECIFIED : Severity.MEDIUM;
        return {
          severity: sev,
          categories: categories,
          detail: categories.length ? "matched_denylist" : "",
          redacted_text: categories.length ? "[redacted]" : undefined
        };
      },
      modelName: function () { return "ivx-builtin-allowlist-v1"; }
    };
  })();

  export var BUILTIN_POLICY: IActionPolicy = {
    decide: function (verdict, _surface, prevWarnings) {
      if (!verdict.categories || verdict.categories.length === 0) {
        return { action: Action.ALLOW, detail: "", appealable: false };
      }
      if (verdict.severity >= Severity.CRITICAL) {
        return { action: Action.KICK, detail: "critical_content", appealable: true };
      }
      if (verdict.severity >= Severity.HIGH) {
        return { action: Action.MUTE, detail: "high_severity_mute", appealable: true };
      }
      if (verdict.severity >= Severity.MEDIUM) {
        if (prevWarnings >= params.max_warnings_before_mute - 1) {
          return { action: Action.MUTE, detail: "warn_then_mute", appealable: true };
        }
        return { action: Action.REDACT, detail: "redacted", appealable: true };
      }
      return { action: Action.WARN, detail: "warning", appealable: false };
    }
  };

  var classifier: IClassifier = BUILTIN_CLASSIFIER;
  var policy: IActionPolicy = BUILTIN_POLICY;

  export function setClassifier(c: IClassifier): void { classifier = c; }
  export function setActionPolicy(p: IActionPolicy): void { policy = p; }

  // Per-user warning counters (per match). Reset on match teardown.
  var warnings: { [key: string]: number } = {};
  function warnKey(matchId: string, userId: string): string {
    return matchId + "/" + userId;
  }

  // ---------------- Public moderation entry points ----------------

  export interface IModRequest {
    match_id:  string;
    user_id:   string;
    is_agent:  boolean;
    surface:   number; // Surface enum
    text:      string;
    locale?:   string;
    region?:   string;
  }

  export interface IModResult {
    action:        number;       // Action enum
    detail:        string;
    severity:      number;       // Severity enum
    categories:    string[];
    redacted_text: string;       // text safe to fan out (may equal input)
    decision_id:   string;
    appealable:    boolean;
    classifier_model: string;
  }

  /**
   * Synchronous moderation entry point. Returns the action + safe text.
   * Templates fan-out the safe text instead of the raw text when
   * action==REDACT|WARN; for MUTE|KICK they call the corresponding
   * presence kick/mute helpers.
   */
  export function moderate(nk: nkruntime.Nakama, logger: nkruntime.Logger, req: IModRequest): IModResult {
    var nowMs = Date.now();
    var verdict = classifier.classify(req.text, req.surface, req.locale || "");
    var key = warnKey(req.match_id, req.user_id);
    var prev = warnings[key] || 0;
    var dec = policy.decide(verdict, req.surface, prev);

    if (dec.action === Action.WARN) warnings[key] = prev + 1;

    var decisionId = "dec_" + nowMs.toString(36) + "_" +
                     Math.random().toString(36).substring(2, 10);

    // Append-only audit log. Best-effort — we never let logging failure
    // block the moderation decision.
    try {
      var decision = {
        decision_id:   decisionId,
        match_id:      req.match_id,
        user_id:       req.user_id,
        is_agent:      req.is_agent,
        surface:       req.surface,
        severity:      verdict.severity,
        action:        dec.action,
        detail:        dec.detail,
        categories:    verdict.categories,
        transcript:    verdict.redacted_text || req.text,
        ts_ms:         nowMs,
        classifier_model: classifier.modelName(),
        asr_model:     params.asr_model,
        locale:        req.locale || "",
        region:        req.region || "",
        appealable:    dec.appealable
      };
      nk.storageWrite([{
        collection:      "safety_decision_log",
        key:             decisionId,
        userId:          "00000000-0000-0000-0000-000000000000",
        value:           decision,
        permissionRead:  0,
        permissionWrite: 0
      }]);
    } catch (e: any) {
      logger.debug("[Moderation] storageWrite failed: " +
        ((e && e.message) ? e.message : String(e)));
    }

    // Best-effort metric.
    try {
      var labels = {
        surface:  String(req.surface),
        action:   String(dec.action),
        severity: String(verdict.severity),
        is_agent: req.is_agent ? "1" : "0"
      };
      if ((nk as any).metricsCounterAdd) {
        (nk as any).metricsCounterAdd("ivx_mp_moderation_decisions_total", labels, 1);
      }
    } catch (_e) { /* metrics optional */ }

    return {
      action:        dec.action,
      detail:        dec.detail,
      severity:      verdict.severity,
      categories:    verdict.categories,
      redacted_text: verdict.redacted_text || req.text,
      decision_id:   decisionId,
      appealable:    dec.appealable,
      classifier_model: classifier.modelName()
    };
  }

  /**
   * Convenience: classify + map only. Used by the agent service so it
   * can short-circuit "block" without writing a log entry (the wrapper
   * call in `agents.ts` will rewrite the moderation log with a richer
   * surface=AGENT_TTS payload anyway).
   */
  export function quickCheck(text: string, surface: number, locale?: string): { action: number; detail: string; categories: string[] } {
    var v = classifier.classify(text, surface, locale || "");
    var d = policy.decide(v, surface, 0);
    return { action: d.action, detail: d.detail, categories: v.categories };
  }

  /**
   * Per-match cleanup hook.
   */
  export function cleanupMatch(matchId: string): void {
    var prefix = matchId + "/";
    for (var k in warnings) {
      if (k.indexOf(prefix) === 0) delete warnings[k];
    }
  }

  // ---------------- Mount hook ----------------

  export function register(initializer: nkruntime.Initializer, logger: nkruntime.Logger): void {
    // Bind kernel-level hooks; templates use these without taking a
    // hard import on this module so it can be swapped at deploy time.
    (MpKernel as any).moderateText = function (nk: nkruntime.Nakama, log: nkruntime.Logger, matchId: string, userId: string, text: string, locale?: string) {
      return moderate(nk, log, {
        match_id: matchId, user_id: userId, is_agent: false,
        surface: Surface.TEXT_CHAT, text: text, locale: locale
      });
    };
    (MpKernel as any).moderateAgentSpeech = function (matchId: string, agentId: string, text: string) {
      var qc = quickCheck(text, Surface.AGENT_TTS);
      return {
        action: qc.action,
        detail: qc.detail,
        categories: qc.categories,
        block: qc.action === Action.REDACT || qc.action === Action.MUTE ||
               qc.action === Action.KICK   || qc.action === Action.AGENT_CORRECT
      };
    };
    (MpKernel as any).moderateVoiceTranscript = function (nk: nkruntime.Nakama, log: nkruntime.Logger, matchId: string, userId: string, transcript: string, locale?: string) {
      if (!params.enable_voice_asr) {
        return { action: Action.ALLOW, severity: Severity.UNSPECIFIED, categories: [], redacted_text: transcript } as IModResult;
      }
      return moderate(nk, log, {
        match_id: matchId, user_id: userId, is_agent: false,
        surface: Surface.VOICE, text: transcript, locale: locale
      });
    };

    initializer.registerRpc("mp_mod_get_params", rpcGetParams);
    initializer.registerRpc("mp_mod_set_params", rpcSetParams);
    initializer.registerRpc("mp_mod_appeal",     rpcOpenAppeal);

    logger.info("[Moderation] pipeline registered (text=%s voice_asr=%s agent_pre=%s)",
      String(params.enable_text), String(params.enable_voice_asr),
      String(params.enable_agent_pre_check));
  }

  function rpcGetParams(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _payload: string): string {
    return JSON.stringify({ params: params });
  }

  function rpcSetParams(ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string): string {
    if (!isAdmin(ctx)) throw "not authorized";
    var req: any = {};
    try { req = JSON.parse(payload || "{}"); } catch (_e) {}
    configure(req || {});
    logger.info("[Moderation] params updated by " + (ctx.userId || "?"));
    return JSON.stringify({ ok: true, params: params });
  }

  function rpcOpenAppeal(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var req: any = {};
    try { req = JSON.parse(payload || "{}"); } catch (_e) {}
    if (!req.decision_id) throw "decision_id required";
    var appealId = "app_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 10);
    try {
      nk.storageWrite([{
        collection:      "safety_appeals",
        key:             appealId,
        userId:          "00000000-0000-0000-0000-000000000000",
        value:           {
          appeal_id:   appealId,
          decision_id: req.decision_id,
          user_id:     ctx.userId,
          text:        req.text || "",
          ts_ms:       Date.now()
        },
        permissionRead:  1,
        permissionWrite: 1
      }]);
    } catch (e: any) {
      throw "appeal_write_failed: " + ((e && e.message) ? e.message : String(e));
    }
    return JSON.stringify({ appeal_id: appealId });
  }

  function isAdmin(ctx: nkruntime.Context): boolean {
    if ((ctx as any).userId === "00000000-0000-0000-0000-000000000000") return true;
    var headers = (ctx as any).headers;
    if (headers && headers["x-ivx-server-token"]) return true;
    return false;
  }
}
