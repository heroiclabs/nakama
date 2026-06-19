// ---------------------------------------------------------------------------
// Satori Event Debugger — admin live tail + historical search over captured
// events. Replaces the Satori Cloud console "Taxonomy → Debugger" workflow.
//
// Two data paths:
//   1. LIVE TAIL  — a rolling ring buffer (last RECENT_MAX events) maintained
//      by SatoriEventCapture at ingest time. One storage read per tail call,
//      so the admin UI can poll every few seconds without scanning.
//   2. SEARCH     — paged scan of the `satori_events` collection (records are
//      keyed ev_<date>_<userId>_<ts> under SYSTEM_USER). Bounded by max_pages
//      so a runaway query can never hang a VM.
//
// Both RPCs are admin-only. The tail response also reports, per event name,
// whether a taxonomy schema exists — the UI uses that for the one-click
// "register in taxonomy" action (which calls the existing
// `satori_taxonomy_upsert` RPC).
// ---------------------------------------------------------------------------
namespace SatoriEventDebugger {

  var RECENT_COLLECTION = "satori_debugger";
  var RECENT_KEY = "recent_events";
  var RECENT_MAX = 300;

  // Rejected-event ring buffer — backs the dashboard "Event errors" panel
  // (mirrors Satori Cloud's "Events rejected at ingestion" surface). Written
  // by SatoriEventCapture whenever taxonomy validation fails.
  var REJECT_KEY = "rejected_events";
  var REJECT_MAX = 200;

  var SEARCH_PAGE_SIZE = 100;
  var SEARCH_DEFAULT_PAGES = 320;  // covers the legacy (oldest-first) key tail
  var SEARCH_MAX_PAGES = 800;
  var SEARCH_MAX_RESULTS = 500;

  interface DebugEvent {
    userId?: string;
    identityId?: string;
    name: string;
    timestamp: number;
    metadata: { [key: string]: any };
    date?: string;
    external?: boolean;
  }

  interface RejectedEvent {
    name: string;
    reason: string;
    code: string;
    timestamp: number;
    userId?: string;
  }

  // Normalize second-resolution timestamps to milliseconds so the UI can
  // sort/format uniformly (clients send ms, some server paths send seconds).
  function toMs(ts: number): number {
    if (!ts) return 0;
    return ts < 100000000000 ? ts * 1000 : ts;
  }

  // ---- Live tail ring buffer (called from SatoriEventCapture) ----

  export function record(nk: nkruntime.Nakama, event: DebugEvent): void {
    try {
      var buf = Storage.readSystemJson<{ events: DebugEvent[] }>(nk, RECENT_COLLECTION, RECENT_KEY);
      if (!buf || !buf.events) buf = { events: [] };
      buf.events.push(event);
      if (buf.events.length > RECENT_MAX) {
        buf.events = buf.events.slice(buf.events.length - RECENT_MAX);
      }
      Storage.writeSystemJson(nk, RECENT_COLLECTION, RECENT_KEY, buf);
    } catch (err: any) {
      // Debugger plumbing must never break event ingest.
    }
  }

  // Classify a validation reason into a short, Satori-style error code.
  function classifyReason(reason: string): string {
    var r = (reason || "").toLowerCase();
    if (r.indexOf("unknown event") !== -1 || r.indexOf("strict") !== -1) return "INVALID_NAME";
    if (r.indexOf("max length") !== -1 || r.indexOf("exceeds") !== -1) return "INVALID_VALUE";
    if (r.indexOf("required metadata") !== -1 || r.indexOf("metadata required") !== -1) return "MISSING_METADATA";
    if (r.indexOf("should be") !== -1 || r.indexOf("too many metadata") !== -1) return "INVALID_METADATA";
    return "INVALID_EVENT";
  }

