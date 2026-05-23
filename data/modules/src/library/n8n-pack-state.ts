/**
 * n8n-pack-state.ts — pack_complete gate for the v2.4.0 library format-agents.
 *
 * Spec lives in Quizverse-web-frontend `QUIZVERSE_LIBRARY_10X_PLAN.md` §19.6 and
 * the companion `intelli-verse-kube-infra` repo PR (n8n workflows #20-25).
 *
 * Purpose
 * -------
 * Six n8n agents (#20 audio synth, #21 video shorts, #22 live scheduler,
 * #23 sim ingest, #24 widget refresh, #25 pack bundler) produce content
 * for a single exam in parallel. Agent #25 (the bundler) is the GATE —
 * it should only compose the 3 one-time IAP SKUs once #20 + #21 + #23
 * have all completed successfully for that exam.
 *
 * This module tracks per-exam agent completion state and emits an HTTP
 * webhook to agent #25's trigger URL when the gate condition flips true.
 *
 * RPCs registered
 * ---------------
 *   n8n_pack_state_emit       — called by agents #20-24 with { examTag, agent, status }
 *   n8n_pack_state_query      — returns full state for an examTag
 *   n8n_pack_state_list_ready — admin/system — lists exams ready for bundling
 *   n8n_pack_state_reset      — admin — resets state for an examTag
 *                               (used to re-trigger bundling after content edits)
 *
 * Storage
 * -------
 * Collection "n8n_pack_state", key = examTag. System-write, owner=system,
 * readPermission=2 so n8n service-account can poll.
 *
 * Gate transition behaviour
 * -------------------------
 * On every emit, if status === "success" we mark the agent as green.
 * When the green set ⊇ { audio_synth, video_shorts, sim_ingest } and the
 * exam has not previously been bundled, we:
 *   1. Set bundleSignaledAt to now (locks against double-fire)
 *   2. POST to {{N8N_PACK_BUNDLER_WEBHOOK}} with { examTag, audioPackId,
 *      videoShortsPackId, interactiveSimPackId, liveSessionPackId? }
 *
 * Re-bundling is opt-in via `n8n_pack_state_reset`.
 *
 * Wiring
 * ------
 * Uses the same single-arg `register(initializer)` signature as
 * BracketTournaments so the postbuild auto-invokes the module at IIFE
 * scope and populates the __rpc_* globals in pooled Goja VMs.
 */

namespace N8nPackStatePlugin {
  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  var COLLECTION = "n8n_pack_state";
  var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

  /** Agent ids — must match the meta.category numbers in the n8n workflow JSONs. */
  type AgentId =
    | "audio_synth"        // #20
    | "video_shorts"       // #21
    | "live_scheduler"     // #22 (not gating)
    | "sim_ingest"         // #23
    | "widget_refresh"     // #24 (not gating)
    | "pack_bundler";      // #25 (consumer)

  /** Agents that MUST be green before the bundler fires. */
  var GATING_AGENTS: AgentId[] = ["audio_synth", "video_shorts", "sim_ingest"];

  /** Mapping from the human-readable agent string clients send to AgentId. */
  function normalizeAgent(s: string): AgentId | null {
    if (!s) return null;
    var t = ("" + s).toLowerCase();
    if (t.indexOf("20") === 0 || t.indexOf("audio") >= 0) return "audio_synth";
    if (t.indexOf("21") === 0 || t.indexOf("video") >= 0 || t.indexOf("short") >= 0) return "video_shorts";
    if (t.indexOf("22") === 0 || t.indexOf("live") >= 0) return "live_scheduler";
    if (t.indexOf("23") === 0 || t.indexOf("sim") >= 0) return "sim_ingest";
    if (t.indexOf("24") === 0 || t.indexOf("widget") >= 0) return "widget_refresh";
    if (t.indexOf("25") === 0 || t.indexOf("bundler") >= 0) return "pack_bundler";
    return null;
  }

  // examTag is used as a Sanity slug & storage key — restrict to safe chars.
  var EXAM_TAG_RE = /^[A-Za-z0-9_\-]{1,64}$/;

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  interface AgentEntry {
    status: "pending" | "success" | "failed";
    completedAt?: number;     // unix seconds
    cost?: number;
    error?: string;
    artifactId?: string;      // e.g. audioPackId / videoShortsPackId / interactiveSimPackId
  }

