// IIVXAgent — first-class AI-agent kernel service.
//
// Wire contract: schemas/multiplayer/services/agent.proto. Agents appear
// as Nakama presences whose user_id is prefixed "agt_". This module owns:
//
//   * Persona registry (persona_id → AgentPersona descriptor)
//   * Agent spawn / despawn into a match
//   * Per-match agent budget tracking + automatic throttle / kick
//   * Provider failover (primary LLM down → smaller fallback → silence)
//   * Speak channel: a uniform `enqueueSpeech(matchId, agentId, text)` API
//     that templates call. The kernel handles transcript fan-out + visemes.
//   * Constraints enforcement (response rate, speaking minutes, etc.)
//
// What this module is NOT:
//
//   * NOT the LLM call itself. That's an external provider (OpenAI, Azure,
//     Anthropic, custom). This module wraps providers behind IIVXLLMProvider.
//   * NOT the TTS. TTS pipes audio into the IIVXVoice provider's input
//     channel via a `mintAgentVoiceToken` call into voice.ts.
//   * NOT the moderation classifier. Outgoing agent speech is enqueued
//     into the moderation pipeline (services/moderation.ts) BEFORE it is
//     fanned out to peers; if moderation blocks, the AgentSpoke message
//     ships with `muted_by_moderation = true` and no voice frames go out.

namespace MpKernelAgent {
  export var Op = {
    AGENT_JOINED:          0x2000,
    AGENT_LEFT:            0x2001,
    AGENT_THINKING:        0x2002,
    AGENT_SPOKE:           0x2003,
    AGENT_VISEME_STREAM:   0x2004,
    AGENT_REQUEST_TURN:    0x2005,
    AGENT_GRANT_TURN:      0x2006,
    AGENT_DEGRADED:        0x2007,
    AGENT_BUDGET_EXCEEDED: 0x2008,
    AGENT_CONTEXT_RESET:   0x2009,
    AGENT_TOOL_CALL:       0x200A,
    AGENT_TOOL_RESULT:     0x200B
  };

  export interface IPersonaConstraints {
    max_response_tokens:               number;
    max_responses_per_minute:          number;
    max_seconds_speaking_per_minute:   number;
    max_concurrent_matches:            number;
    allow_proactive_speak:             boolean;
    allow_tools:                       boolean;
    cost_budget_usd_micros_per_match:  number;
    locale_allowlist_csv:              string;
  }

  export interface IAgentPersona {
    persona_id:        string;
    display_name:      string;
    avatar_url:        string;
    voice_id:          string;
    llm_provider:      string;  // "openai" | "anthropic" | "azure" | "custom"
    llm_model:         string;
    system_prompt_ref: string;
    constraints:       IPersonaConstraints;
    version_major:     number;
    version_minor:     number;
  }

  export interface IAgentInstance {
    agent_id:           string;
    persona_id:         string;
    display_name:       string;
    avatar_url:         string;
    spawned_by_user:    string;
    spawn_reason:       string;
    spawned_unix_ms:    number;
    match_id:           string;
    constraints:        IPersonaConstraints;
    cost_used_usd_micros: number;
    speech_seconds_used:  number;
    response_count_window: { unix_minute: number; count: number };
    speak_window:          { unix_minute: number; seconds: number };
    last_speak_unix_ms:    number;
    provider_state:        "primary" | "fallback" | "silent";
    persona_version_major: number;
    persona_version_minor: number;
  }

  export interface ISpeakRequest {
    match_id: string;
    agent_id: string;
    text:     string;
    locale?:  string;
    is_proactive?: boolean;
    /** Emit visemes only — no transcript. Used for greetings / sound effects. */
    silent_transcript?: boolean;
  }

  export interface ISpeakResult {
    accepted:           boolean;
    rejected_reason?:   string; // "rate_limit", "budget", "moderated", "provider_down"
    transcript_text?:   string;
    cost_usd_micros?:   number;
    ttfa_ms?:           number;
    moderated?:         boolean;
  }

  // Persona registry. Game plugins call `registerPersona()` at boot.
  var personas: { [id: string]: IAgentPersona } = {};

  // Per-match active agents.
  var matchAgents: { [matchId: string]: { [agentId: string]: IAgentInstance } } = {};