  // Record a rejected (taxonomy-invalid) event for the admin "Event errors"
  // panel. Called by SatoriEventCapture on every validation failure.
  export function recordRejection(nk: nkruntime.Nakama, name: string, reason: string, userId?: string): void {
    try {
      var buf = Storage.readSystemJson<{ events: RejectedEvent[] }>(nk, RECENT_COLLECTION, REJECT_KEY);
      if (!buf || !buf.events) buf = { events: [] };
      buf.events.push({
        name: name || "(unnamed)",
        reason: reason || "",
        code: classifyReason(reason),
        timestamp: Date.now(),
        userId: userId || ""
      });
      if (buf.events.length > REJECT_MAX) {
        buf.events = buf.events.slice(buf.events.length - REJECT_MAX);
      }
      Storage.writeSystemJson(nk, RECENT_COLLECTION, REJECT_KEY, buf);
    } catch (err: any) {
      // Never break ingest on bookkeeping.
    }
  }

  // ---- Filtering ----

  function matches(ev: DebugEvent, filters: any): boolean {
    if (filters.name && ev.name !== filters.name) return false;
    if (filters.nameContains && ev.name.indexOf(filters.nameContains) === -1) return false;
    if (filters.userId && ev.userId !== filters.userId && ev.identityId !== filters.userId) return false;
    if (filters.sinceMs && toMs(ev.timestamp) < filters.sinceMs) return false;
    if (filters.untilMs && toMs(ev.timestamp) > filters.untilMs) return false;
    if (filters.externalOnly && !ev.external) return false;
    return true;
  }

  function parseFilters(data: any): any {
    return {
      name: data.name || undefined,
      nameContains: data.name_contains || data.nameContains || undefined,
      userId: data.user_id || data.userId || undefined,
      sinceMs: data.since_ms || data.sinceMs || undefined,
      untilMs: data.until_ms || data.untilMs || undefined,
      externalOnly: !!(data.external_only || data.externalOnly)
    };
  }

  function schemaStatus(nk: nkruntime.Nakama, events: DebugEvent[]): any[] {
    var taxonomy = ConfigLoader.loadSatoriConfig<{ schemas: { [name: string]: any } }>(nk, "taxonomy", { schemas: {} });
    var schemas = (taxonomy && taxonomy.schemas) || {};
    var counts: { [name: string]: number } = {};
    for (var i = 0; i < events.length; i++) {
      counts[events[i].name] = (counts[events[i].name] || 0) + 1;
    }
    var names: any[] = [];
    for (var name in counts) {
      names.push({ name: name, count: counts[name], hasSchema: !!schemas[name] });
    }
    names.sort(function (a, b) { return b.count - a.count; });
    return names;
  }

  // ---- RPCs ----

  // satori_events_tail — latest events from the ring buffer, newest first.
  // Payload: { limit?, name?, name_contains?, user_id?, since_ms?, external_only? }
  function rpcTail(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var limit = Math.min(Math.max(parseInt(data.limit, 10) || 100, 1), RECENT_MAX);
    var filters = parseFilters(data);

    var buf = Storage.readSystemJson<{ events: DebugEvent[] }>(nk, RECENT_COLLECTION, RECENT_KEY);
    var all = (buf && buf.events) || [];

    var matched: DebugEvent[] = [];
    for (var i = all.length - 1; i >= 0 && matched.length < limit; i--) {
      if (matches(all[i], filters)) matched.push(all[i]);
    }

    var out: any[] = [];
    for (var j = 0; j < matched.length; j++) {
      var ev = matched[j];
      out.push({
        name: ev.name,
        userId: ev.userId || ev.identityId || "",
        timestampMs: toMs(ev.timestamp),
        metadata: ev.metadata || {},
        external: !!ev.external
      });
    }

    return RpcHelpers.successResponse({
      events: out,
      names: schemaStatus(nk, matched),
      bufferSize: all.length,
      bufferMax: RECENT_MAX
    });
  }

