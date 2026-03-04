// game_metrics.js — Universal game metrics capture, query, and aggregation
//
// Collections:
//   game_metrics_{gameId}  — per-user match/session results (user-owned)
//   game_metrics_index     — game-wide metric summaries (system-owned)
//
// Works for ANY game (cricket, quiz, survival, etc.) with a flexible schema.

var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

// ============================================================================
// HELPERS
// ============================================================================

function gmDateStr() {
    return new Date().toISOString().slice(0, 10);
}

function gmNow() {
    return new Date().toISOString();
}

function gmUnix() {
    return Math.floor(Date.now() / 1000);
}

function gmSafeRead(nk, collection, key, userId) {
    try {
        var r = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
        if (r && r.length > 0 && r[0].value) return r[0].value;
    } catch (e) { /* ignore */ }
    return null;
}

function gmSafeWrite(nk, collection, key, userId, value) {
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: value,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (e) {
        return false;
    }
}

function gmSafeList(nk, userId, collection, limit, cursor) {
    try {
        return nk.storageList(userId, collection, limit, cursor);
    } catch (e) {
        return { objects: [], cursor: "" };
    }
}

function gmMedian(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function gmPercentile(arr, p) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var idx = Math.ceil((p / 100) * s.length) - 1;
    return s[Math.max(0, idx)];
}

function gmRound(n, d) {
    var f = Math.pow(10, d || 2);
    return Math.round(n * f) / f;
}

// ============================================================================
// RPC: game_metrics_submit
// ============================================================================

function rpcGameMetricsSubmit(ctx, logger, nk, payload) {
    logger.info("[GameMetrics] RPC game_metrics_submit called");

    try {
        var data = JSON.parse(payload || "{}");
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }

    var gameId = data.game_id;
    if (!gameId) {
        return JSON.stringify({ success: false, error: "Missing required field: game_id" });
    }

    var userId = ctx.userId;
    if (!userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }

    var metricType = data.metric_type || "match_result";
    var metrics = data.metrics || {};
    var tags = data.tags || {};
    var ts = gmNow();
    var unix = gmUnix();

    // Build the record
    var record = {
        game_id: gameId,
        user_id: userId,
        metric_type: metricType,
        metrics: metrics,
        tags: tags,
        date: gmDateStr(),
        timestamp: ts,
        unix_ts: unix
    };

    // Store with unique key
    var collection = "game_metrics_" + gameId;
    var key = metricType + "_" + userId + "_" + unix;
    gmSafeWrite(nk, collection, key, userId, record);

    // Update the per-game summary index for aggregation
    try {
        var indexKey = "summary_" + gameId;
        var summary = gmSafeRead(nk, "game_metrics_index", indexKey, SYSTEM_USER) || {
            game_id: gameId,
            total_submissions: 0,
            unique_users: [],
            metric_types: {},
            last_updated: ts
        };

        summary.total_submissions += 1;
        if (summary.unique_users.indexOf(userId) === -1) {
            summary.unique_users.push(userId);
        }

        if (!summary.metric_types[metricType]) {
            summary.metric_types[metricType] = { count: 0, last_seen: ts };
        }
        summary.metric_types[metricType].count += 1;
        summary.metric_types[metricType].last_seen = ts;
        summary.last_updated = ts;

        // Keep running stats for numeric metric fields
        if (!summary.numeric_stats) summary.numeric_stats = {};
        for (var field in metrics) {
            if (typeof metrics[field] === "number") {
                if (!summary.numeric_stats[field]) {
                    summary.numeric_stats[field] = {
                        count: 0, sum: 0, min: metrics[field], max: metrics[field]
                    };
                }
                var stat = summary.numeric_stats[field];
                stat.count += 1;
                stat.sum += metrics[field];
                if (metrics[field] < stat.min) stat.min = metrics[field];
                if (metrics[field] > stat.max) stat.max = metrics[field];
                stat.avg = gmRound(stat.sum / stat.count);
            }
        }

        gmSafeWrite(nk, "game_metrics_index", indexKey, SYSTEM_USER, summary);
    } catch (indexErr) {
        logger.warn("[GameMetrics] Failed to update index: " + indexErr.message);
    }

    logger.info("[GameMetrics] Submitted " + metricType + " for user " + userId + " in game " + gameId);

    return JSON.stringify({
        success: true,
        game_id: gameId,
        metric_type: metricType,
        record_key: key,
        timestamp: ts
    });
}

// ============================================================================
// RPC: game_metrics_query
// ============================================================================