  interface PackState {
    examTag: string;
    createdAt: number;
    updatedAt: number;
    agents: { [id: string]: AgentEntry };
    bundleSignaledAt?: number;   // when we fired the webhook
    bundleCompletedAt?: number;  // when bundler reported back
    bundleSkus?: { single: string; triple: string; year: string };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function nakamaError(msg: string, code: number): nkruntime.Error {
    return { message: msg, code: code } as nkruntime.Error;
  }

  function readState(nk: nkruntime.Nakama, examTag: string): { state: PackState | null; version: string } {
    var read = nk.storageRead([{ collection: COLLECTION, key: examTag, userId: SYSTEM_USER_ID }]);
    if (!read || read.length === 0) return { state: null, version: "" };
    var v = read[0].value as unknown as PackState | undefined;
    return { state: v || null, version: read[0].version || "" };
  }

  // Returns the new storage version produced by Nakama on a successful write so
  // callers can chain CAS-protected updates. Throws if the optimistic-lock
  // check fails (concurrent writer beat us to it) — callers MUST handle that
  // for race-sensitive flows like the bundler-webhook signal slot.
  function writeState(nk: nkruntime.Nakama, state: PackState, prevVersion: string): string {
    var acks = nk.storageWrite([{
      collection: COLLECTION,
      key:        state.examTag,
      userId:     SYSTEM_USER_ID,
      value:      state as unknown as { [key: string]: any },
      version:    prevVersion || undefined,
      permissionRead:  2,
      permissionWrite: 0,
    } as nkruntime.StorageWriteRequest]);
    return acks && acks.length > 0 && acks[0].version ? acks[0].version : "";
  }

  function isAdmin(ctx: nkruntime.Context): boolean {
    // Admin-only RPCs are invoked from server jobs / ops tools via http_key.
    var u = ctx.userId || "";
    return u === "" || u === SYSTEM_USER_ID;
  }

  function isGatingReady(state: PackState): boolean {
    for (var i = 0; i < GATING_AGENTS.length; i++) {
      var entry = state.agents[GATING_AGENTS[i]];
      if (!entry || entry.status !== "success") return false;
    }
    return true;
  }