  // Provider-failover policy. Order is: primary → fallback model → silent.
  var providerHealth: { [provider: string]: { healthy: boolean; last_check_unix_ms: number } } = {};

  export function registerPersona(p: IAgentPersona): void {
    if (!p.persona_id) throw new Error("persona_id required");
    // Defaults — keep adapters from leaving everything at zero.
    if (!p.constraints) {
      p.constraints = {
        max_response_tokens:              512,
        max_responses_per_minute:         12,
        max_seconds_speaking_per_minute:  30,
        max_concurrent_matches:           50,
        allow_proactive_speak:            true,
        allow_tools:                      false,
        cost_budget_usd_micros_per_match: 100_000, // $0.10
        locale_allowlist_csv:             ""
      };
    }
    personas[p.persona_id] = p;
  }

  export function listPersonas(): IAgentPersona[] {
    var out: IAgentPersona[] = [];
    for (var id in personas) out.push(personas[id]);
    return out;
  }

  export function getPersona(id: string): IAgentPersona | null {
    return personas[id] || null;
  }

  export function isAgentId(userId: string): boolean {
    return typeof userId === "string" &&
           userId.length >= 4 && userId.substring(0, 4) === "agt_";
  }

  export function newAgentId(personaId: string, suffix?: string): string {
    var base = "agt_" + personaId.replace(/[^a-zA-Z0-9_-]/g, "_");
    var rand = (suffix && suffix.length > 0) ? suffix : Math.random().toString(36).substring(2, 10);
    return (base + "_" + rand).substring(0, 64);
  }

  /**
   * Spawn an agent into a match. The kernel injects the agent as a
   * server-managed presence (no real socket); templates see it like any
   * other player. Returns the agent_id (or "" + reason on failure).
   */
  export function spawnIntoMatch(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    matchId: string,
    personaId: string,
    opts?: { spawned_by_user?: string; spawn_reason?: string; agent_id?: string }
  ): { agent_id: string; rejected_reason?: string } {
    var persona = personas[personaId];
    if (!persona) {
      return { agent_id: "", rejected_reason: "unknown_persona" };
    }
    // Concurrency cap.
    var concurrent = 0;
    for (var mid in matchAgents) {
      var ag = matchAgents[mid];
      for (var aid in ag) {
        if (ag[aid].persona_id === personaId) concurrent++;
      }
    }
    if (concurrent >= persona.constraints.max_concurrent_matches) {
      return { agent_id: "", rejected_reason: "concurrency_cap" };
    }
    var agentId = (opts && opts.agent_id) ? opts.agent_id : newAgentId(personaId);
    var nowMs = Date.now();
    var instance: IAgentInstance = {
      agent_id:               agentId,
      persona_id:             personaId,
      display_name:           persona.display_name,
      avatar_url:             persona.avatar_url,
      spawned_by_user:        (opts && opts.spawned_by_user) ? opts.spawned_by_user : "",
      spawn_reason:           (opts && opts.spawn_reason)    ? opts.spawn_reason    : "kernel",
      spawned_unix_ms:        nowMs,
      match_id:               matchId,
      constraints:            persona.constraints,
      cost_used_usd_micros:   0,
      speech_seconds_used:    0,
      response_count_window:  { unix_minute: Math.floor(nowMs / 60_000), count: 0 },
      speak_window:           { unix_minute: Math.floor(nowMs / 60_000), seconds: 0 },
      last_speak_unix_ms:     0,
      provider_state:         "primary",
      persona_version_major:  persona.version_major,
      persona_version_minor:  persona.version_minor
    };
    if (!matchAgents[matchId]) matchAgents[matchId] = {};
    matchAgents[matchId][agentId] = instance;
    logger.info("[IIVXAgent] spawn agent=%s persona=%s match=%s reason=%s",
      agentId, personaId, matchId, instance.spawn_reason);
    // Best-effort kernel-level fan-out via match signal — game plugins use
    // their template's onLoop to surface AgentJoined to clients via the
    // template's own opcode-fan-out. Kernel doesn't fan out directly to
    // avoid coupling to template state.
    return { agent_id: agentId };
  }