  // satori_events_search — bounded historical scan over satori_events.
  // Payload: { limit?, max_pages?, cursor?, name?, name_contains?, user_id?,
  //            since_ms?, until_ms?, external_only? }
  function rpcSearch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var limit = Math.min(Math.max(parseInt(data.limit, 10) || 200, 1), SEARCH_MAX_RESULTS);
    var maxPages = Math.min(Math.max(parseInt(data.max_pages, 10) || SEARCH_DEFAULT_PAGES, 1), SEARCH_MAX_PAGES);
    var filters = parseFilters(data);

    var matched: DebugEvent[] = [];
    var cursor: string = data.cursor || "";
    var scannedRecords = 0;
    var pages = 0;
    var truncated = false;

    for (var p = 0; p < maxPages; p++) {
      var page = nk.storageList(Constants.SYSTEM_USER_ID, Constants.SATORI_EVENTS_COLLECTION, SEARCH_PAGE_SIZE, cursor);
      var objects = (page && page.objects) || [];
      pages++;

      for (var i = 0; i < objects.length; i++) {
        var obj = objects[i];
        if (!obj.key || obj.key.indexOf("ev_") !== 0 || !obj.value) continue;
        scannedRecords++;
        var ev = obj.value as any as DebugEvent;
        if (matches(ev, filters)) matched.push(ev);
      }

      cursor = (page && page.cursor) || "";
      if (!cursor) break;
      if (matched.length >= SEARCH_MAX_RESULTS) { truncated = true; break; }
    }
    if (cursor && pages >= maxPages) truncated = true;

    matched.sort(function (a, b) { return toMs(b.timestamp) - toMs(a.timestamp); });
    if (matched.length > limit) {
      matched = matched.slice(0, limit);
      truncated = true;
    }

    var out: any[] = [];
    for (var j = 0; j < matched.length; j++) {
      var m = matched[j];
      out.push({
        name: m.name,
        userId: m.userId || m.identityId || "",
        timestampMs: toMs(m.timestamp),
        metadata: m.metadata || {},
        external: !!m.external
      });
    }

    return RpcHelpers.successResponse({
      events: out,
      names: schemaStatus(nk, matched),
      scannedPages: pages,
      scannedRecords: scannedRecords,
      truncated: truncated,
      nextCursor: cursor || null
    });
  }

  // satori_event_errors — recent taxonomy-rejected events, grouped by name,
  // for the dashboard "Event errors" panel. Payload: { limit? }
  function rpcEventErrors(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var limit = Math.min(Math.max(parseInt(data.limit, 10) || 50, 1), REJECT_MAX);

    var buf = Storage.readSystemJson<{ events: RejectedEvent[] }>(nk, RECENT_COLLECTION, REJECT_KEY);
    var all = (buf && buf.events) || [];

    // Group by name+code so the panel shows one row per distinct error with a
    // count and the most-recent timestamp/reason (matches Satori's layout).
    var groups: { [k: string]: any } = {};
    var order: string[] = [];
    for (var i = 0; i < all.length; i++) {
      var ev = all[i];
      var k = ev.name + "|" + ev.code;
      if (!groups[k]) {
        groups[k] = { name: ev.name, code: ev.code, reason: ev.reason, count: 0, lastSeenMs: 0 };
        order.push(k);
      }
      groups[k].count++;
      var tms = toMs(ev.timestamp);
      if (tms > groups[k].lastSeenMs) {
        groups[k].lastSeenMs = tms;
        groups[k].reason = ev.reason;
      }
    }

    var rows: any[] = [];
    for (var j = 0; j < order.length; j++) rows.push(groups[order[j]]);
    rows.sort(function (a, b) { return b.lastSeenMs - a.lastSeenMs; });
    if (rows.length > limit) rows = rows.slice(0, limit);

    return RpcHelpers.successResponse({
      errors: rows,
      totalRejected: all.length,
      distinctErrors: order.length
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_events_tail", rpcTail);
    initializer.registerRpc("satori_events_search", rpcSearch);
    initializer.registerRpc("satori_event_errors", rpcEventErrors);
  }
}
