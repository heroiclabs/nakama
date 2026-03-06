// analytics_v2.js - Advanced Analytics RPCs for Nakama
// Self-contained, ES5 compatible, no imports/exports

var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function analyticsNowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function analyticsDateString(date) {
  var d = date || new Date();
  return d.getUTCFullYear() + "-" +
    ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" +
    ("0" + d.getUTCDate()).slice(-2);
}

function analyticsDaysAgo(n) {
  var d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return analyticsDateString(d);
}

function analyticsDateFromString(str) {
  var parts = str.split("-");
  return new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
}

function analyticsDaysBetween(dateStrA, dateStrB) {
  var a = analyticsDateFromString(dateStrA);
  var b = analyticsDateFromString(dateStrB);
  return Math.round(Math.abs(b - a) / 86400000);
}

function analyticsSafeRead(nk, collection, key, userId) {
  try {
    var recs = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
    if (recs && recs.length > 0) return recs[0].value;
  } catch (_) { /* swallow */ }
  return null;
}

function analyticsSafeWrite(nk, collection, key, userId, value) {
  nk.storageWrite([{
    collection: collection,
    key: key,
    userId: userId,
    value: value,
    permissionRead: 1,
    permissionWrite: 0
  }]);
}

function analyticsSafeList(nk, userId, collection, limit, cursor) {
  try {
    return nk.storageList(userId, collection, limit, cursor);
  } catch (_) { /* swallow */ }
  return { objects: [], cursor: "" };
}

function analyticsSafeJsonParse(payload) {
  if (!payload || payload === "") return {};
  try {
    return JSON.parse(payload);
  } catch (_) {
    return {};
  }
}

function analyticsUniqueArray(arr) {
  var seen = {};
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    if (!seen[arr[i]]) {
      seen[arr[i]] = true;
      out.push(arr[i]);
    }
  }
  return out;
}

