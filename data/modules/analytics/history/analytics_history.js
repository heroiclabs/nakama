// analytics_history.js — Phase 6 (2026-05) long-tail analytics.
//
// "Don't wipe anything, show everything" — the user's stance on data
// retention. Phase 6 doesn't archive or delete; it builds the long-tail
// rollup tiers (monthly, yearly, lifetime) and a paginated raw event
// browser so the dashboard can render years of history at sub-second
// latency without a single live event scan.
//
// Storage layout (all owned by SYSTEM_USER, permissionRead/Write 0/0):
//
//   analytics_rollup_monthly  / monthly_<gameId>_<YYYY-MM>
//   analytics_rollup_yearly   / yearly_<gameId>_<YYYY>
//   analytics_lifetime_totals / totals_<gameId>
//
// Aggregator semantics — all three tiers fold the SAME shape we already
// store in analytics_rollup_daily (Phase 4 augmented form). Every numeric
// metric is summed; every "top-N" array (top_products, top_screens,
// platform_breakdown, ...) is merged-and-resorted then top-N'd again so
// the long-tail doc stays bounded. Unique-user counts are summed as an
// upper bound (same convention as wau_estimated/mau_estimated in
// rpcAnalyticsDashboard — we don't have user lists in the daily doc, so
// dedupe across days isn't possible).
//
// Registered RPCs (5 admin-gated):
//
//   analytics_history_monthly_read   — read N months back, ascending date
//   analytics_history_yearly_read    — read all yearly rollups
//   analytics_history_lifetime_read  — single all-time totals doc
//   analytics_history_browse         — unbounded date-range raw event browser
//                                       w/ cursor pagination + filters
//   analytics_history_recompute      — full backfill of monthly+yearly+lifetime
//                                       from existing daily rollups (one-shot)
//   analytics_history_status         — surfaces what's been computed
//
// Hook: rpcAnalyticsRollupRun (analytics_rollup.js) calls
// arvBumpForDate(gameId, dateStr) at the end of each daily run, which
// incrementally updates the monthly, yearly and lifetime totals in
// place — no separate cron required.

var ARV_SYSTEM_USER             = "00000000-0000-0000-0000-000000000000";
var ARV_ROLLUP_DAILY_COLLECTION = "analytics_rollup_daily";
var ARV_MONTHLY_COLLECTION      = "analytics_rollup_monthly";
var ARV_YEARLY_COLLECTION       = "analytics_rollup_yearly";
var ARV_LIFETIME_COLLECTION     = "analytics_lifetime_totals";
var ARV_HISTORY_META_COLLECTION = "analytics_history_meta";
var ARV_EVENTS_COLLECTION       = "analytics_events";
var ARV_FIRST_SEEN_COLLECTION   = "analytics_user_first_seen";

// Hard caps on long-tail panel response sizes. Keeps a 5-year monthly
// chart under 60 docs (~ 200 KB) and a yearly chart under 5 docs.
var ARV_MAX_MONTHS = 60;        // 5 years
var ARV_MAX_YEARS  = 10;        // 10 years (we'll never come close)

// Browse RPC defaults — the operator can ask for up to 200 events per
// page across an unbounded date range. Cursor based.
var ARV_BROWSE_DEFAULT_LIMIT = 50;
var ARV_BROWSE_MAX_LIMIT     = 200;
var ARV_BROWSE_MAX_SCAN      = 5000; // per request, regardless of limit

// ─── Helpers ──────────────────────────────────────────────

function arvParse(payload) {
    try { return JSON.parse(payload || "{}"); } catch (e) { return {}; }
}

function arvOk(data) {
    var out = { success: true };
    if (data) for (var k in data) if (data.hasOwnProperty(k)) out[k] = data[k];
    return JSON.stringify(out);
}

function arvErr(msg, code) {
    return JSON.stringify({ success: false, error: msg || "error", code: code || 400 });
}

// Reuse aaRequireAdmin (analytics_admin.js) — hoisted to global scope by postbuild.
function arvRequireAdmin(ctx, nk, logger, data) {
    if (typeof aaRequireAdmin === "function") {
        return aaRequireAdmin(ctx, nk, logger, data);
    }
    return { ok: false, reason: "aaRequireAdmin not available" };
}

// Resolve gameId aliases (slug → UUID) so monthly/yearly/lifetime never
// double-bucket the same game under two keys.
function arvResolveGameId(g) {
    if (!g) return g;
    try {
        if (typeof resolveGameIdAlias === "function") return resolveGameIdAlias(g);
    } catch (e) { /* not loaded */ }
    return g;
}

function arvValidDateStr(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s || "");
}
function arvIsoDate(d) {
    return d.toISOString().slice(0, 10);
}
function arvYearMonth(dateStr) { return dateStr.slice(0, 7); }   // YYYY-MM
function arvYear(dateStr)      { return dateStr.slice(0, 4); }   // YYYY

