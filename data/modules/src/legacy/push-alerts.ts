// =============================================================================
// PushAlerts — real-time Discord alerting for push *delivery* failures
// =============================================================================
// Why this exists:
//   The existing observability (AnalyticsAlerts 3h RPC summary, the Go
//   discord_alerts.go 6h Prometheus summary) only sees RPCs that THROW.
//   Push delivery failures don't throw — `push_send_event` returns
//   `success:true` with `recipientCount:0`, and the scheduled-push cron
//   silently drops to 0 sent. That blind spot is exactly how ~96% of FCM
//   sends could fail (UNREGISTERED) for days without a single alert firing.
//
//   PushAlerts watches the ACTUAL delivery outcome at the two places push
//   leaves Nakama (the on-demand `push_send_event` RPC and the scheduled
//   `sendLocalizedPushToUser` cron path) and posts a Discord alert when, over
//   a rolling window, the device-delivery failure rate crosses a threshold or
//   dead-token pruning spikes.
//
// Design (mirrors AnalyticsAlerts so it behaves predictably in prod):
//   • Per-pod in-memory tumbling window (no per-send storage writes — push is
//     hot path). The failure RATE is ~uniform across pods, so a per-pod window
//     is a faithful sample of the systemic rate.
//   • Cross-pod de-dupe: before posting, the pod claims a per-cooldown-bucket
//     storage lock (create-only `version:"*"`), so a 5-replica cluster emits
//     ONE alert per cooldown window, not five.
//   • Fail-safe: every path is wrapped — alerting must NEVER throw into or slow
//     down the push hot path. Missing webhook = silently disabled.
//   • Env: DISCORD_PUSH_WEBHOOK_URL (preferred), falls back to the existing
//     DISCORD_NAKAMA_WEBHOOK_URL so it works with zero new config.
// =============================================================================
namespace PushAlerts {
  // ── Tuning (all overridable via env, read in init) ────────────────────────
  var WINDOW_MS = 15 * 60 * 1000;          // rolling evaluation window
  var EVAL_MAX_ATTEMPTS = 2000;            // also evaluate early on a fast spike
  var MIN_ATTEMPTS = 50;                    // don't alert on tiny samples
  var FAIL_RATE_THRESHOLD = 0.5;           // ≥50% device sends failing → alert
  var DEAD_SPIKE_MIN = 200;                // ≥200 dead tokens pruned in window → alert
  var POST_COOLDOWN_MS = 30 * 60 * 1000;   // min spacing between alerts (per pod)

  var WEBHOOK_ENV = "DISCORD_PUSH_WEBHOOK_URL";
  var WEBHOOK_FALLBACK_ENV = "DISCORD_NAKAMA_WEBHOOK_URL";
  var LOCK_COLLECTION = "push_alerts_locks";
  var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

  // ── Per-pod state ─────────────────────────────────────────────────────────
  var podId: string = "pod_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now();
  var webhookUrl: string = "";
  var instanceLabel: string = "nakama";

  interface SourceCounter {
    attempted: number;
    delivered: number;
    failed: number;
    dead: number;
  }

  function newSource(): SourceCounter {
    return { attempted: 0, delivered: 0, failed: 0, dead: 0 };
  }

  var winStart: number = Date.now();
  var total: SourceCounter = newSource();
  var bySource: { [src: string]: SourceCounter } = {};
  var codeCounts: { [code: string]: number } = {};
  var lastPostMs: number = 0;
  // Goja runs InitModule on one VM but serves push traffic from a pool of
  // VMs that never ran it — so module state set only in init() would be empty
  // on the VMs that matter. `configured` lets every VM self-configure from
  // ctx.env on its first push outcome (see ensureConfigured).
  var configured: boolean = false;

  function resetWindow(): void {
    winStart = Date.now();
    total = newSource();
    bySource = {};
    codeCounts = {};
  }