function analyticsMedian(sorted) {
  if (sorted.length === 0) return 0;
  var mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function analyticsPercentile(sorted, p) {
  if (sorted.length === 0) return 0;
  var idx = Math.ceil(p / 100 * sorted.length) - 1;
  if (idx < 0) idx = 0;
  if (idx >= sorted.length) idx = sorted.length - 1;
  return sorted[idx];
}

function analyticsGini(values) {
  if (values.length === 0) return 0;
  var sorted = values.slice().sort(function (a, b) { return a - b; });
  var n = sorted.length;
  var sum = 0;
  var weightedSum = 0;
  for (var i = 0; i < n; i++) {
    sum += sorted[i];
    weightedSum += (i + 1) * sorted[i];
  }
  if (sum === 0) return 0;
  return (2 * weightedSum) / (n * sum) - (n + 1) / n;
}

function analyticsRound(val, decimals) {
  var factor = Math.pow(10, decimals || 2);
  return Math.round(val * factor) / factor;
}

// Read DAU record for a specific game + date
function readDauRecord(nk, gameId, dateStr) {
  var key = "dau_" + gameId + "_" + dateStr;
  return analyticsSafeRead(nk, "analytics_dau", key, SYSTEM_USER);
}

// Collect unique users from DAU records across a date range for a game
function collectDauUsers(nk, gameId, days) {
  var users = [];
  for (var i = 0; i < days; i++) {
    var dateStr = analyticsDaysAgo(i);
    var rec = readDauRecord(nk, gameId, dateStr);
    if (rec && rec.users) {
      for (var j = 0; j < rec.users.length; j++) {
        users.push(rec.users[j]);
      }
    }
  }
  return users;
}

// Discover game IDs from recent DAU entries by scanning system storage
function discoverGameIds(nk, days) {
  var gameIds = {};
  var result = analyticsSafeList(nk, SYSTEM_USER, "analytics_dau", 100, "");
  if (result && result.objects) {
    for (var i = 0; i < result.objects.length; i++) {
      var val = result.objects[i].value;
      if (val && val.gameId) {
        gameIds[val.gameId] = true;
      }
    }
  }
  var out = [];
  for (var gid in gameIds) {
    if (gameIds.hasOwnProperty(gid)) {
      out.push(gid);
    }
  }
  return out;
}

// Sample user IDs from DAU or first_session storage
function sampleUserIds(nk, limit) {
  var userIds = [];
  var seen = {};
  var result = analyticsSafeList(nk, null, "first_session", limit || 100, "");
  if (result && result.objects) {
    for (var i = 0; i < result.objects.length; i++) {
      var uid = result.objects[i].userId;
      if (uid && !seen[uid]) {
        seen[uid] = true;
        userIds.push(uid);
      }
    }
  }
  return userIds;
}

// ---------------------------------------------------------------------------
// 1. rpcAnalyticsDashboard
// ---------------------------------------------------------------------------

function rpcAnalyticsDashboard(ctx, logger, nk, payload) {
  try {
    var data = analyticsSafeJsonParse(payload);
    var gameIds = data.game_id ? [data.game_id] : discoverGameIds(nk, 7);
    var todayStr = analyticsDaysAgo(0);

    var dauUsersToday = [];
    var wauUsers = [];
    var mauUsers = [];
    var topGames = [];

    for (var g = 0; g < gameIds.length; g++) {
      var gid = gameIds[g];

      var todayRec = readDauRecord(nk, gid, todayStr);
      var gameDau = (todayRec && todayRec.users) ? todayRec.users.length : 0;
      topGames.push({ game_id: gid, dau: gameDau });

      var usersToday = (todayRec && todayRec.users) ? todayRec.users : [];
      for (var t = 0; t < usersToday.length; t++) dauUsersToday.push(usersToday[t]);

      var w = collectDauUsers(nk, gid, 7);
      for (var wi = 0; wi < w.length; wi++) wauUsers.push(w[wi]);

      var m = collectDauUsers(nk, gid, 30);
      for (var mi = 0; mi < m.length; mi++) mauUsers.push(m[mi]);
    }

    var dau = analyticsUniqueArray(dauUsersToday).length;
    var wau = analyticsUniqueArray(wauUsers).length;
    var mau = analyticsUniqueArray(mauUsers).length;
    var dauMauRatio = mau > 0 ? analyticsRound(dau / mau, 4) : 0;

    // Avg session duration from recent summaries
    var totalDuration = 0;
    var sessionCount = 0;
    var newUsersToday = 0;
    var returningUsersToday = 0;

    var uniqueToday = analyticsUniqueArray(dauUsersToday);
    for (var u = 0; u < uniqueToday.length; u++) {
      var uid = uniqueToday[u];
      var sessionList = analyticsSafeList(nk, uid, "analytics_session_summaries", 10, "");
      if (sessionList && sessionList.objects) {
        for (var s = 0; s < sessionList.objects.length; s++) {
          var sess = sessionList.objects[s].value;
          if (sess && sess.duration) {
            totalDuration += sess.duration;
            sessionCount++;
          }
        }
      }
      var firstSess = analyticsSafeRead(nk, "first_session", "session_data", uid);
      if (firstSess) {
        var firstDate = new Date(firstSess.firstSessionAt);
        if (analyticsDateString(firstDate) === todayStr) {
          newUsersToday++;
        } else {
          returningUsersToday++;
        }
      } else {
        newUsersToday++;
      }
    }
    var avgSessionDuration = sessionCount > 0 ? analyticsRound(totalDuration / sessionCount, 1) : 0;

    // 7-day DAU trend
    var dau7dAgo = 0;
    for (var gt = 0; gt < gameIds.length; gt++) {
      var rec7 = readDauRecord(nk, gameIds[gt], analyticsDaysAgo(7));
      if (rec7 && rec7.users) dau7dAgo += rec7.users.length;
    }
    var dau7dChangePct = dau7dAgo > 0 ? analyticsRound(((dau - dau7dAgo) / dau7dAgo) * 100, 1) : 0;

    topGames.sort(function (a, b) { return b.dau - a.dau; });

    return JSON.stringify({
      dau: dau,
      wau: wau,
      mau: mau,
      dau_mau_ratio: dauMauRatio,
      avg_session_duration_seconds: avgSessionDuration,
      new_users_today: newUsersToday,
      returning_users_today: returningUsersToday,
      top_games: topGames,
      period: "today",
      trends: { dau_7d_change_pct: dau7dChangePct }
    });
  } catch (e) {
    logger.error("rpcAnalyticsDashboard error: %s", e.message || e);
    return JSON.stringify({ error: e.message || "Internal error" });
  }
}

// ---------------------------------------------------------------------------
// 2. rpcAnalyticsRetentionCohort
// ---------------------------------------------------------------------------

function rpcAnalyticsRetentionCohort(ctx, logger, nk, payload) {
  try {
    var data = analyticsSafeJsonParse(payload);
    var cohortDate = data.cohort_date || analyticsDaysAgo(1);
    var gameId = data.game_id;
    var gameIds = gameId ? [gameId] : discoverGameIds(nk, 30);

    var cohortStart = analyticsDateFromString(cohortDate).getTime();
    var cohortEnd = cohortStart + 86400000;

    // Find users whose first session falls on cohortDate
    var cohortUsers = [];
    var allUsers = sampleUserIds(nk, 100);
    for (var i = 0; i < allUsers.length; i++) {
      var fs = analyticsSafeRead(nk, "first_session", "session_data", allUsers[i]);
      if (fs && fs.firstSessionAt >= cohortStart && fs.firstSessionAt < cohortEnd) {
        cohortUsers.push(allUsers[i]);
      }
    }

    var checkDays = [1, 3, 7, 14, 30];
    var rawCounts = { d1: 0, d3: 0, d7: 0, d14: 0, d30: 0 };

    for (var ci = 0; ci < cohortUsers.length; ci++) {
      var uid = cohortUsers[ci];
      for (var di = 0; di < checkDays.length; di++) {
        var dayOffset = checkDays[di];
        var checkDate = new Date(cohortStart + dayOffset * 86400000);
        var checkDateStr = analyticsDateString(checkDate);
        var found = false;
        for (var gi = 0; gi < gameIds.length; gi++) {
          var dauRec = readDauRecord(nk, gameIds[gi], checkDateStr);
          if (dauRec && dauRec.users && dauRec.users.indexOf(uid) !== -1) {
            found = true;
            break;
          }
        }
        if (found) {
          rawCounts["d" + dayOffset]++;
        }
      }
    }

    var cohortSize = cohortUsers.length;
    var pct = function (count) {
      return cohortSize > 0 ? analyticsRound((count / cohortSize) * 100, 1) : 0;
    };

    return JSON.stringify({
      cohort_date: cohortDate,
      cohort_size: cohortSize,
      d1_pct: pct(rawCounts.d1),
      d3_pct: pct(rawCounts.d3),
      d7_pct: pct(rawCounts.d7),
      d14_pct: pct(rawCounts.d14),
      d30_pct: pct(rawCounts.d30),
      raw_counts: rawCounts
    });
  } catch (e) {
    logger.error("rpcAnalyticsRetentionCohort error: %s", e.message || e);
    return JSON.stringify({ error: e.message || "Internal error" });
  }
}

// ---------------------------------------------------------------------------
// 3. rpcAnalyticsEngagementScore
// ---------------------------------------------------------------------------

function rpcAnalyticsEngagementScore(ctx, logger, nk, payload) {
  try {
    var data = analyticsSafeJsonParse(payload);
    var userId = data.user_id || ctx.userId;
    var gameId = data.game_id;

    if (!userId) {
      return JSON.stringify({ error: "user_id required" });
    }

    // First session data
    var firstSess = analyticsSafeRead(nk, "first_session", "session_data", userId);
    var totalSessions = (firstSess && firstSess.totalSessions) ? firstSess.totalSessions : 0;
    var firstSessionAt = (firstSess && firstSess.firstSessionAt) ? firstSess.firstSessionAt : Date.now();
    var lastActive = (firstSess && firstSess.lastSessionAt) ? new Date(firstSess.lastSessionAt).toISOString() : "";
    var daysSinceFirst = Math.floor((Date.now() - firstSessionAt) / 86400000);

    // Sessions in last 7 days: count DAU appearances
    var sessionsLast7d = 0;
    var gameIds = gameId ? [gameId] : discoverGameIds(nk, 7);
    for (var d = 0; d < 7; d++) {
      var dateStr = analyticsDaysAgo(d);
      for (var gi = 0; gi < gameIds.length; gi++) {
        var dauRec = readDauRecord(nk, gameIds[gi], dateStr);
        if (dauRec && dauRec.users && dauRec.users.indexOf(userId) !== -1) {
          sessionsLast7d++;
          break;
        }
      }
    }

    // Events in last 7 days
    var eventsLast7d = 0;
    var eventResult = analyticsSafeList(nk, userId, "analytics_events", 100, "");
    var sevenDaysAgoSec = analyticsNowSeconds() - 7 * 86400;
    if (eventResult && eventResult.objects) {
      for (var ei = 0; ei < eventResult.objects.length; ei++) {
        var evt = eventResult.objects[ei].value;
        if (evt && evt.unixTimestamp && evt.unixTimestamp >= sevenDaysAgoSec) {
          if (!gameId || evt.gameId === gameId) eventsLast7d++;
        }
      }
    }

    // Friends count
    var friendsCount = 0;
    try {
      var fr = nk.friendsList(userId, null, 100, "");
      if (fr && fr.friends) friendsCount = fr.friends.length;
    } catch (_) { /* swallow */ }

    // Wallet transactions
    var txCount = 0;
    try {
      var ledger = nk.walletLedgerList(userId, 100, "");
      if (ledger && ledger.items) txCount = ledger.items.length;
    } catch (_) { /* swallow */ }

    // Has group
    var hasGroup = false;
    try {
      var groups = nk.userGroupsList(userId, 100, null, "");
      if (groups && groups.userGroups && groups.userGroups.length > 0) hasGroup = true;
    } catch (_) { /* swallow */ }

    // Score components (0-25 each except social which is 0-25)
    var sessionFrequency = Math.min(sessionsLast7d / 7, 1) * 25;
    var actionDensity = Math.min(eventsLast7d / 50, 1) * 25;
    var socialScore = Math.min(friendsCount / 10, 1) * 20 + (hasGroup ? 5 : 0);
    var spendingScore = Math.min(txCount / 20, 1) * 25;

    var score = analyticsRound(sessionFrequency + actionDensity + socialScore + spendingScore, 1);
    if (score > 100) score = 100;

    var riskLevel = "churning";
    if (score >= 80) riskLevel = "power_user";
    else if (score >= 60) riskLevel = "engaged";
    else if (score >= 40) riskLevel = "moderate";
    else if (score >= 20) riskLevel = "at_risk";

    return JSON.stringify({
      user_id: userId,
      engagement_score: score,
      risk_level: riskLevel,
      breakdown: {
        session_frequency: analyticsRound(sessionFrequency, 1),
        action_density: analyticsRound(actionDensity, 1),
        social_score: analyticsRound(socialScore, 1),
        spending_score: analyticsRound(spendingScore, 1)
      },
      last_active: lastActive,
      days_since_first: daysSinceFirst
    });
  } catch (e) {
    logger.error("rpcAnalyticsEngagementScore error: %s", e.message || e);
    return JSON.stringify({ error: e.message || "Internal error" });
  }
}

// ---------------------------------------------------------------------------
// 4. rpcAnalyticsSessionStats
// ---------------------------------------------------------------------------

function rpcAnalyticsSessionStats(ctx, logger, nk, payload) {
  try {
    var data = analyticsSafeJsonParse(payload);
    var gameId = data.game_id;
    var days = data.days || 7;
    var cutoffSec = analyticsNowSeconds() - days * 86400;

    var durations = [];
    var dailyMap = {};
    var hourBuckets = {};
    for (var h = 0; h < 24; h++) hourBuckets[h] = 0;

    // Scan session summaries from sampled users
    var userIds = sampleUserIds(nk, 100);
    for (var u = 0; u < userIds.length; u++) {
      var result = analyticsSafeList(nk, userIds[u], "analytics_session_summaries", 50, "");
      if (!result || !result.objects) continue;
      for (var s = 0; s < result.objects.length; s++) {
        var sess = result.objects[s].value;
        if (!sess || !sess.startTime) continue;
        if (sess.startTime < cutoffSec) continue;
        if (gameId && sess.gameId !== gameId) continue;

        var dur = sess.duration || 0;
        durations.push(dur);

        var sessDate = analyticsDateString(new Date(sess.startTime * 1000));
        if (!dailyMap[sessDate]) dailyMap[sessDate] = { sessions: 0, totalDur: 0 };
        dailyMap[sessDate].sessions++;
        dailyMap[sessDate].totalDur += dur;

        var sessHour = new Date(sess.startTime * 1000).getUTCHours();
        hourBuckets[sessHour]++;
      }
    }

    durations.sort(function (a, b) { return a - b; });

    var totalSessions = durations.length;
    var sumDur = 0;
    for (var di = 0; di < durations.length; di++) sumDur += durations[di];
    var avgDur = totalSessions > 0 ? analyticsRound(sumDur / totalSessions, 1) : 0;
    var medDur = analyticsMedian(durations);
    var p95Dur = analyticsPercentile(durations, 95);

    var peakHours = [];
    for (var ph = 0; ph < 24; ph++) {
      if (hourBuckets[ph] > 0) {
        peakHours.push({ hour: ph, count: hourBuckets[ph] });
      }
    }
    peakHours.sort(function (a, b) { return b.count - a.count; });

    var dailyBreakdown = [];
    for (var dk in dailyMap) {
      if (dailyMap.hasOwnProperty(dk)) {
        var entry = dailyMap[dk];
        dailyBreakdown.push({
          date: dk,
          sessions: entry.sessions,
          avg_duration: entry.sessions > 0 ? analyticsRound(entry.totalDur / entry.sessions, 1) : 0
        });
      }
    }
    dailyBreakdown.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    var sessPerDayAvg = days > 0 ? analyticsRound(totalSessions / days, 1) : 0;

    return JSON.stringify({
      total_sessions: totalSessions,
      avg_duration_seconds: avgDur,
      median_duration_seconds: medDur,
      p95_duration_seconds: p95Dur,
      min_duration_seconds: durations.length > 0 ? durations[0] : 0,
      max_duration_seconds: durations.length > 0 ? durations[durations.length - 1] : 0,
      sessions_per_day_avg: sessPerDayAvg,
      peak_hours: peakHours.slice(0, 5),
      daily_breakdown: dailyBreakdown
    });
  } catch (e) {
    logger.error("rpcAnalyticsSessionStats error: %s", e.message || e);
    return JSON.stringify({ error: e.message || "Internal error" });
  }
}

// ---------------------------------------------------------------------------
// 5. rpcAnalyticsFunnel
// ---------------------------------------------------------------------------

function rpcAnalyticsFunnel(ctx, logger, nk, payload) {
  try {
    var data = analyticsSafeJsonParse(payload);
    var gameId = data.game_id;
    var days = data.days || 30;

    var userIds = sampleUserIds(nk, 100);
    var totalUsers = userIds.length;

    var stepDefs = [
      { name: "account_created",      check: function () { return totalUsers; } },
      { name: "onboarding_started",   check: function () { return countOnboardingStep(nk, userIds, "started"); } },
      { name: "onboarding_completed", check: function () { return countOnboardingStep(nk, userIds, "completed"); } },
      { name: "first_quiz_played",    check: function () { return countOnboardingStep(nk, userIds, "first_quiz"); } },
      { name: "second_session",       check: function () { return countSessionMilestone(nk, userIds, 2); } },
      { name: "made_purchase",        check: function () { return countEventType(nk, userIds, gameId, "purchase"); } },
      { name: "joined_group",         check: function () { return countWithGroups(nk, userIds); } },
      { name: "played_multiplayer",   check: function () { return countEventType(nk, userIds, gameId, "match_complete"); } },
      { name: "day_7_return",         check: function () { return countD7Return(nk, userIds); } }
    ];

    var steps = [];
    var worstDropOff = { step: "", drop_pct: 0 };

    for (var i = 0; i < stepDefs.length; i++) {
      var count = stepDefs[i].check();
      var pctOfTotal = totalUsers > 0 ? analyticsRound((count / totalUsers) * 100, 1) : 0;
      var prevCount = (i > 0 && steps[i - 1]) ? steps[i - 1].count : totalUsers;
      var pctOfPrev = prevCount > 0 ? analyticsRound((count / prevCount) * 100, 1) : 0;
      var dropOff = 100 - pctOfPrev;

      steps.push({
        name: stepDefs[i].name,
        count: count,
        pct_of_total: pctOfTotal,
        pct_of_previous: pctOfPrev,
        drop_off_pct: analyticsRound(dropOff, 1)
      });

      if (i > 0 && dropOff > worstDropOff.drop_pct) {
        worstDropOff = { step: stepDefs[i].name, drop_pct: analyticsRound(dropOff, 1) };
      }
    }

    return JSON.stringify({
      steps: steps,
      total_users: totalUsers,
      worst_drop_off: worstDropOff
    });
  } catch (e) {
    logger.error("rpcAnalyticsFunnel error: %s", e.message || e);
    return JSON.stringify({ error: e.message || "Internal error" });
  }
}

// Funnel helpers

function countOnboardingStep(nk, userIds, stepType) {
  var count = 0;
  for (var i = 0; i < userIds.length; i++) {
    var ob = analyticsSafeRead(nk, "onboarding_state", "state", userIds[i]);
    if (!ob) continue;
    if (stepType === "started" && ob.currentStep && ob.currentStep > 0) count++;
    else if (stepType === "completed" && ob.onboardingComplete === true) count++;
    else if (stepType === "first_quiz" && ob.firstQuizCompleted === true) count++;
  }
  return count;
}

function countSessionMilestone(nk, userIds, minSessions) {
  var count = 0;
  for (var i = 0; i < userIds.length; i++) {
    var fs = analyticsSafeRead(nk, "first_session", "session_data", userIds[i]);
    if (fs && fs.totalSessions >= minSessions) count++;
  }
  return count;
}

function countEventType(nk, userIds, gameId, eventName) {
  var count = 0;
  for (var i = 0; i < userIds.length; i++) {
    var result = analyticsSafeList(nk, userIds[i], "analytics_events", 100, "");
    if (!result || !result.objects) continue;
    var found = false;
    for (var j = 0; j < result.objects.length; j++) {
      var evt = result.objects[j].value;
      if (evt && evt.eventName === eventName) {
        if (!gameId || evt.gameId === gameId) { found = true; break; }
      }
    }
    if (found) count++;
  }
  return count;
}

function countWithGroups(nk, userIds) {
  var count = 0;
  for (var i = 0; i < userIds.length; i++) {
    try {
      var groups = nk.userGroupsList(userIds[i], 1, null, "");
      if (groups && groups.userGroups && groups.userGroups.length > 0) count++;
    } catch (_) { /* swallow */ }
  }
  return count;
}

function countD7Return(nk, userIds) {
  var count = 0;
  for (var i = 0; i < userIds.length; i++) {
    var fs = analyticsSafeRead(nk, "first_session", "session_data", userIds[i]);
    if (fs && fs.d7Returned === true) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// 6. rpcAnalyticsEconomyHealth
// ---------------------------------------------------------------------------

function rpcAnalyticsEconomyHealth(ctx, logger, nk, payload) {
  try {
    var data = analyticsSafeJsonParse(payload);
    var gameId = data.game_id;

    var userIds = sampleUserIds(nk, 100);
    var sampleSize = userIds.length;
    if (sampleSize === 0) {
      return JSON.stringify({
        total_coins: 0, total_gems: 0, avg_coins: 0, median_coins: 0,
        max_coins: 0, min_coins: 0, gini_coefficient: 0,
        source_sink_ratio: { sources_total: 0, sinks_total: 0, ratio: 0 },
        whale_count: 0, sample_size: 0
      });
    }

    var coinBalances = [];
    var totalCoins = 0;
    var totalGems = 0;
    var sourcesTotal = 0;
    var sinksTotal = 0;

    // Batch fetch accounts
    var accounts = [];
    try {
      accounts = nk.accountsGetId(userIds);
    } catch (_) { /* swallow */ }

    for (var a = 0; a < accounts.length; a++) {
      var acct = accounts[a];
      var wallet = {};
      if (acct && acct.wallet) {
        if (typeof acct.wallet === "string") {
          try { wallet = JSON.parse(acct.wallet); } catch (_) { /* swallow */ }
        } else {
          wallet = acct.wallet;
        }
      }
      var coins = wallet.coins || wallet.tokens || 0;
      var gems = wallet.gems || wallet.diamonds || 0;
      totalCoins += coins;
      totalGems += gems;
      coinBalances.push(coins);
    }

    // Ledger sampling for source/sink
    var ledgerSampleSize = Math.min(userIds.length, 20);
    for (var li = 0; li < ledgerSampleSize; li++) {
      try {
        var ledger = nk.walletLedgerList(userIds[li], 50, "");
        if (ledger && ledger.items) {
          for (var lj = 0; lj < ledger.items.length; lj++) {
            var changeset = ledger.items[lj].changeset;
            if (typeof changeset === "string") {
              try { changeset = JSON.parse(changeset); } catch (_) { continue; }
            }
            for (var ck in changeset) {
              if (changeset.hasOwnProperty(ck)) {
                var val = changeset[ck];
                if (val > 0) sourcesTotal += val;
                else if (val < 0) sinksTotal += Math.abs(val);
              }
            }
          }
        }
      } catch (_) { /* swallow */ }
    }

    coinBalances.sort(function (a, b) { return a - b; });
    var avgCoins = sampleSize > 0 ? analyticsRound(totalCoins / sampleSize, 1) : 0;
    var medCoins = analyticsMedian(coinBalances);
    var maxCoins = coinBalances.length > 0 ? coinBalances[coinBalances.length - 1] : 0;
    var minCoins = coinBalances.length > 0 ? coinBalances[0] : 0;
    var gini = analyticsRound(analyticsGini(coinBalances), 4);

    // Whale detection: top 1%
    var whaleThresholdIdx = Math.floor(coinBalances.length * 0.99);
    var whaleCount = coinBalances.length - whaleThresholdIdx;

    var ssRatio = sinksTotal > 0 ? analyticsRound(sourcesTotal / sinksTotal, 2) : (sourcesTotal > 0 ? 999 : 0);

    return JSON.stringify({
      total_coins: totalCoins,
      total_gems: totalGems,
      avg_coins: avgCoins,
      median_coins: medCoins,
      max_coins: maxCoins,
      min_coins: minCoins,
      gini_coefficient: gini,
      source_sink_ratio: {
        sources_total: sourcesTotal,
        sinks_total: sinksTotal,
        ratio: ssRatio
      },
      whale_count: whaleCount,
      sample_size: sampleSize
    });
  } catch (e) {
    logger.error("rpcAnalyticsEconomyHealth error: %s", e.message || e);
    return JSON.stringify({ error: e.message || "Internal error" });
  }
}

// ---------------------------------------------------------------------------
// 7. rpcAnalyticsErrorLog
// ---------------------------------------------------------------------------

function rpcAnalyticsErrorLog(ctx, logger, nk, payload) {
  try {
    var data = analyticsSafeJsonParse(payload);
    var gameId = data.game_id;
    var days = data.days || 7;
    var cutoffSec = analyticsNowSeconds() - days * 86400;

    var result = analyticsSafeList(nk, SYSTEM_USER, "analytics_error_events", 100, "");
    var errors = [];
    if (result && result.objects) {
      for (var i = 0; i < result.objects.length; i++) {
        var val = result.objects[i].value;
        if (!val) continue;
        if (val.timestamp && val.timestamp < cutoffSec) continue;
        if (gameId && val.game_id && val.game_id !== gameId) continue;
        errors.push(val);
      }
    }

    // Group by rpc_name
    var rpcMap = {};
    var dailyMap = {};
    for (var ei = 0; ei < errors.length; ei++) {
      var err = errors[ei];
      var rpcName = err.rpc_name || "unknown";
      if (!rpcMap[rpcName]) {
        rpcMap[rpcName] = { count: 0, last_occurred: "", sample_error: "" };
      }
      rpcMap[rpcName].count++;
      var errTime = err.timestamp_iso || "";
      if (errTime > rpcMap[rpcName].last_occurred) {
        rpcMap[rpcName].last_occurred = errTime;
        rpcMap[rpcName].sample_error = err.error_message || "";
      }

      var errDate = err.date || "";
      if (errDate) {
        if (!dailyMap[errDate]) dailyMap[errDate] = 0;
        dailyMap[errDate]++;
      }
    }

    var errorsByRpc = [];
    var mostFailing = { name: "", count: 0 };
    for (var rk in rpcMap) {
      if (rpcMap.hasOwnProperty(rk)) {
        errorsByRpc.push({
          rpc_name: rk,
          count: rpcMap[rk].count,
          last_occurred: rpcMap[rk].last_occurred,
          sample_error: rpcMap[rk].sample_error
        });
        if (rpcMap[rk].count > mostFailing.count) {
          mostFailing = { name: rk, count: rpcMap[rk].count };
        }
      }
    }
    errorsByRpc.sort(function (a, b) { return b.count - a.count; });

    var errorTrendDaily = [];
    for (var dk in dailyMap) {
      if (dailyMap.hasOwnProperty(dk)) {
        errorTrendDaily.push({ date: dk, count: dailyMap[dk] });
      }
    }
    errorTrendDaily.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    return JSON.stringify({
      total_errors: errors.length,
      errors_by_rpc: errorsByRpc,
      error_trend_daily: errorTrendDaily,
      most_failing_rpc: mostFailing
    });
  } catch (e) {
    logger.error("rpcAnalyticsErrorLog error: %s", e.message || e);
    return JSON.stringify({ error: e.message || "Internal error" });
  }
}

// ---------------------------------------------------------------------------
// 8. rpcAnalyticsFeatureAdoption
// ---------------------------------------------------------------------------

function rpcAnalyticsFeatureAdoption(ctx, logger, nk, payload) {
  try {
    var data = analyticsSafeJsonParse(payload);
    var gameId = data.game_id;

    var userIds = sampleUserIds(nk, 100);
    var totalSampled = userIds.length;

    var featureDefs = [
      { name: "tournaments",    collection: "tournament_records" },
      { name: "challenges",     collection: "challenges_v2" },
      { name: "daily_missions", collection: "daily_missions" },
      { name: "weekly_goals",   collection: "weekly_goals" },
      { name: "season_pass",    collection: "season_pass" },
      { name: "mystery_box",    collection: "mystery_box" },
      { name: "bounties",       collection: "bounties" },
      { name: "duels",          collection: "duels" },
      { name: "team_quiz",      collection: "team_quiz" },
      { name: "daily_duo",      collection: "daily_duo" },
      { name: "knowledge_duel", collection: "knowledge_duel" },
      { name: "trivia_night",   collection: "trivia_night" },
      { name: "loadouts",       collection: "loadouts" },
      { name: "group_quests",   collection: "group_quests" }
    ];

    var features = [];
    var mostAdopted = { name: "", users_count: 0 };
    var leastAdopted = { name: "", users_count: totalSampled + 1 };

    for (var fi = 0; fi < featureDefs.length; fi++) {
      var def = featureDefs[fi];
      var usersWithFeature = 0;

      for (var ui = 0; ui < userIds.length; ui++) {
        var result = analyticsSafeList(nk, userIds[ui], def.collection, 1, "");
        if (result && result.objects && result.objects.length > 0) {
          usersWithFeature++;
        }
      }

      var adoptionPct = totalSampled > 0 ? analyticsRound((usersWithFeature / totalSampled) * 100, 1) : 0;
      features.push({
        name: def.name,
        users_count: usersWithFeature,
        adoption_pct: adoptionPct,
        collection: def.collection
      });

      if (usersWithFeature > mostAdopted.users_count) {
        mostAdopted = { name: def.name, users_count: usersWithFeature };
      }
      if (usersWithFeature < leastAdopted.users_count) {
        leastAdopted = { name: def.name, users_count: usersWithFeature };
      }
    }

    features.sort(function (a, b) { return b.users_count - a.users_count; });

    // Generate recommendations based on adoption
    var recommendations = [];
    for (var ri = 0; ri < features.length; ri++) {
      if (features[ri].adoption_pct < 10) {
        recommendations.push("Feature '" + features[ri].name + "' has very low adoption (" + features[ri].adoption_pct + "%). Consider improving discoverability or onboarding for this feature.");
      }
    }
    if (recommendations.length === 0) {
      recommendations.push("All features have reasonable adoption rates.");
    }

    return JSON.stringify({
      features: features,
      total_users_sampled: totalSampled,
      most_adopted: mostAdopted.name,
      least_adopted: leastAdopted.name,
      recommendations: recommendations
    });
  } catch (e) {
    logger.error("rpcAnalyticsFeatureAdoption error: %s", e.message || e);
    return JSON.stringify({ error: e.message || "Internal error" });
  }
}

// ---------------------------------------------------------------------------
// 9. rpcAnalyticsLogError (helper RPC for error tracking)
// ---------------------------------------------------------------------------

function rpcAnalyticsLogError(ctx, logger, nk, payload) {
  try {
    var data = analyticsSafeJsonParse(payload);
    var rpcName = data.rpc_name || "unknown";
    var errorMessage = data.error_message || "";
    var userId = data.user_id || ctx.userId || "";
    var gameId = data.game_id || "";
    var stackTrace = data.stack_trace || "";
    var nowSec = analyticsNowSeconds();
    var todayStr = analyticsDaysAgo(0);

    var errorRecord = {
      rpc_name: rpcName,
      error_message: errorMessage,
      user_id: userId,
      game_id: gameId,
      stack_trace: stackTrace,
      timestamp: nowSec,
      timestamp_iso: new Date().toISOString(),
      date: todayStr
    };

    var key = "error_" + rpcName + "_" + nowSec + "_" + Math.floor(Math.random() * 10000);
    analyticsSafeWrite(nk, "analytics_error_events", key, SYSTEM_USER, errorRecord);

    logger.warn("Error logged for RPC '%s': %s", rpcName, errorMessage);

    return JSON.stringify({ success: true });
  } catch (e) {
    logger.error("rpcAnalyticsLogError error: %s", e.message || e);
    return JSON.stringify({ error: e.message || "Internal error" });
  }
}