function arvReadOne(nk, collection, key) {
    try {
        var r = nk.storageRead([{ collection: collection, key: key, userId: ARV_SYSTEM_USER }]);
        if (r && r.length > 0) return r[0].value || null;
    } catch (e) { /* ignore */ }
    return null;
}
function arvWriteOne(nk, collection, key, value) {
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: ARV_SYSTEM_USER,
            value: value,
            permissionRead: 0,
            permissionWrite: 0
        }]);
        return true;
    } catch (e) { return false; }
}

// Count distinct users in analytics_user_first_seen for a game.
// Keys: first_<userId>_<gameId>. This is the canonical "new users ever"
// registry — summing daily rollup new_users under-counts (rollup gaps,
// folded window ends before today).
function arvCountFirstSeenUsers(nk, gameId) {
    gameId = arvResolveGameId(gameId) || "all";
    try {
        if (gameId === "all") {
            var rowsAll = nk.sqlQuery(
                "SELECT COUNT(*)::int AS cnt FROM storage WHERE collection = $1 AND LEFT(key, 6) = $2",
                [ARV_FIRST_SEEN_COLLECTION, "first_"]
            );
            if (rowsAll && rowsAll.length > 0) {
                return parseInt(rowsAll[0].cnt, 10) || 0;
            }
        } else {
            var suffix = "_" + gameId;
            var rows = nk.sqlQuery(
                "SELECT COUNT(*)::int AS cnt FROM storage WHERE collection = $1 AND RIGHT(key, LENGTH($2)) = $2",
                [ARV_FIRST_SEEN_COLLECTION, suffix]
            );
            if (rows && rows.length > 0) {
                return parseInt(rows[0].cnt, 10) || 0;
            }
        }
    } catch (e) { /* SQL unavailable — paginate below */ }

    // Fallback: cursor-paginate storageList (slower, no SQL dependency).
    var suffixFilter = gameId === "all" ? null : ("_" + gameId);
    var count = 0;
    var cursor = null;
    var pages = 0;
    while (pages < 200) {
        var page = nk.storageList(ARV_SYSTEM_USER, ARV_FIRST_SEEN_COLLECTION, 100, cursor);
        if (!page || !page.objects || page.objects.length === 0) break;
        for (var i = 0; i < page.objects.length; i++) {
            var k = page.objects[i].key || "";
            if (k.indexOf("first_") !== 0) continue;
            if (suffixFilter && k.slice(-suffixFilter.length) !== suffixFilter) continue;
            count++;
        }
        pages++;
        if (!page.cursor) break;
        cursor = page.cursor;
    }
    return count;
}

// ─── Aggregator: fold daily rollup into a long-tail bucket ────