  // ── Public init — called from InitModule with ctx so we can read env ───────
  export function init(ctx: nkruntime.Context, logger: nkruntime.Logger): void {
    try {
      var env: any = (ctx && ctx.env) ? ctx.env : {};
      webhookUrl = (env[WEBHOOK_ENV] || env[WEBHOOK_FALLBACK_ENV] || "") as string;
      if (env["IVX_NAKAMA_INSTANCE_LABEL"]) instanceLabel = env["IVX_NAKAMA_INSTANCE_LABEL"];
      else if (env["HOSTNAME"]) instanceLabel = env["HOSTNAME"];

      // Optional numeric overrides — keep ops able to retune without a deploy.
      WINDOW_MS = intEnv(env, "PUSH_ALERTS_WINDOW_MS", WINDOW_MS, 60 * 1000);
      MIN_ATTEMPTS = intEnv(env, "PUSH_ALERTS_MIN_ATTEMPTS", MIN_ATTEMPTS, 1);
      POST_COOLDOWN_MS = intEnv(env, "PUSH_ALERTS_COOLDOWN_MS", POST_COOLDOWN_MS, 60 * 1000);
      DEAD_SPIKE_MIN = intEnv(env, "PUSH_ALERTS_DEAD_SPIKE", DEAD_SPIKE_MIN, 1);
      var rate = floatEnv(env, "PUSH_ALERTS_FAIL_RATE", FAIL_RATE_THRESHOLD);
      if (rate > 0 && rate <= 1) FAIL_RATE_THRESHOLD = rate;

      resetWindow();
      configured = true;
      logger.info("[PushAlerts] init pod=%s webhook=%s window=%sms failRate=%s deadSpike=%s",
        podId,
        webhookUrl ? "configured" : "MISSING (" + WEBHOOK_ENV + "/" + WEBHOOK_FALLBACK_ENV + ")",
        String(WINDOW_MS), String(FAIL_RATE_THRESHOLD), String(DEAD_SPIKE_MIN));
    } catch (e: any) {
      try { logger.warn("[PushAlerts] init failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
    }
  }

  // Idempotent per-VM config. Called from the push hot path (which always has
  // ctx) so pooled VMs that never ran InitModule still pick up the webhook.
  export function ensureConfigured(ctx: nkruntime.Context, logger: nkruntime.Logger): void {
    if (configured) return;
    init(ctx, logger);
  }

  function intEnv(env: any, key: string, fallback: number, min: number): number {
    try {
      var v = env[key];
      if (v === undefined || v === null || v === "") return fallback;
      var n = parseInt(String(v), 10);
      if (isNaN(n) || n < min) return fallback;
      return n;
    } catch (_) { return fallback; }
  }

  function floatEnv(env: any, key: string, fallback: number): number {
    try {
      var v = env[key];
      if (v === undefined || v === null || v === "") return fallback;
      var n = parseFloat(String(v));
      if (isNaN(n)) return fallback;
      return n;
    } catch (_) { return fallback; }
  }

  // ── recordOutcome — called from the push send paths (hot path; never throws)
  //   source: "send_event" | "cron"
  //   attempted: device endpoints we tried this batch
  //   delivered: endpoints the provider accepted
  //   dead: token rows pruned this batch (provider said UNREGISTERED/disabled)
  //   codeTally: optional {failureCode: count} for the embed's "top reasons"
  // ──────────────────────────────────────────────────────────────────────────
  export function recordOutcome(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    source: string,
    attempted: number,
    delivered: number,
    dead: number,
    codeTally?: { [code: string]: number },
  ): void {
    try {
      if (!attempted || attempted <= 0) return;
      var failed = attempted - delivered;
      if (failed < 0) failed = 0;

      total.attempted += attempted;
      total.delivered += delivered;
      total.failed += failed;
      total.dead += (dead > 0 ? dead : 0);

      var src = source || "other";
      if (!bySource[src]) bySource[src] = newSource();
      bySource[src].attempted += attempted;
      bySource[src].delivered += delivered;
      bySource[src].failed += failed;
      bySource[src].dead += (dead > 0 ? dead : 0);

      if (codeTally) {
        for (var c in codeTally) {
          if (codeTally.hasOwnProperty(c)) {
            codeCounts[c] = (codeCounts[c] || 0) + codeTally[c];
          }
        }
      }

      var now = Date.now();
      if ((now - winStart) >= WINDOW_MS || total.attempted >= EVAL_MAX_ATTEMPTS) {
        evaluate(nk, logger);
      }
    } catch (e: any) {
      try { logger.warn("[PushAlerts] recordOutcome swallowed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
    }
  }

  function evaluate(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
    try {
      var snapshot = total;
      var attempts = snapshot.attempted;
      var failRate = attempts > 0 ? snapshot.failed / attempts : 0;
      var bad = attempts >= MIN_ATTEMPTS &&
        (failRate >= FAIL_RATE_THRESHOLD || snapshot.dead >= DEAD_SPIKE_MIN);

      if (bad && webhookUrl) {
        var now = Date.now();
        if ((now - lastPostMs) >= POST_COOLDOWN_MS && claimCooldownLock(nk, now)) {
          var embed = buildEmbed(snapshot, failRate);
          if (postDiscord(nk, logger, embed)) {
            lastPostMs = now;
            logger.warn("[PushAlerts] ALERT posted — attempts=%s failed=%s (%s%%) dead=%s",
              attempts, snapshot.failed, (failRate * 100).toFixed(1), snapshot.dead);
          }
        } else {
          logger.info("[PushAlerts] degraded window detected but suppressed (cooldown/leader) — attempts=%s failRate=%s%%",
            attempts, (failRate * 100).toFixed(1));
        }
      }
    } catch (e: any) {
      try { logger.warn("[PushAlerts] evaluate swallowed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
    } finally {
      // Always reset so the window stays bounded whether or not we alerted.
      resetWindow();
    }
  }

  // Cross-pod de-dupe: create-only write on a per-cooldown-bucket key. Only the
  // first replica in the bucket succeeds; the rest get a version conflict and
  // skip posting. Fail-CLOSED here (return false on any error) so a storage
  // blip can't fan out N duplicate alerts.
  function claimCooldownLock(nk: nkruntime.Nakama, now: number): boolean {
    try {
      var bucket = Math.floor(now / POST_COOLDOWN_MS);
      nk.storageWrite([{
        collection: LOCK_COLLECTION,
        key: "alert_" + bucket,
        userId: SYSTEM_USER,
        value: { holder: podId, at: now },
        permissionRead: 0,
        permissionWrite: 0,
        version: "*",
      }]);
      return true;
    } catch (_) {
      return false;
    }
  }

  function pct(n: number, d: number): string {
    if (!d) return "0%";
    return (Math.round((n / d) * 1000) / 10) + "%";
  }

  function buildEmbed(s: SourceCounter, failRate: number): any {
    var fields: any[] = [];

    fields.push({
      name: "📉 Device delivery (last window)",
      value:
        "Attempted: **" + s.attempted + "**\n" +
        "Delivered: **" + s.delivered + "** (" + pct(s.delivered, s.attempted) + ")\n" +
        "Failed: **" + s.failed + "** (" + pct(s.failed, s.attempted) + ")\n" +
        "Dead tokens pruned: **" + s.dead + "**",
      inline: false,
    });

    // Per-source split so on-call knows if it's on-demand pushes, the cron, or both.
    var srcLines: string[] = [];
    for (var src in bySource) {
      if (!bySource.hasOwnProperty(src)) continue;
      var c = bySource[src];
      srcLines.push("`" + src + "` " + c.delivered + "/" + c.attempted + " ok (" +
        pct(c.failed, c.attempted) + " fail · " + c.dead + " pruned)");
    }
    if (srcLines.length > 0) {
      fields.push({ name: "🧩 By source", value: srcLines.join("\n").slice(0, 1024), inline: false });
    }

    // Top failure reasons (FCM/APNs/SNS codes) — points straight at root cause.
    var codeRows: { code: string; n: number }[] = [];
    for (var code in codeCounts) {
      if (codeCounts.hasOwnProperty(code) && code) codeRows.push({ code: code, n: codeCounts[code] });
    }
    codeRows.sort(function (a, b) { return b.n - a.n; });
    if (codeRows.length > 0) {
      var codeLines: string[] = [];
      for (var i = 0; i < codeRows.length && i < 6; i++) {
        codeLines.push("`" + String(codeRows[i].code).slice(0, 48) + "` ×" + codeRows[i].n);
      }
      fields.push({ name: "🧨 Top failure reasons", value: codeLines.join("\n").slice(0, 1024), inline: false });
    }

    fields.push({
      name: "🛠️ Likely action",
      value:
        "• UNREGISTERED/NOT_FOUND → dead tokens (auto-pruned now; expected to fall)\n" +
        "• If failRate stays high after pruning → check Firebase project match " +
        "(`DEFAULT_FCM_PROJECT_ID` vs token-minting project) + send Lambda IAM/secrets",
      inline: false,
    });

    return {
      title: "🔴 Nakama push delivery degraded",
      description: "Device-push failure rate **" + pct(s.failed, s.attempted) +
        "** over the last window (threshold " + Math.round(FAIL_RATE_THRESHOLD * 100) + "%). " +
        "In-app inbox notifications are unaffected; this is device push (FCM/APNs) only.",
      color: 0xe74c3c,
      timestamp: new Date().toISOString(),
      footer: { text: "nakama-push-alerts • " + instanceLabel + " • pod " + podId },
      fields: fields,
    };
  }

  function postDiscord(nk: nkruntime.Nakama, logger: nkruntime.Logger, embed: any): boolean {
    if (!webhookUrl) return false;
    try {
      var body = JSON.stringify({ username: "Nakama Push Watchdog", embeds: [embed] });
      var resp: any = nk.httpRequest(webhookUrl, "post", { "Content-Type": "application/json" }, body, 5000);
      var code = resp && resp.code ? resp.code : 0;
      if (code >= 200 && code < 300) return true;
      logger.warn("[PushAlerts] discord post non-2xx: code=" + String(code) +
        " body=" + (resp && resp.body ? String(resp.body).slice(0, 200) : ""));
      return false;
    } catch (e: any) {
      logger.warn("[PushAlerts] discord post failed: " + (e && e.message ? e.message : String(e)));
      return false;
    }
  }

  // ── Ops RPCs ──────────────────────────────────────────────────────────────
  function rpcStatus(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _payload: string): string {
    return JSON.stringify({
      success: true,
      data: {
        podId: podId,
        webhookConfigured: !!webhookUrl,
        windowMs: WINDOW_MS,
        minAttempts: MIN_ATTEMPTS,
        failRateThreshold: FAIL_RATE_THRESHOLD,
        deadSpikeMin: DEAD_SPIKE_MIN,
        cooldownMs: POST_COOLDOWN_MS,
        currentWindow: total,
        lastPostMs: lastPostMs,
      },
    });
  }

  // Fires a synthetic alert so ops can verify the webhook end-to-end without
  // waiting for a real outage. Does not touch the live counters.
  function rpcTest(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    if (!webhookUrl) {
      return JSON.stringify({ success: false, error: WEBHOOK_ENV + "/" + WEBHOOK_FALLBACK_ENV + " not set" });
    }
    var sample: SourceCounter = { attempted: 100, delivered: 4, failed: 96, dead: 90 };
    bySource["send_event"] = { attempted: 70, delivered: 3, failed: 67, dead: 63 };
    bySource["cron"] = { attempted: 30, delivered: 1, failed: 29, dead: 27 };
    codeCounts["UNREGISTERED"] = 88;
    codeCounts["ENDPOINT_DISABLED"] = 8;
    var ok = postDiscord(nk, logger, buildEmbed(sample, 0.96));
    bySource = {};
    codeCounts = {};
    return JSON.stringify({ success: ok, data: { posted: ok } });
  }

  // register is single-arg (registerRpc-only) so postbuild's autoInvokeRegister
  // re-runs it on every pooled Goja VM — otherwise the RPC stubs are undefined
  // on the VMs that actually serve traffic.
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("push_alerts_status", rpcStatus);
    initializer.registerRpc("push_alerts_test", rpcTest);
  }
}