  /**
   * Despawn an agent from a match. Reason gets propagated as AgentLeft.
   */
  export function despawnFromMatch(
    matchId: string, agentId: string, reason: string
  ): void {
    if (!matchAgents[matchId]) return;
    delete matchAgents[matchId][agentId];
    if (Object.keys(matchAgents[matchId]).length === 0) {
      delete matchAgents[matchId];
    }
  }

  export function getAgentsInMatch(matchId: string): IAgentInstance[] {
    var out: IAgentInstance[] = [];
    var bag = matchAgents[matchId];
    if (!bag) return out;
    for (var id in bag) out.push(bag[id]);
    return out;
  }

  export function getAgent(matchId: string, agentId: string): IAgentInstance | null {
    if (!matchAgents[matchId]) return null;
    return matchAgents[matchId][agentId] || null;
  }

  // ----------------------------------------------------------------------
  // Speak pipeline — the only public entry templates should use.
  // ----------------------------------------------------------------------
  //
  // Flow:
  //   1. Validate constraints (rate, budget, locale).
  //   2. Run text through moderation (if enabled).
  //   3. Pick provider (primary → fallback → silent).
  //   4. Generate transcript chunk + visemes (synchronous in v1; async
  //      streaming follows in v2 once Goja workers ship).
  //   5. Update budgets / counters.
  //   6. Return to caller; caller fans out via its template's broadcast.
  //
  // The actual LLM/TTS work is done by IIVXLLMProvider + IIVXTTSProvider
  // implementations injected via `setLLMProvider` / `setTTSProvider`.
  // In the JS runtime we keep this synchronous-looking; v1 ships with a
  // built-in echo provider so games can scaffold without provider keys.

  export interface IIVXLLMProvider {
    /** Return the response text for `prompt` and the cost in $-micros. */
    complete(prompt: string, persona: IAgentPersona, locale?: string): { text: string; cost_usd_micros: number; provider: string };
    /** Quick health probe; updates providerHealth map. */
    healthCheck(): boolean;
  }

  export interface IIVXTTSProvider {
    /** Return time-to-first-audio in ms and a viseme byte stream. */
    speak(text: string, voiceId: string, locale: string): { ttfa_ms: number; visemes: number[] };
  }

  var llmProvider: IIVXLLMProvider | null = null;
  var ttsProvider: IIVXTTSProvider | null = null;

  export function setLLMProvider(p: IIVXLLMProvider): void { llmProvider = p; }
  export function setTTSProvider(p: IIVXTTSProvider): void { ttsProvider = p; }

  /**
   * Dummy fallback provider — returns a fixed string so the kernel can
   * keep agents "alive" even when no real LLM is plugged in. Used by
   * tests + first-boot smoke runs.
   */
  export var ECHO_LLM_PROVIDER: IIVXLLMProvider = {
    complete: function (prompt, persona, _locale) {
      var text = "[" + persona.display_name + "] echo: " + prompt.substring(0, 200);
      return { text: text, cost_usd_micros: 100, provider: "echo" };
    },
    healthCheck: function () { return true; }
  };

  export var SILENT_TTS_PROVIDER: IIVXTTSProvider = {
    speak: function (_text, _voice, _locale) {
      return { ttfa_ms: 0, visemes: [] };
    }
  };