// Merges `from` (daily, monthly OR another long-tail doc) into `into`
// (the bucket doc — monthly/yearly/lifetime). The bucket has the same
// numeric shape as the daily rollup but its top-N arrays carry the
// merged-and-re-sorted top across every day folded in.
//
// Used by all three tiers (daily→monthly, monthly→yearly, yearly→lifetime).
// Fold direction is always "from = smaller bucket, into = larger".
function arvFoldInto(into, from) {
    if (!from) return into;
    if (!into) into = arvEmptyBucket();

    into.dau            += from.dau || 0;
    into.new_users      += from.new_users || 0;
    into.event_count    += from.event_count || 0;

    // Sessions
    if (from.sessions) {
        into.sessions.count                 += from.sessions.count || 0;
        into.sessions.starts                += from.sessions.starts || 0;
        into.sessions.total_duration_seconds += from.sessions.total_duration_seconds || 0;
    }
    // avg_duration is recomputed at finalize time from total/count.

    // Revenue
    if (from.revenue) {
        var fr = from.revenue, ir = into.revenue;
        ir.usd                  = arvR(ir.usd                  + (fr.usd || 0));
        ir.iap_count            +=     fr.iap_count            || 0;
        ir.ad_revenue_usd       = arvR(ir.ad_revenue_usd       + (fr.ad_revenue_usd || 0));
        ir.ad_impressions       +=     fr.ad_impressions       || 0;
        ir.ad_clicks            +=     fr.ad_clicks            || 0;
        ir.ad_requests          +=     fr.ad_requests          || 0;
        ir.ad_load_failures     +=     fr.ad_load_failures     || 0;
        ir.ad_completions       +=     fr.ad_completions       || 0;
        ir.ad_skips             +=     fr.ad_skips             || 0;
        ir.iap_started          +=     fr.iap_started          || 0;
        ir.iap_failed           +=     fr.iap_failed           || 0;
        ir.paywall_shown        +=     fr.paywall_shown        || 0;
        ir.paywall_converted    +=     fr.paywall_converted    || 0;
        ir.paywall_dismissed    +=     fr.paywall_dismissed    || 0;
        ir.store_opens          +=     fr.store_opens          || 0;

        // Per-network revenue map
        if (fr.ad_revenue_by_network) {
            for (var nn in fr.ad_revenue_by_network) {
                if (fr.ad_revenue_by_network.hasOwnProperty(nn)) {
                    ir.ad_revenue_by_network[nn] = arvR(
                        (ir.ad_revenue_by_network[nn] || 0) + (fr.ad_revenue_by_network[nn] || 0)
                    );
                }
            }
        }
        // top_products + ad_types — fold by key, top-N at finalize.
        arvFoldTopN(ir._top_products_acc, fr.top_products, "product_id", "purchases");
        arvFoldTopN(ir._ad_types_acc,     fr.ad_types,     "type",       "count");
    }

    // Funnel — sum users + total_events per step
    if (from.funnel) {
        for (var step in from.funnel) {
            if (!from.funnel.hasOwnProperty(step)) continue;
            if (!into.funnel[step]) into.funnel[step] = { users: 0, total_events: 0 };
            into.funnel[step].users        += from.funnel[step].users || 0;
            into.funnel[step].total_events += from.funnel[step].total_events || 0;
        }
    }

    // AI usage
    if (from.ai_usage) {
        for (var aiK in from.ai_usage) {
            if (from.ai_usage.hasOwnProperty(aiK)) {
                into.ai_usage[aiK] = (into.ai_usage[aiK] || 0) + from.ai_usage[aiK];
            }
        }
    }

    // top_events / top_screens / platform_breakdown / errors
    arvFoldTopN(into._top_events_acc,      from.top_events,         "event_name",  "count");
    arvFoldTopN(into._top_screens_acc,     from.top_screens,        "screen_name", "views");
    arvFoldTopN(into._platform_acc,        from.platform_breakdown, "platform",    "events");
    if (from.errors) {
        for (var ec in from.errors) {
            if (from.errors.hasOwnProperty(ec)) {
                into.errors[ec] = (into.errors[ec] || 0) + from.errors[ec];
            }
        }
    }

    // Retention milestones
    if (from.retention_milestones) {
        var fm = from.retention_milestones, im = into.retention_milestones;
        im.retention_d1  += fm.retention_d1  || 0;
        im.retention_d7  += fm.retention_d7  || 0;
        im.retention_d30 += fm.retention_d30 || 0;
    }

    // Audience — fold each dimension's top-N into accumulators
    if (from.audience) {
        for (var dim in into._audience_acc) {
            if (!into._audience_acc.hasOwnProperty(dim)) continue;
            if (!from.audience[dim]) continue;
            var rows = from.audience[dim];
            for (var r = 0; r < rows.length; r++) {
                var row = rows[r];
                var slot = into._audience_acc[dim][row.value];
                if (!slot) {
                    slot = { events: 0, unique_users: 0 };
                    into._audience_acc[dim][row.value] = slot;
                }
                slot.events       += row.events || 0;
                slot.unique_users += row.unique_users || 0;
            }
        }
    }

    // Date bookkeeping — bucket spans from earliest to latest folded date.
    // `from` may be a single daily rollup (has `date`) or an already-aggregated
    // monthly/yearly bucket (has `range_start`/`range_end`). For aggregated
    // buckets we must honor BOTH ends of the span, not just one date, otherwise
    // the parent tier's range collapses to a single boundary date.
    var fromStart = from.date || from.range_start || from.range_end || null;
    var fromEnd   = from.date || from.range_end   || from.range_start || null;
    if (fromStart && (!into.range_start || fromStart < into.range_start)) into.range_start = fromStart;
    if (fromEnd   && (!into.range_end   || fromEnd   > into.range_end))   into.range_end   = fromEnd;

    // Accumulate the number of days the source represents. A daily rollup has
    // no `days_folded` field and counts as 1; a monthly/yearly bucket already
    // carries the total days it folded, so add that (don't count it as 1).
    var fromDays = (typeof from.days_folded === "number" && from.days_folded > 0)
        ? from.days_folded
        : 1;
    into.days_folded = (into.days_folded || 0) + fromDays;
    return into;
}

// Round to 2 decimal places (USD).
function arvR(v) { return Math.round((v || 0) * 100) / 100; }

// Fold a top-N array into an accumulator map (by key field).
function arvFoldTopN(accMap, srcArr, keyField, valueField) {
    if (!srcArr || !srcArr.length) return;
    for (var i = 0; i < srcArr.length; i++) {
        var row = srcArr[i];
        if (!row) continue;
        var k = row[keyField];
        if (k === undefined || k === null || k === "") continue;
        accMap[k] = (accMap[k] || 0) + (row[valueField] || 0);
    }
}

// Materialize an accumulator map back into a top-N array.
function arvMaterializeTopN(accMap, n, keyField, valueField) {
    var arr = [];
    for (var k in accMap) {
        if (accMap.hasOwnProperty(k)) {
            var entry = {};
            entry[keyField] = k;
            entry[valueField] = (keyField === "event_name" || keyField === "type" ||
                                 keyField === "platform" || keyField === "screen_name" ||
                                 keyField === "product_id")
                ? Math.round(accMap[k])
                : accMap[k];
            arr.push(entry);
        }
    }
    arr.sort(function (a, b) { return b[valueField] - a[valueField]; });
    return arr.slice(0, n);
}

function arvEmptyAudience() {
    return {
        country: {}, platform: {}, device_tier: {},
        install_source: {}, consent_state: {}, att_status: {},
        locale: {}, app_version: {}
    };
}