function rpcGameMetricsQuery(ctx, logger, nk, payload) {
    logger.info("[GameMetrics] RPC game_metrics_query called");

    try {
        var data = JSON.parse(payload || "{}");
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }

    var gameId = data.game_id;
    if (!gameId) {
        return JSON.stringify({ success: false, error: "Missing required field: game_id" });
    }

    var userId = data.user_id || (ctx.userId || null);
    if (!userId) {
        return JSON.stringify({ success: false, error: "Missing user_id (or authenticate)" });
    }

    var metricType = data.metric_type || null;
    var limit = data.limit || 50;
    var cursor = data.cursor || null;

    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;

    var collection = "game_metrics_" + gameId;
    var result = gmSafeList(nk, userId, collection, limit, cursor);

    var records = [];
    if (result && result.objects) {
        for (var i = 0; i < result.objects.length; i++) {
            var obj = result.objects[i];
            var val = obj.value || {};

            // Filter by metric_type if specified
            if (metricType && val.metric_type !== metricType) {
                continue;
            }

            records.push({
                key: obj.key,
                metric_type: val.metric_type,
                metrics: val.metrics,
                tags: val.tags,
                date: val.date,
                timestamp: val.timestamp
            });
        }
    }

    return JSON.stringify({
        success: true,
        game_id: gameId,
        user_id: userId,
        records: records,
        count: records.length,
        cursor: (result && result.cursor) ? result.cursor : null,
        filter: metricType ? { metric_type: metricType } : null
    });
}

// ============================================================================
// RPC: game_metrics_aggregate
// ============================================================================

function rpcGameMetricsAggregate(ctx, logger, nk, payload) {
    logger.info("[GameMetrics] RPC game_metrics_aggregate called");

    try {
        var data = JSON.parse(payload || "{}");
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }

    var gameId = data.game_id;
    if (!gameId) {
        return JSON.stringify({ success: false, error: "Missing required field: game_id" });
    }

    var metricType = data.metric_type || null;
    var fields = data.fields || [];
    var sampleSize = data.sample_size || 50;
    if (sampleSize > 200) sampleSize = 200;

    // Read the game summary index for quick stats
    var indexKey = "summary_" + gameId;
    var summary = gmSafeRead(nk, "game_metrics_index", indexKey, SYSTEM_USER);

    if (!summary) {
        return JSON.stringify({
            success: true,
            game_id: gameId,
            message: "No metrics data found for this game",
            summary: null,
            field_stats: {},
            sample_size: 0
        });
    }

    // If fields are requested, sample actual records for detailed aggregation
    var fieldStats = {};
    var sampled = 0;

    if (fields.length > 0 && summary.unique_users && summary.unique_users.length > 0) {
        var fieldValues = {};
        for (var fi = 0; fi < fields.length; fi++) {
            fieldValues[fields[fi]] = [];
        }

        var collection = "game_metrics_" + gameId;
        var usersToSample = summary.unique_users.slice(0, Math.min(20, summary.unique_users.length));

        for (var ui = 0; ui < usersToSample.length && sampled < sampleSize; ui++) {
            var userRecords = gmSafeList(nk, usersToSample[ui], collection, 20, null);
            if (userRecords && userRecords.objects) {
                for (var ri = 0; ri < userRecords.objects.length && sampled < sampleSize; ri++) {
                    var rec = userRecords.objects[ri].value;
                    if (!rec || !rec.metrics) continue;
                    if (metricType && rec.metric_type !== metricType) continue;

                    for (var fj = 0; fj < fields.length; fj++) {
                        var fname = fields[fj];
                        if (rec.metrics[fname] !== undefined && typeof rec.metrics[fname] === "number") {
                            fieldValues[fname].push(rec.metrics[fname]);
                        }
                    }
                    sampled++;
                }
            }
        }

        // Compute stats per field
        for (var fk = 0; fk < fields.length; fk++) {
            var fname2 = fields[fk];
            var vals = fieldValues[fname2];
            if (vals.length > 0) {
                var sum = 0;
                var min = vals[0];
                var max = vals[0];
                for (var vi = 0; vi < vals.length; vi++) {
                    sum += vals[vi];
                    if (vals[vi] < min) min = vals[vi];
                    if (vals[vi] > max) max = vals[vi];
                }
                fieldStats[fname2] = {
                    count: vals.length,
                    sum: gmRound(sum),
                    avg: gmRound(sum / vals.length),
                    min: gmRound(min),
                    max: gmRound(max),
                    median: gmRound(gmMedian(vals)),
                    p95: gmRound(gmPercentile(vals, 95)),
                    distribution: {
                        below_avg: vals.filter(function (v) { return v < (sum / vals.length); }).length,
                        above_avg: vals.filter(function (v) { return v >= (sum / vals.length); }).length
                    }
                };
            } else {
                fieldStats[fname2] = { count: 0, message: "No data for this field" };
            }
        }
    } else if (summary.numeric_stats) {
        // Use the running stats from the index
        fieldStats = summary.numeric_stats;
    }

    // Build metric type breakdown
    var typeBreakdown = [];
    if (summary.metric_types) {
        for (var mt in summary.metric_types) {
            typeBreakdown.push({
                metric_type: mt,
                count: summary.metric_types[mt].count,
                last_seen: summary.metric_types[mt].last_seen
            });
        }
        typeBreakdown.sort(function (a, b) { return b.count - a.count; });
    }

    return JSON.stringify({
        success: true,
        game_id: gameId,
        summary: {
            total_submissions: summary.total_submissions,
            unique_players: summary.unique_users ? summary.unique_users.length : 0,
            metric_types: typeBreakdown,
            last_updated: summary.last_updated
        },
        field_stats: fieldStats,
        sample_size: sampled,
        filter: metricType ? { metric_type: metricType } : null
    });
}