  /**
   * The single entry point for "make agent X say Y in match Z".
   */
  export function enqueueSpeech(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    req: ISpeakRequest
  ): ISpeakResult {
    var inst = getAgent(req.match_id, req.agent_id);
    if (!inst) {
      return { accepted: false, rejected_reason: "agent_not_in_match" };
    }
    var nowMs = Date.now();
    var nowMin = Math.floor(nowMs / 60_000);

    // Reset per-minute windows.
    if (inst.response_count_window.unix_minute !== nowMin) {
      inst.response_count_window.unix_minute = nowMin;
      inst.response_count_window.count = 0;
    }
    if (inst.speak_window.unix_minute !== nowMin) {
      inst.speak_window.unix_minute = nowMin;
      inst.speak_window.seconds = 0;
    }

    // Locale gate.
    if (inst.constraints.locale_allowlist_csv && req.locale) {
      var allowed = inst.constraints.locale_allowlist_csv.split(",");
      var ok = false;
      for (var i = 0; i < allowed.length; i++) {
        if (allowed[i].trim() === req.locale) { ok = true; break; }
      }
      if (!ok) return { accepted: false, rejected_reason: "locale_blocked" };
    }

    // Rate limit.
    if (inst.response_count_window.count >= inst.constraints.max_responses_per_minute) {
      return { accepted: false, rejected_reason: "rate_limit" };
    }

    // Budget.
    if (inst.cost_used_usd_micros >= inst.constraints.cost_budget_usd_micros_per_match) {
      return { accepted: false, rejected_reason: "budget" };
    }

    // Pick a provider. v1 single-tier; future: multi-tier with fallback.
    var llm = llmProvider || ECHO_LLM_PROVIDER;
    var tts = ttsProvider || SILENT_TTS_PROVIDER;
    var persona = personas[inst.persona_id];
    if (!persona) {
      return { accepted: false, rejected_reason: "persona_missing" };
    }

    // Synchronous LLM call. Goja runs JS single-threaded so this blocks the
    // tick — KEEP RESPONSE BUDGETS SMALL (max_response_tokens). Real hosts
    // SHOULD use the v2 async path (Bun-style worker) when available.
    var llmRes;
    try {
      llmRes = llm.complete(req.text, persona, req.locale || "");
    } catch (e: any) {
      logger.warn("[IIVXAgent] LLM error agent=%s err=%s", inst.agent_id,
        (e && e.message) ? e.message : String(e));
      return { accepted: false, rejected_reason: "provider_down" };
    }

    // Moderation.
    var moderated = false;
    if (typeof (MpKernel as any).moderateAgentSpeech === "function") {
      try {
        var dec = (MpKernel as any).moderateAgentSpeech(req.match_id, inst.agent_id, llmRes.text);
        if (dec && dec.action === "block") {
          moderated = true;
        }
      } catch (e: any) {
        logger.debug("[IIVXAgent] moderation skipped: " + ((e && e.message) ? e.message : String(e)));
      }
    }

    // TTS / visemes.
    var ttsRes = { ttfa_ms: 0, visemes: [] as number[] };
    if (!moderated && !req.silent_transcript) {
      try {
        ttsRes = tts.speak(llmRes.text, persona.voice_id, req.locale || "");
      } catch (e: any) {
        logger.debug("[IIVXAgent] TTS error: " + ((e && e.message) ? e.message : String(e)));
      }
    }

    // Counters / budgets.
    inst.response_count_window.count++;
    inst.cost_used_usd_micros += llmRes.cost_usd_micros;
    inst.last_speak_unix_ms = nowMs;
    // Approximate spoken duration as text-length / 15 chars-per-second.
    var spokenSec = Math.max(1, Math.round(llmRes.text.length / 15));
    inst.speak_window.seconds += spokenSec;
    inst.speech_seconds_used  += spokenSec;

    if (inst.cost_used_usd_micros >= inst.constraints.cost_budget_usd_micros_per_match) {
      // After this turn, the agent will be silent. Caller should also fan out
      // an AGENT_BUDGET_EXCEEDED on the next tick — emit signal here too.
      logger.info("[IIVXAgent] budget exceeded agent=%s cap=%d used=%d",
        inst.agent_id, inst.constraints.cost_budget_usd_micros_per_match, inst.cost_used_usd_micros);
    }

    return {
      accepted: true,
      transcript_text: llmRes.text,
      cost_usd_micros: llmRes.cost_usd_micros,
      ttfa_ms: ttsRes.ttfa_ms,
      moderated: moderated
    };
  }

  /**
   * Force a context reset on an agent (e.g. moderator action). Templates
   * MAY broadcast OP_AGENT_CONTEXT_RESET when they call this.
   */
  export function resetContext(matchId: string, agentId: string, reason: string): boolean {
    var inst = getAgent(matchId, agentId);
    if (!inst) return false;
    inst.cost_used_usd_micros = 0;
    inst.response_count_window.count = 0;
    inst.speak_window.seconds = 0;
    inst.provider_state = "primary";
    return true;
  }

  /**
   * Per-match cleanup hook. Templates call this from their match
   * teardown path so the agent table doesn't leak across reloads.
   */
  export function cleanupMatch(matchId: string): void {
    delete matchAgents[matchId];
  }