function arvMaterializeAudience(accAudDims) {
    function materialize(dim, topN) {
        var bag = accAudDims[dim] || {};
        var arr = [];
        for (var v in bag) {
            if (bag.hasOwnProperty(v)) {
                arr.push({
                    value: v,
                    events: bag[v].events,
                    unique_users: bag[v].unique_users
                });
            }
        }
        arr.sort(function (a, b) { return (b.unique_users - a.unique_users) || (b.events - a.events); });
        return arr.slice(0, topN);
    }
    return {
        country:        materialize("country", 25),
        platform:       materialize("platform", 10),
        device_tier:    materialize("device_tier", 10),
        install_source: materialize("install_source", 10),
        consent_state:  materialize("consent_state", 10),
        att_status:     materialize("att_status", 10),
        locale:         materialize("locale", 25),
        app_version:    materialize("app_version", 25)
    };
}

function arvEmptyBucket() {
    return {
        gameId: "all",
        range_start: null,
        range_end: null,
        days_folded: 0,
        dau: 0,
        new_users: 0,
        event_count: 0,
        sessions: { count: 0, starts: 0, total_duration_seconds: 0 },
        revenue: {
            usd: 0, iap_count: 0,
            ad_revenue_usd: 0, ad_impressions: 0, ad_clicks: 0,
            ad_requests: 0, ad_load_failures: 0, ad_completions: 0, ad_skips: 0,
            iap_started: 0, iap_failed: 0,
            paywall_shown: 0, paywall_converted: 0, paywall_dismissed: 0,
            store_opens: 0,
            ad_revenue_by_network: {},
            // Internal accumulators (stripped at finalize).
            _top_products_acc: {},
            _ad_types_acc: {}
        },
        funnel: {},
        ai_usage: {},
        errors: {},
        retention_milestones: { retention_d1: 0, retention_d7: 0, retention_d30: 0 },

        // Internal accumulators (stripped at finalize).
        _top_events_acc:      {},
        _top_screens_acc:     {},
        _platform_acc:        {},
        _audience_acc:        arvEmptyAudience(),

        computed_at: null
    };
}

// Convert internal accumulators into final top-N arrays. Mutates `bucket`.
// Called once per write so the persisted doc is small and ready-to-render.
function arvFinalize(bucket) {
    var sessions = bucket.sessions || { count: 0, total_duration_seconds: 0 };
    bucket.sessions.avg_duration_seconds = sessions.count > 0
        ? Math.round(sessions.total_duration_seconds / sessions.count)
        : 0;

    var rev = bucket.revenue || {};
    rev.ad_fill_rate_pct = rev.ad_requests > 0
        ? Math.round((rev.ad_impressions / rev.ad_requests) * 100)
        : 0;
    rev.ad_completion_rate_pct = rev.ad_impressions > 0
        ? Math.round((rev.ad_completions / rev.ad_impressions) * 100)
        : 0;
    rev.ad_ecpm_usd = rev.ad_impressions > 0
        ? Math.round((rev.ad_revenue_usd / rev.ad_impressions) * 100000) / 100
        : 0;
    rev.paywall_conversion_rate_pct = rev.paywall_shown > 0
        ? Math.round((rev.paywall_converted / rev.paywall_shown) * 100)
        : 0;
    rev.top_products = arvMaterializeTopN(rev._top_products_acc || {}, 10, "product_id", "purchases");
    rev.ad_types     = arvMaterializeTopN(rev._ad_types_acc     || {}, 5,  "type",       "count");
    delete rev._top_products_acc;
    delete rev._ad_types_acc;

    bucket.top_events         = arvMaterializeTopN(bucket._top_events_acc      || {}, 20, "event_name",  "count");
    bucket.top_screens        = arvMaterializeTopN(bucket._top_screens_acc     || {}, 20, "screen_name", "views");
    bucket.platform_breakdown = arvMaterializeTopN(bucket._platform_acc        || {}, 10, "platform",    "events");
    bucket.audience           = arvMaterializeAudience(bucket._audience_acc    || arvEmptyAudience());
    delete bucket._top_events_acc;
    delete bucket._top_screens_acc;
    delete bucket._platform_acc;
    delete bucket._audience_acc;

    bucket.computed_at = new Date().toISOString();
    bucket.dau_estimated = true;       // sum-of-daily-DAU is an upper bound across cross-day uniques
    return bucket;
}