  function fireBundlerWebhook(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    state: PackState,
  ): boolean {
    // Webhook URL is exposed to JS via the per-call `ctx.env` table —
    // populated from Nakama config (runtime.env in local.yml or the
    // NAKAMA_RUNTIME_ENV_* env vars in the k8s deployment).
    //
    // `nk.getRuntimeEnvironment()` does NOT exist on nkruntime.Nakama; the
    // earlier draft of this file used it and silently always took the
    // "no webhook" branch (the bundler had to poll list_ready). Switching
    // to `ctx.env` matches the documented Goja runtime API.
    var url = (ctx.env && ctx.env["N8N_PACK_BUNDLER_WEBHOOK"]) || "";
    if (!url) {
      logger.warn("[n8n_pack_state] no N8N_PACK_BUNDLER_WEBHOOK configured; bundler must poll list_ready");
      return false;
    }
    var payload = {
      examTag:                state.examTag,
      audioPackId:            (state.agents["audio_synth"] || {}).artifactId || null,
      videoShortsPackId:      (state.agents["video_shorts"] || {}).artifactId || null,
      interactiveSimPackId:   (state.agents["sim_ingest"] || {}).artifactId || null,
      liveSessionPackId:      (state.agents["live_scheduler"] || {}).artifactId || null,
      widgetPackId:           (state.agents["widget_refresh"] || {}).artifactId || null,
      signaledAt:             state.bundleSignaledAt,
    };
    try {
      nk.httpRequest(url, "post", { "content-type": "application/json" }, JSON.stringify(payload), 8000);
      logger.info("[n8n_pack_state] bundler webhook fired for examTag=" + state.examTag);
      return true;
    } catch (e: any) {
      logger.error("[n8n_pack_state] bundler webhook failed: " + (e && e.message ? e.message : String(e)));
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // RPC: emit — called by agents #20-25 after each run
  // ---------------------------------------------------------------------------

  var rpcEmit: nkruntime.RpcFunction = function (ctx, logger, nk, payload) {
    var body: any = {};
    try { body = payload ? JSON.parse(payload) : {}; } catch (_) {
      throw nakamaError("payload must be JSON", nkruntime.Codes.INVALID_ARGUMENT);
    }
    var examTag = ("" + (body.examTag || "")).trim();
    if (!examTag) throw nakamaError("examTag is required", nkruntime.Codes.INVALID_ARGUMENT);
    if (!EXAM_TAG_RE.test(examTag)) {
      throw nakamaError("examTag must match /^[A-Za-z0-9_\\-]{1,64}$/", nkruntime.Codes.INVALID_ARGUMENT);
    }
    var agentId = normalizeAgent("" + (body.agent || ""));
    if (!agentId) throw nakamaError("agent is required (one of 20-audio-synth, 21-video-shorts, 22-live-scheduler, 23-sim-ingest, 24-widget-refresh, 25-pack-bundler)", nkruntime.Codes.INVALID_ARGUMENT);
    var status = "" + (body.status || "pending");
    if (status !== "pending" && status !== "success" && status !== "failed") {
      throw nakamaError("status must be one of pending|success|failed", nkruntime.Codes.INVALID_ARGUMENT);
    }
    var now = Math.floor(Date.now() / 1000);
    var existing = readState(nk, examTag);
    var state: PackState = existing.state || { examTag: examTag, createdAt: now, updatedAt: now, agents: {} };
    var entry: AgentEntry = {
      status: status as AgentEntry["status"],
      completedAt: status === "success" || status === "failed" ? now : undefined,
      cost:        typeof body.cost === "number" ? body.cost : undefined,
      error:       body.error ? ("" + body.error).slice(0, 500) : undefined,
      artifactId:  body.artifactId ? ("" + body.artifactId) : undefined,
    };
    state.agents[agentId] = entry;
    state.updatedAt = now;

    // Special handling for the bundler itself reporting completion.
    if (agentId === "pack_bundler" && status === "success") {
      state.bundleCompletedAt = now;
      if (body.bundleSkus && typeof body.bundleSkus === "object") {
        state.bundleSkus = body.bundleSkus;
      }
    }

    var version = writeState(nk, state, existing.version);

    // Gate check: fire bundler webhook once if all gating agents are green
    // and we haven't signaled yet (or we have but a reset cleared it).
    //
    // CAS lock: we set bundleSignaledAt and write back using the version we
    // just got from the storageWrite ack. If another concurrent emit beat us
    // to the slot (its successful write bumped the version), this CAS write
    // throws and we treat the signal as "already claimed" — `fired` stays
    // false but the slot is owned by the winning emit. This is the only
    // mechanism preventing a double-webhook race when the final two gating
    // agents emit success simultaneously.
    var fired = false;
    var signalClaimed = false;
    if (!state.bundleSignaledAt && isGatingReady(state) && agentId !== "pack_bundler") {
      state.bundleSignaledAt = now;
      try {
        version = writeState(nk, state, version);
        signalClaimed = true;
      } catch (casErr: any) {
        delete state.bundleSignaledAt;
        logger.info("[n8n_pack_state] CAS lock lost on bundler signal claim for examTag=" + examTag + " — another emit owns it");
      }
      if (signalClaimed) {
        fired = fireBundlerWebhook(ctx, nk, logger, state);
        if (!fired) {
          // Webhook missing or failed — roll back the signal claim so the
          // bundler can pick this exam up via list_ready or a follow-up
          // emit can retry. We use the post-claim version to avoid
          // clobbering any concurrent reset.
          delete state.bundleSignaledAt;
          try {
            writeState(nk, state, version);
          } catch (rollbackErr: any) {
            logger.warn("[n8n_pack_state] rollback after failed webhook lost CAS for examTag=" + examTag + " — state will surface via list_ready");
          }
        }
      }
    }

    return JSON.stringify({
      success:        true,
      examTag:        examTag,
      agent:          agentId,
      status:         entry.status,
      gatingReady:    isGatingReady(state),
      bundlerSignaled: !!state.bundleSignaledAt,
      bundlerFired:   fired,
    });
  };

  // ---------------------------------------------------------------------------
  // RPC: query — returns full state for one examTag
  // ---------------------------------------------------------------------------

  var rpcQuery: nkruntime.RpcFunction = function (ctx, _logger, nk, payload) {
    var body: any = {};
    try { body = payload ? JSON.parse(payload) : {}; } catch (_) {}
    var examTag = ("" + (body.examTag || "")).trim();
    if (!examTag) throw nakamaError("examTag is required", nkruntime.Codes.INVALID_ARGUMENT);
    var s = readState(nk, examTag);
    if (!s.state) return JSON.stringify({ success: true, state: null });
    return JSON.stringify({
      success:        true,
      state:          s.state,
      gatingReady:    isGatingReady(s.state),
      bundlerSignaled: !!s.state.bundleSignaledAt,
      bundlerCompleted: !!s.state.bundleCompletedAt,
    });
  };

  // ---------------------------------------------------------------------------
  // RPC: list_ready — admin/system — exams ready for bundling
  // ---------------------------------------------------------------------------

  var rpcListReady: nkruntime.RpcFunction = function (ctx, _logger, nk, payload) {
    if (!isAdmin(ctx)) throw nakamaError("admin/system only", nkruntime.Codes.PERMISSION_DENIED);
    var body: any = {};
    try { body = payload ? JSON.parse(payload) : {}; } catch (_) {}
    var includeCompleted = body.includeCompleted === true;
    var limit = Math.min(Math.max(parseInt("" + (body.limit || 100), 10) || 100, 1), 200);

    var out: Array<{ examTag: string; signaledAt: number | null; completedAt: number | null }> = [];
    var cursor = "";
    var scanned = 0;
    do {
      var page = nk.storageList(null, COLLECTION, 200, cursor);
      cursor = page.cursor || "";
      var records = page.objects || [];
      for (var i = 0; i < records.length; i++) {
        scanned++;
        var v = records[i].value as unknown as PackState;
        if (!v) continue;
        if (!isGatingReady(v)) continue;
        if (!includeCompleted && v.bundleCompletedAt) continue;
        out.push({
          examTag:    v.examTag,
          signaledAt: v.bundleSignaledAt || null,
          completedAt: v.bundleCompletedAt || null,
        });
        if (out.length >= limit) break;
      }
    } while (cursor !== "" && out.length < limit);
    return JSON.stringify({ success: true, count: out.length, scanned: scanned, ready: out });
  };

  // ---------------------------------------------------------------------------
  // RPC: reset — admin — clear state (used to re-bundle after content edits)
  // ---------------------------------------------------------------------------

  var rpcReset: nkruntime.RpcFunction = function (ctx, logger, nk, payload) {
    if (!isAdmin(ctx)) throw nakamaError("admin/system only", nkruntime.Codes.PERMISSION_DENIED);
    var body: any = {};
    try { body = payload ? JSON.parse(payload) : {}; } catch (_) {}
    var examTag = ("" + (body.examTag || "")).trim();
    if (!examTag || !EXAM_TAG_RE.test(examTag)) {
      throw nakamaError("examTag is required and must match safe-chars", nkruntime.Codes.INVALID_ARGUMENT);
    }
    var clearAgents = body.clearAgents === true;

    var existing = readState(nk, examTag);
    if (!existing.state) return JSON.stringify({ success: true, examTag: examTag, action: "noop" });
    if (clearAgents) {
      nk.storageDelete([{ collection: COLLECTION, key: examTag, userId: SYSTEM_USER_ID, version: existing.version }]);
      logger.info("[n8n_pack_state] reset full clear examTag=" + examTag);
      return JSON.stringify({ success: true, examTag: examTag, action: "deleted" });
    }
    var next = existing.state;
    delete next.bundleSignaledAt;
    delete next.bundleCompletedAt;
    delete next.bundleSkus;
    next.updatedAt = Math.floor(Date.now() / 1000);
    writeState(nk, next, existing.version);
    logger.info("[n8n_pack_state] reset signal-only examTag=" + examTag);
    return JSON.stringify({ success: true, examTag: examTag, action: "signal_reset" });
  };

  // ---------------------------------------------------------------------------
  // Register — single-arg so the postbuild auto-invokes at IIFE scope.
  // (See bracket-tournaments.ts comment for the postbuild quirk.)
  // ---------------------------------------------------------------------------

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("n8n_pack_state_emit",       rpcEmit);
    initializer.registerRpc("n8n_pack_state_query",      rpcQuery);
    initializer.registerRpc("n8n_pack_state_list_ready", rpcListReady);
    initializer.registerRpc("n8n_pack_state_reset",      rpcReset);
  }
}