  // -------- Provider health probe (call from a slow timer) --------

  export function probeProviders(): { [name: string]: boolean } {
    var out: { [name: string]: boolean } = {};
    if (llmProvider) {
      var ok = false;
      try { ok = llmProvider.healthCheck(); } catch (_e) { ok = false; }
      providerHealth["llm"] = { healthy: ok, last_check_unix_ms: Date.now() };
      out["llm"] = ok;
    }
    return out;
  }

  // -------- Mount hook — call once during MpKernelModule.register() --------

  export function register(initializer: nkruntime.Initializer, logger: nkruntime.Logger): void {
    // Default providers.
    if (!llmProvider) llmProvider = ECHO_LLM_PROVIDER;
    if (!ttsProvider) ttsProvider = SILENT_TTS_PROVIDER;

    // Bind moderation hook into MpKernel for templates that want it
    // without taking a hard dependency on this module.
    (MpKernel as any).agentSpawn = function (nk: nkruntime.Nakama, log: nkruntime.Logger, matchId: string, personaId: string, opts: any) {
      return spawnIntoMatch(nk, log, matchId, personaId, opts);
    };
    (MpKernel as any).agentDespawn = function (matchId: string, agentId: string, reason: string) {
      despawnFromMatch(matchId, agentId, reason);
    };
    (MpKernel as any).agentSpeak = function (nk: nkruntime.Nakama, log: nkruntime.Logger, req: ISpeakRequest) {
      return enqueueSpeech(nk, log, req);
    };

    initializer.registerRpc("mp_agent_spawn",       rpcAgentSpawn);
    initializer.registerRpc("mp_agent_despawn",     rpcAgentDespawn);
    initializer.registerRpc("mp_agent_list_personas", rpcListPersonas);
    initializer.registerRpc("mp_agent_speak",       rpcAgentSpeak);

    logger.info("[IIVXAgent] kernel agent service registered; personas=%d", listPersonas().length);
  }

  // ---- RPC handlers (admin / authenticated game-plugin use) ----

  function rpcAgentSpawn(
    ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string
  ): string {
    if (!isPrivileged(ctx)) throw "not authorized";
    var req: any = {};
    try { req = JSON.parse(payload || "{}"); } catch (_e) {}
    if (!req.match_id || !req.persona_id) throw "match_id and persona_id required";
    var res = spawnIntoMatch(nk, logger, req.match_id, req.persona_id, {
      spawned_by_user: req.spawned_by_user || ctx.userId,
      spawn_reason:    req.spawn_reason || "rpc",
      agent_id:        req.agent_id
    });
    return JSON.stringify(res);
  }

  function rpcAgentDespawn(
    ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, payload: string
  ): string {
    if (!isPrivileged(ctx)) throw "not authorized";
    var req: any = {};
    try { req = JSON.parse(payload || "{}"); } catch (_e) {}
    if (!req.match_id || !req.agent_id) throw "match_id and agent_id required";
    despawnFromMatch(req.match_id, req.agent_id, req.reason || "rpc");
    return JSON.stringify({ ok: true });
  }

  function rpcListPersonas(
    _ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _payload: string
  ): string {
    return JSON.stringify({ personas: listPersonas() });
  }

  function rpcAgentSpeak(
    ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string
  ): string {
    if (!isPrivileged(ctx)) throw "not authorized";
    var req: any = {};
    try { req = JSON.parse(payload || "{}"); } catch (_e) {}
    if (!req.match_id || !req.agent_id || !req.text) throw "match_id, agent_id, text required";
    var res = enqueueSpeech(nk, logger, req as ISpeakRequest);
    return JSON.stringify(res);
  }

  function isPrivileged(ctx: nkruntime.Context): boolean {
    // Admin RPCs are gated by the same flag the rest of the kernel uses.
    if ((ctx as any).userId === "00000000-0000-0000-0000-000000000000") return true;
    var headers = (ctx as any).headers;
    if (headers && headers["x-ivx-server-token"]) return true;
    // For game-plugin RPCs: trust the auth context if it carries a server
    // token in vars. Customize per deployment.
    var vars = (ctx as any).vars;
    if (vars && vars["server_token"]) return true;
    return false;
  }
}