// Long-tail buckets serialize accumulators back from the persisted form
// when we need to fold MORE days into them later. Mirror image of arvFinalize.
function arvRehydrate(bucket) {
    if (!bucket) return arvEmptyBucket();
    if (!bucket.revenue) bucket.revenue = arvEmptyBucket().revenue;
    bucket.revenue._top_products_acc = bucket.revenue._top_products_acc || {};
    bucket.revenue._ad_types_acc     = bucket.revenue._ad_types_acc     || {};
    if (bucket.revenue.top_products) {
        for (var ti = 0; ti < bucket.revenue.top_products.length; ti++) {
            var tp = bucket.revenue.top_products[ti];
            bucket.revenue._top_products_acc[tp.product_id] =
                (bucket.revenue._top_products_acc[tp.product_id] || 0) + (tp.purchases || 0);
        }
    }
    if (bucket.revenue.ad_types) {
        for (var ai = 0; ai < bucket.revenue.ad_types.length; ai++) {
            var at = bucket.revenue.ad_types[ai];
            bucket.revenue._ad_types_acc[at.type] =
                (bucket.revenue._ad_types_acc[at.type] || 0) + (at.count || 0);
        }
    }
    bucket._top_events_acc  = {};
    bucket._top_screens_acc = {};
    bucket._platform_acc    = {};
    bucket._audience_acc    = arvEmptyAudience();
    arvFoldTopN(bucket._top_events_acc,  bucket.top_events,         "event_name",  "count");
    arvFoldTopN(bucket._top_screens_acc, bucket.top_screens,        "screen_name", "views");
    arvFoldTopN(bucket._platform_acc,    bucket.platform_breakdown, "platform",    "events");
    if (bucket.audience) {
        for (var dim in bucket._audience_acc) {
            if (!bucket._audience_acc.hasOwnProperty(dim)) continue;
            if (!bucket.audience[dim]) continue;
            for (var ri = 0; ri < bucket.audience[dim].length; ri++) {
                var rrow = bucket.audience[dim][ri];
                bucket._audience_acc[dim][rrow.value] = {
                    events: rrow.events || 0,
                    unique_users: rrow.unique_users || 0
                };
            }
        }
    }
    return bucket;
}

// ─── Tier compute: monthly / yearly / lifetime from daily ─────

// Recompute one monthly bucket by reading every daily rollup whose date
// falls in YYYY-MM. Cheap because daily rollups are small (~3 KB each)
// and storage reads are batched.
function arvComputeMonthly(nk, gameId, ymStr) {
    gameId = arvResolveGameId(gameId);
    var bucket = arvEmptyBucket();
    bucket.gameId = gameId || "all";

    // Iterate every day in YYYY-MM. Calendar arithmetic in JS — accept a
    // few wasted reads for the days that don't exist (e.g. Feb 30/31).
    for (var d = 1; d <= 31; d++) {
        var dStr = (d < 10 ? "0" : "") + d;
        var dateStr = ymStr + "-" + dStr;
        if (!arvValidDateStr(dateStr)) continue;
        // Skip out-of-month dates (JS Date will roll over March)
        var probe = new Date(dateStr + "T00:00:00Z");
        if (probe.getUTCMonth() + 1 !== parseInt(ymStr.slice(5, 7), 10)) continue;
        var daily = arvReadOne(nk, ARV_ROLLUP_DAILY_COLLECTION,
                               "rollup_" + (gameId || "all") + "_" + dateStr);
        if (!daily) continue;
        arvFoldInto(bucket, daily);
    }
    return arvFinalize(bucket);
}

// Recompute yearly by folding 12 monthly buckets. Each monthly is already
// finalized so we pass each through arvRehydrate to re-extract accumulators.
function arvComputeYearly(nk, gameId, yyyyStr) {
    gameId = arvResolveGameId(gameId);
    var bucket = arvEmptyBucket();
    bucket.gameId = gameId || "all";
    for (var m = 1; m <= 12; m++) {
        var mStr = (m < 10 ? "0" : "") + m;
        var ymStr = yyyyStr + "-" + mStr;
        var monthly = arvReadOne(nk, ARV_MONTHLY_COLLECTION,
                                 "monthly_" + (gameId || "all") + "_" + ymStr);
        if (!monthly) continue;
        arvFoldInto(bucket, arvRehydrate(monthly));
    }
    return arvFinalize(bucket);
}

// Lifetime: fold every yearly bucket. Loops back to the project's first year
// (read from the existing lifetime doc if present, else scans yearly collection).
function arvComputeLifetime(nk, gameId) {
    gameId = arvResolveGameId(gameId);
    var resolved = gameId || "all";
    var bucket = arvEmptyBucket();
    bucket.gameId = resolved;

    // List all yearly buckets for this gameId. cursor-paginated to stay
    // safe even when every game project has its own yearly rollup.
    try {
        var cursor = null;
        var pages = 0;
        while (pages < 5) {  // 5*100 = 500 yearly docs cap, way more than we'll ever have
            var page = nk.storageList(ARV_SYSTEM_USER, ARV_YEARLY_COLLECTION, 100, cursor);
            if (!page || !page.objects || page.objects.length === 0) break;
            for (var i = 0; i < page.objects.length; i++) {
                var obj = page.objects[i];
                var key = obj.key || "";
                // Key shape: yearly_<gameId>_<YYYY>
                if (key.indexOf("yearly_" + resolved + "_") !== 0) continue;
                arvFoldInto(bucket, arvRehydrate(obj.value || {}));
            }
            pages++;
            if (!page.cursor) break;
            cursor = page.cursor;
        }
    } catch (e) { /* swallow — best-effort */ }

    return arvFinalize(bucket);
}

// ─── Incremental hook: bump tiers when a daily rollup writes ───

// Called from rpcAnalyticsRollupRun (analytics_rollup.js) at the end of
// each daily run. Recomputes the affected monthly bucket (which then
// triggers a yearly + lifetime refresh). Cheap because monthly is at
// most 31 small reads.
function arvBumpForDate(nk, logger, gameId, dateStr) {
    if (!arvValidDateStr(dateStr)) return;
    gameId = arvResolveGameId(gameId) || "all";
    try {
        var ymStr   = arvYearMonth(dateStr);
        var yyyyStr = arvYear(dateStr);

        var monthly = arvComputeMonthly(nk, gameId, ymStr);
        arvWriteOne(nk, ARV_MONTHLY_COLLECTION, "monthly_" + gameId + "_" + ymStr, monthly);

        var yearly = arvComputeYearly(nk, gameId, yyyyStr);
        arvWriteOne(nk, ARV_YEARLY_COLLECTION, "yearly_" + gameId + "_" + yyyyStr, yearly);

        var lifetime = arvComputeLifetime(nk, gameId);
        arvWriteOne(nk, ARV_LIFETIME_COLLECTION, "totals_" + gameId, lifetime);

        // Status meta — useful for the dashboard's "last updated" label.
        arvWriteOne(nk, ARV_HISTORY_META_COLLECTION, "last_bump", {
            gameId: gameId,
            date: dateStr,
            month: ymStr,
            year: yyyyStr,
            updated_at: new Date().toISOString()
        });
    } catch (e) {
        if (logger && logger.warn) logger.warn("[analytics_history] bump failed " + gameId + "/" + dateStr + ": " + (e.message || e));
    }
}

// ─── RPC: monthly read ────────────────────────────────────

// Read N most-recent monthly buckets, ascending date order. Default 12 months.
function rpcAnalyticsHistoryMonthlyRead(ctx, logger, nk, payload) {
    var data = arvParse(payload);
    var gate = arvRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arvErr(gate.reason, 401);

    var months = parseInt(data.months, 10) || 12;
    if (months < 1) months = 1;
    if (months > ARV_MAX_MONTHS) months = ARV_MAX_MONTHS;
    var gameId = arvResolveGameId(data.game_id || data.gameId || "all");

    var out = [];
    var now = new Date();
    for (var m = months - 1; m >= 0; m--) {
        var probe = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
        var ymStr = probe.toISOString().slice(0, 7);
        var doc = arvReadOne(nk, ARV_MONTHLY_COLLECTION, "monthly_" + gameId + "_" + ymStr);
        out.push({
            month: ymStr,
            doc: doc || null,
            missing: !doc
        });
    }

    return arvOk({
        game_id: gameId,
        months_requested: months,
        months_found: out.filter(function (x) { return !x.missing; }).length,
        series: out
    });
}

// ─── RPC: yearly read ─────────────────────────────────────

function rpcAnalyticsHistoryYearlyRead(ctx, logger, nk, payload) {
    var data = arvParse(payload);
    var gate = arvRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arvErr(gate.reason, 401);

    var years = parseInt(data.years, 10) || ARV_MAX_YEARS;
    if (years < 1) years = 1;
    if (years > ARV_MAX_YEARS) years = ARV_MAX_YEARS;
    var gameId = arvResolveGameId(data.game_id || data.gameId || "all");

    var out = [];
    var thisYear = new Date().getUTCFullYear();
    for (var y = years - 1; y >= 0; y--) {
        var yyyyStr = String(thisYear - y);
        var doc = arvReadOne(nk, ARV_YEARLY_COLLECTION, "yearly_" + gameId + "_" + yyyyStr);
        out.push({
            year: yyyyStr,
            doc: doc || null,
            missing: !doc
        });
    }

    return arvOk({
        game_id: gameId,
        years_requested: years,
        years_found: out.filter(function (x) { return !x.missing; }).length,
        series: out
    });
}

// ─── RPC: lifetime read ───────────────────────────────────

function rpcAnalyticsHistoryLifetimeRead(ctx, logger, nk, payload) {
    var data = arvParse(payload);
    var gate = arvRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arvErr(gate.reason, 401);

    var gameId = arvResolveGameId(data.game_id || data.gameId || "all");
    var doc = arvReadOne(nk, ARV_LIFETIME_COLLECTION, "totals_" + gameId);
    if (!doc) {
        return arvOk({
            game_id: gameId,
            doc: null,
            missing: true,
            hint: "No lifetime totals computed yet. Trigger analytics_history_recompute or wait for the next analytics_rollup_run."
        });
    }

    // Authoritative new-user total: count first_seen registry docs, not the
    // folded rollup sum (which only covers days_folded and can lag behind).
    var firstSeenTotal = arvCountFirstSeenUsers(nk, gameId);
    var rollupNewUsers = doc.new_users || 0;
    doc.new_users_rollup_sum = rollupNewUsers;
    doc.new_users_first_seen = firstSeenTotal;
    doc.new_users = firstSeenTotal;
    doc.new_users_source = "first_seen";

    return arvOk({
        game_id: gameId,
        doc: doc,
        new_users_first_seen: firstSeenTotal,
        new_users_rollup_sum: rollupNewUsers
    });
}

// ─── RPC: archive browser (raw event reader, unbounded date range) ──

// Reads analytics_events directly, paginated. Handles unbounded date
// ranges (the dashboard's existing dashboard_events_timeline RPC caps at
// 90 days; this one accepts any from_date/to_date). Cursor-based so a
// 10-million-event project still pages through cleanly.
//
// Filters: from_date, to_date (YYYY-MM-DD, both optional), user_id,
// event_name, game_id. Returns:
//   { events:[...], count, scanned, has_more, next_cursor }
function rpcAnalyticsHistoryBrowse(ctx, logger, nk, payload) {
    var data = arvParse(payload);
    var gate = arvRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arvErr(gate.reason, 401);

    var limit = parseInt(data.limit, 10) || ARV_BROWSE_DEFAULT_LIMIT;
    if (limit < 1) limit = 1;
    if (limit > ARV_BROWSE_MAX_LIMIT) limit = ARV_BROWSE_MAX_LIMIT;

    var fromUnix = 0, toUnix = Math.floor(Date.now() / 1000) + 86400;
    if (data.from_date) {
        if (!arvValidDateStr(data.from_date)) return arvErr("from_date must be YYYY-MM-DD", 400);
        fromUnix = Math.floor(new Date(data.from_date + "T00:00:00.000Z").getTime() / 1000);
    }
    if (data.to_date) {
        if (!arvValidDateStr(data.to_date)) return arvErr("to_date must be YYYY-MM-DD", 400);
        toUnix = Math.floor(new Date(data.to_date + "T23:59:59.999Z").getTime() / 1000);
    }
    var gameIdFilter = data.game_id || data.gameId || null;
    if (gameIdFilter === "all") gameIdFilter = null;
    if (gameIdFilter) gameIdFilter = arvResolveGameId(gameIdFilter);
    var userIdFilter    = data.user_id    || data.userId    || null;
    var eventNameFilter = data.event_name || data.eventName || null;

    var collected = [];
    var scanned = 0;
    var cursor = data.cursor || null;
    var hasMore = false;

    try {
        while (collected.length < limit && scanned < ARV_BROWSE_MAX_SCAN) {
            var page = nk.storageList(ARV_SYSTEM_USER, ARV_EVENTS_COLLECTION, 200, cursor);
            if (!page || !page.objects || page.objects.length === 0) break;

            for (var i = 0; i < page.objects.length; i++) {
                scanned++;
                var obj = page.objects[i];
                var ev = obj.value || {};
                var evUnix = ev.unixTimestamp;
                if (!evUnix && ev.timestamp) {
                    evUnix = Math.floor(new Date(ev.timestamp).getTime() / 1000);
                }
                if (evUnix && (evUnix < fromUnix || evUnix > toUnix)) continue;
                if (gameIdFilter   && ev.gameId    && arvResolveGameId(ev.gameId) !== gameIdFilter) continue;
                if (eventNameFilter && ev.eventName !== eventNameFilter) continue;
                if (userIdFilter   && ev.userId !== userIdFilter) continue;

                collected.push({
                    key: obj.key,
                    user_id: ev.userId || "",
                    game_id: ev.gameId || "",
                    event_name: ev.eventName || "",
                    timestamp: ev.timestamp || null,
                    unix_timestamp: evUnix || null,
                    properties: ev.eventData || {}
                });
                if (collected.length >= limit) break;
            }

            if (!page.cursor) { cursor = null; break; }
            cursor = page.cursor;
        }
        hasMore = collected.length >= limit && !!cursor;
    } catch (e) {
        if (logger && logger.error) logger.error("[analytics_history] browse scan failed: " + e.message);
        return arvErr("Scan failed: " + e.message, 500);
    }

    collected.sort(function (a, b) { return (b.unix_timestamp || 0) - (a.unix_timestamp || 0); });

    return arvOk({
        events: collected,
        count: collected.length,
        scanned: scanned,
        has_more: hasMore,
        next_cursor: cursor || null,
        filters: {
            from_date: data.from_date || null,
            to_date: data.to_date || null,
            game_id: gameIdFilter,
            user_id: userIdFilter,
            event_name: eventNameFilter,
            limit: limit
        }
    });
}

// ─── RPC: full recompute (one-shot operator backfill) ────

// Walks every monthly that touches the requested year range, recomputes
// it from daily, then recomputes yearly + lifetime. Use this once after
// deploy to populate monthly/yearly/lifetime from the existing daily
// rollups. After the first run, the auto-bump in rpcAnalyticsRollupRun
// keeps everything fresh — no need to call this again unless a daily
// rollup is manually edited.
//
// Payload: {game_id?, from_year?, to_year?, dashboard_secret?}
// Defaults: game_id="all", from_year=current year - 4, to_year=current.
function rpcAnalyticsHistoryRecompute(ctx, logger, nk, payload) {
    var data = arvParse(payload);
    var gate = arvRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arvErr(gate.reason, 401);

    var gameId = arvResolveGameId(data.game_id || data.gameId || "all");
    var thisYear = new Date().getUTCFullYear();
    var fromYear = parseInt(data.from_year, 10) || (thisYear - 4);
    var toYear   = parseInt(data.to_year, 10)   || thisYear;
    if (fromYear > toYear) { var t = fromYear; fromYear = toYear; toYear = t; }
    if (toYear - fromYear > 9) return arvErr("Recompute range too large (max 10 years)", 400);

    var monthsWritten = 0;
    var yearsWritten = 0;

    for (var y = fromYear; y <= toYear; y++) {
        for (var m = 1; m <= 12; m++) {
            var ymStr = String(y) + "-" + (m < 10 ? "0" : "") + m;
            var monthly = arvComputeMonthly(nk, gameId, ymStr);
            // Skip empty months (no daily rollups touched) — saves a write
            // and keeps the monthly collection clean.
            if (monthly.days_folded > 0) {
                arvWriteOne(nk, ARV_MONTHLY_COLLECTION, "monthly_" + gameId + "_" + ymStr, monthly);
                monthsWritten++;
            }
        }
        var yearly = arvComputeYearly(nk, gameId, String(y));
        if (yearly.days_folded > 0) {
            arvWriteOne(nk, ARV_YEARLY_COLLECTION, "yearly_" + gameId + "_" + String(y), yearly);
            yearsWritten++;
        }
    }

    var lifetime = arvComputeLifetime(nk, gameId);
    arvWriteOne(nk, ARV_LIFETIME_COLLECTION, "totals_" + gameId, lifetime);

    arvWriteOne(nk, ARV_HISTORY_META_COLLECTION, "last_recompute", {
        gameId: gameId,
        from_year: fromYear,
        to_year: toYear,
        months_written: monthsWritten,
        years_written: yearsWritten,
        completed_at: new Date().toISOString(),
        bypass: gate.bypass
    });

    if (logger && logger.info) {
        logger.info("[analytics_history] recompute " + gameId + " " + fromYear + "-" + toYear +
                    " months=" + monthsWritten + " years=" + yearsWritten);
    }

    return arvOk({
        game_id: gameId,
        from_year: fromYear,
        to_year: toYear,
        months_written: monthsWritten,
        years_written: yearsWritten,
        lifetime: {
            range_start: lifetime.range_start,
            range_end: lifetime.range_end,
            days_folded: lifetime.days_folded,
            event_count: lifetime.event_count,
            new_users: lifetime.new_users,
            revenue_usd: (lifetime.revenue || {}).usd || 0
        }
    });
}

// ─── RPC: status ──────────────────────────────────────────

function rpcAnalyticsHistoryStatus(ctx, logger, nk, payload) {
    var data = arvParse(payload);
    var gate = arvRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return arvErr(gate.reason, 401);

    var lastBump      = arvReadOne(nk, ARV_HISTORY_META_COLLECTION, "last_bump");
    var lastRecompute = arvReadOne(nk, ARV_HISTORY_META_COLLECTION, "last_recompute");
    var lifetime      = arvReadOne(nk, ARV_LIFETIME_COLLECTION,     "totals_all");

    return arvOk({
        last_bump: lastBump,
        last_recompute: lastRecompute,
        platform_lifetime: lifetime
            ? {
                range_start: lifetime.range_start,
                range_end:   lifetime.range_end,
                days_folded: lifetime.days_folded,
                event_count: lifetime.event_count,
                new_users:   lifetime.new_users,
                revenue_usd: (lifetime.revenue || {}).usd || 0,
                ad_revenue_usd: (lifetime.revenue || {}).ad_revenue_usd || 0,
                computed_at: lifetime.computed_at
            }
            : null,
        config: {
            collections: {
                monthly:  ARV_MONTHLY_COLLECTION,
                yearly:   ARV_YEARLY_COLLECTION,
                lifetime: ARV_LIFETIME_COLLECTION
            },
            limits: {
                max_months: ARV_MAX_MONTHS,
                max_years:  ARV_MAX_YEARS,
                browse_max_limit: ARV_BROWSE_MAX_LIMIT,
                browse_max_scan:  ARV_BROWSE_MAX_SCAN
            }
        }
    });
}

// ─── Registration ─────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_history_monthly_read",  rpcAnalyticsHistoryMonthlyRead);
    initializer.registerRpc("analytics_history_yearly_read",   rpcAnalyticsHistoryYearlyRead);
    initializer.registerRpc("analytics_history_lifetime_read", rpcAnalyticsHistoryLifetimeRead);
    initializer.registerRpc("analytics_history_browse",        rpcAnalyticsHistoryBrowse);
    initializer.registerRpc("analytics_history_recompute",     rpcAnalyticsHistoryRecompute);
    initializer.registerRpc("analytics_history_status",        rpcAnalyticsHistoryStatus);
    if (logger && logger.info) {
        logger.info("[analytics_history] Module registered: 6 RPCs " +
            "(monthly_read, yearly_read, lifetime_read, browse, recompute, status)");
    }
}
