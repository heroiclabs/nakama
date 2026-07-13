// aahaa_facts.ts
// ─────────────────────────────────────────────────────────────────────────────
// Aahaa engine — deterministic per-user Fact Pack (KB-1 slice).
//
// This is the "Deducible Insights" contract from CATALOG-DEDUCIBLE_INSIGHTS.md:
// every claim an Aahaa moment makes about a user must trace to a row produced
// here, and every row here is a plain aggregation over data Nakama actually
// stores. No LLM is involved in producing facts — LLMs may only REPHRASE them
// (enforced by AahaaValidator).
//
// Sources read (all existing storage, no new writes):
//   quiz-verse_quiz_history / "history"   per-question ledger {category, correct, time_ms}
//   quiz_user_stats_<gameId> / stats_<uid> lifetime totals + streaks + per-mode stats
//   user_model / "derived"                weak/strong topics, archetype (if synced)
//   user_streaks / "current"              daily streak count (if present)
//   sq_staged (list)                      staged-questions engagement per (mode, topic)
//   aahaa_profile / "profile"             onboarding-set facts (user typed them)
//   nk.friendsList                        friend count
//   nk.accountGetId                       username + account create time
//
// Every fact group carries a lineage entry {source, derivation, sample_size}
// so the Growth Dashboard can render tap-to-trace provenance on every number.

namespace AahaaFacts {

  export var FACT_PACK_VERSION = "aahaa-facts/1.0.0";

  var QUIZVERSE_GAME_ID = "126bf539-dae2-4bcf-964d-316c0fa1f92b";
  var HISTORY_COLLECTION = "quiz-verse_quiz_history";
  var RECENT_WINDOW = 50;   // "recent" = newest 50 per-question entries
  var MIN_TOPIC_SAMPLE = 3; // don't call a topic strong/weak on fewer answers

  export interface TopicStat {
    topic: string;
    answered: number;
    correct: number;
    accuracy_pct: number;
    avg_time_ms: number;
  }

  export interface FactPack {
    version: string;
    computed_ms: number;
    user_id: string;
    identity: any;
    lifetime: any;
    recent: any;
    topics: { list: TopicStat[]; strongest: TopicStat | null; weakest: TopicStat | null; top3: string[] };
    modes: any;
    streaks: any;
    social: any;
    seedq: any;
    onboarding: any;
    derived: any;
    lineage: { [group: string]: any };
  }

  function safeRead(nk: nkruntime.Nakama, collection: string, key: string, userId: string): any {
    try {
      var rows = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
      if (rows && rows.length > 0 && rows[0].value) return rows[0].value;
    } catch (e) { /* absent is fine */ }
    return null;
  }

  function pct(correct: number, total: number): number {
    return total > 0 ? Math.round((correct / total) * 100) : 0;
  }

  // Rule-based, deterministic archetype. NOT an LLM guess — a fixed decision
  // table over hard numbers, so the label itself is deducible and stable.
  function computeArchetype(lifetimeGames: number, accuracy: number, avgMs: number, modeCount: number, topModeShare: number): string {
    if (lifetimeGames < 5) return "Newcomer";
    if (topModeShare >= 0.6) return "Specialist";
    if (modeCount >= 6) return "Renaissance";
    if (avgMs > 0 && avgMs <= 6000 && accuracy >= 60) return "Speedrunner";
    if (accuracy >= 80) return "Champion";
    if (lifetimeGames >= 50) return "Daily-dripper";
    return "Explorer";
  }

  export function buildFactPack(ctx: nkruntime.Context, nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string): FactPack {
    var now = Date.now();
    var lineage: { [group: string]: any } = {};

    // ── Identity ────────────────────────────────────────────────────────────
    var username = "";
    var createMs = 0;
    try {
      var account: any = nk.accountGetId(userId);
      if (account && account.user) {
        username = account.user.username || "";
        var ct: any = account.user.createTime || (account.user as any).createTimeSec || 0;
        // createTime may arrive as seconds; normalise to ms.
        createMs = ct > 0 ? (ct < 100000000000 ? ct * 1000 : ct) : 0;
      }
    } catch (e) { /* account lookup best-effort */ }
    var daysSinceInstall = createMs > 0 ? Math.floor((now - createMs) / 86400000) : 0;
    lineage["identity"] = { source: "nk.accountGetId", derivation: "account create time → days_since_install", sample_size: 1 };

    // ── Per-question history ────────────────────────────────────────────────
    var history = safeRead(nk, HISTORY_COLLECTION, "history", userId);
    var entries: any[] = (history && history.entries && history.entries.length) ? history.entries : [];
    var recentEntries = entries.length > RECENT_WINDOW ? entries.slice(entries.length - RECENT_WINDOW) : entries;

    var lifetimeAnswered = 0, lifetimeCorrect = 0, timeSumMs = 0, timedCount = 0;
    var topicMap: { [slug: string]: TopicStat } = {};
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || typeof e !== "object") continue;
      var correct = e.correct !== undefined ? !!e.correct : !!e.was_correct;
      lifetimeAnswered++;
      if (correct) lifetimeCorrect++;
      var tms = parseInt(e.time_ms || 0, 10) || 0;
      if (tms > 0) { timeSumMs += tms; timedCount++; }
      var cat = "" + (e.category || "general");
      var slug = SeedQ.slugify(cat) || "general";
      if (!topicMap[slug]) topicMap[slug] = { topic: cat, answered: 0, correct: 0, accuracy_pct: 0, avg_time_ms: 0 };
      var ts = topicMap[slug];
      ts.answered++;
      if (correct) ts.correct++;
      ts.avg_time_ms += tms;
    }
    var topicList: TopicStat[] = [];
    var slugs = Object.keys(topicMap);
    for (var s = 0; s < slugs.length; s++) {
      var t = topicMap[slugs[s]];
      t.avg_time_ms = t.answered > 0 ? Math.round(t.avg_time_ms / t.answered) : 0;
      t.accuracy_pct = pct(t.correct, t.answered);
      topicList.push(t);
    }
    topicList.sort(function (a, b) { return b.answered - a.answered; });
    var top3: string[] = [];
    for (var t3 = 0; t3 < topicList.length && t3 < 3; t3++) top3.push(topicList[t3].topic);

    var strongest: TopicStat | null = null;
    var weakest: TopicStat | null = null;
    for (var st = 0; st < topicList.length; st++) {
      var tt = topicList[st];
      if (tt.answered < MIN_TOPIC_SAMPLE) continue;
      if (!strongest || tt.accuracy_pct > strongest.accuracy_pct) strongest = tt;
      if (!weakest || tt.accuracy_pct < weakest.accuracy_pct) weakest = tt;
    }
    lineage["topics"] = {
      source: HISTORY_COLLECTION + "/history",
      derivation: "per-topic sum(correct)/sum(answered); strong/weak require ≥" + MIN_TOPIC_SAMPLE + " answers",
      sample_size: lifetimeAnswered
    };

    // ── Recent window facts ─────────────────────────────────────────────────
    var recAnswered = 0, recCorrect = 0, recTimeSum = 0, recTimed = 0;
    var lastN: any[] = [];
    var wrongByTopicRecent: { [slug: string]: { topic: string; wrong: number } } = {};
    for (var r = 0; r < recentEntries.length; r++) {
      var re = recentEntries[r];
      if (!re || typeof re !== "object") continue;
      var rc = re.correct !== undefined ? !!re.correct : !!re.was_correct;
      recAnswered++;
      if (rc) recCorrect++;
      var rt = parseInt(re.time_ms || 0, 10) || 0;
      if (rt > 0) { recTimeSum += rt; recTimed++; }
      lastN.push({ topic: "" + (re.category || "general"), correct: rc, time_ms: rt });
      if (!rc) {
        var rslug = SeedQ.slugify("" + (re.category || "general")) || "general";
        if (!wrongByTopicRecent[rslug]) wrongByTopicRecent[rslug] = { topic: "" + (re.category || "general"), wrong: 0 };
        wrongByTopicRecent[rslug].wrong++;
      }
    }

    // Struggling topic: ≥3 wrong in the recent window on one topic.
    var strugglingTopic = "";
    var strugglingWrong = 0;
    var wslugs = Object.keys(wrongByTopicRecent);
    for (var w = 0; w < wslugs.length; w++) {
      if (wrongByTopicRecent[wslugs[w]].wrong >= 3 && wrongByTopicRecent[wslugs[w]].wrong > strugglingWrong) {
        strugglingTopic = wrongByTopicRecent[wslugs[w]].topic;
        strugglingWrong = wrongByTopicRecent[wslugs[w]].wrong;
      }
    }

    // Tail signals: streak of correct answers at the very end of the ledger
    // (flow) or wrong answers (frustration).
    var tailCorrectRun = 0, tailWrongRun = 0;
    for (var b = lastN.length - 1; b >= 0; b--) {
      if (lastN[b].correct) {
        if (tailWrongRun > 0) break;
        tailCorrectRun++;
      } else {
        if (tailCorrectRun > 0) break;
        tailWrongRun++;
      }
    }
    // Last-quiz single-topic correct run (for lock_it_in): the newest entries
    // that share one topic, all correct.
    var lockTopic = "";
    var lockRun = 0;
    if (lastN.length > 0 && lastN[lastN.length - 1].correct) {
      lockTopic = lastN[lastN.length - 1].topic;
      for (var lb = lastN.length - 1; lb >= 0; lb--) {
        if (lastN[lb].correct && lastN[lb].topic === lockTopic) lockRun++;
        else break;
      }
    }

    // Comeback count: wrong,wrong,wrong followed by a correct — anti-fragility.
    var comebacks = 0;
    var wrongRun = 0;
    for (var cb = 0; cb < lastN.length; cb++) {
      if (!lastN[cb].correct) wrongRun++;
      else {
        if (wrongRun >= 3) comebacks++;
        wrongRun = 0;
      }
    }

    // Improvement velocity: accuracy of newest half vs the half before it.
    var improvementPts = 0;
    if (entries.length >= 40) {
      var half = Math.floor(RECENT_WINDOW / 2);
      var newest = entries.slice(entries.length - half);
      var previous = entries.slice(Math.max(0, entries.length - half * 2), entries.length - half);
      var nc = 0, na = 0, pc = 0, pa = 0;
      for (var nn = 0; nn < newest.length; nn++) { na++; if (newest[nn] && (newest[nn].correct || newest[nn].was_correct)) nc++; }
      for (var pp = 0; pp < previous.length; pp++) { pa++; if (previous[pp] && (previous[pp].correct || previous[pp].was_correct)) pc++; }
      improvementPts = pct(nc, na) - pct(pc, pa);
    }
    lineage["recent"] = {
      source: HISTORY_COLLECTION + "/history (newest " + RECENT_WINDOW + ")",
      derivation: "tail runs, ≥3-wrong topic detection, comeback sequences, newest-half vs prior-half accuracy delta",
      sample_size: recAnswered
    };

    // ── Lifetime stats docs ─────────────────────────────────────────────────
    // Two writers exist: quiz_results.js (rich doc at quiz_user_stats_<gameId>)
    // and the LegacyQuiz TS handler that owns the live `quiz_submit_result`
    // RPC (lean doc at quiz_results/stats_<uid>). Merge whichever is present.
    var stats = safeRead(nk, "quiz_user_stats_" + QUIZVERSE_GAME_ID, "stats_" + userId, userId)
             || safeRead(nk, "quiz_user_stats_quiz-verse", "stats_" + userId, userId);
    var legacyStats = safeRead(nk, "quiz_results", "stats_" + userId, userId);

    var totalGames = Math.max(stats ? (stats.totalGames || 0) : 0, legacyStats ? (legacyStats.totalGames || 0) : 0);
    var totalWins = stats ? (stats.totalWins || 0) : 0;
    var winStreak = stats ? (stats.currentStreak || 0) : 0;
    var longestWinStreak = stats ? (stats.longestStreak || 0) : 0;
    var lastPlayedAt = stats ? (stats.lastPlayedAt || null) : null;
    var lastPlayedMs = 0;
    if (lastPlayedAt) {
      try { lastPlayedMs = new Date(lastPlayedAt).getTime() || 0; } catch (e2) { lastPlayedMs = 0; }
    }
    if (legacyStats && legacyStats.lastPlayedAt) {
      // LegacyQuiz stores unix seconds.
      var legacyMs = (legacyStats.lastPlayedAt < 100000000000) ? legacyStats.lastPlayedAt * 1000 : legacyStats.lastPlayedAt;
      if (legacyMs > lastPlayedMs) lastPlayedMs = legacyMs;
    }
    var daysSinceLastPlayed = lastPlayedMs > 0 ? Math.floor((now - lastPlayedMs) / 86400000) : -1;

    // If the per-question ledger is missing (older clients used only the
    // stats counters), fall back to the counters so lifetime facts still hold.
    if (lifetimeAnswered === 0 && legacyStats && (legacyStats.totalQuestions || 0) > 0) {
      lifetimeAnswered = legacyStats.totalQuestions || 0;
      lifetimeCorrect = legacyStats.totalCorrect || 0;
    }

    var modeStats = (stats && stats.modeStats) ? stats.modeStats : {};
    var modeNames = Object.keys(modeStats);
    var topMode = "", topModeGames = 0, luckyMode = "", luckyWinRate = 0;
    for (var m = 0; m < modeNames.length; m++) {
      var ms = modeStats[modeNames[m]];
      if (!ms) continue;
      if ((ms.games || 0) > topModeGames) { topModeGames = ms.games || 0; topMode = modeNames[m]; }
      if ((ms.games || 0) >= 5) {
        var wr = pct(ms.wins || 0, ms.games || 0);
        if (wr > luckyWinRate) { luckyWinRate = wr; luckyMode = modeNames[m]; }
      }
    }
    var topModeShare = totalGames > 0 ? topModeGames / totalGames : 0;
    lineage["lifetime"] = {
      source: "quiz_user_stats_<gameId>/stats_<userId>",
      derivation: "quiz_results.js aggregate counters (games, wins, streaks, per-mode)",
      sample_size: totalGames
    };

    // ── Daily streak (separate from win streak) ─────────────────────────────
    var streakDoc = safeRead(nk, "user_streaks", "current", userId);
    var dailyStreak = streakDoc ? (streakDoc.count || 0) : 0;
    lineage["streaks"] = { source: "user_streaks/current + quiz_user_stats", derivation: "stored counters, no inference", sample_size: 1 };

    // ── user_model derived (if the analytics sync populated it) ─────────────
    var derivedModel = safeRead(nk, "user_model", "derived", userId) || {};
    lineage["user_model"] = { source: "user_model/derived", derivation: "analytics-knowledge-sync output (pass-through)", sample_size: 1 };

    // ── Social ──────────────────────────────────────────────────────────────
    var friendsCount = 0;
    try {
      var fl: any = nk.friendsList(userId, 100, 0);
      friendsCount = (fl && fl.friends) ? fl.friends.length : 0;
    } catch (e3) { /* social optional */ }
    lineage["social"] = { source: "nk.friendsList(state=0)", derivation: "count of mutual friends", sample_size: friendsCount };

    // ── Staged-questions engagement (seedq engine) ──────────────────────────
    var seedqPools = 0, seedqConsumedSets = 0, seedqReadySets = 0;
    var exhaustedPools: string[] = [];
    try {
      var page: any = nk.storageList(userId, SeedQ.COLL_STAGED, 50);
      var objs = (page && page.objects) ? page.objects : [];
      for (var so = 0; so < objs.length; so++) {
        var doc = objs[so].value;
        if (!doc || !doc.sets) continue;
        seedqPools++;
        for (var ds = 0; ds < doc.sets.length; ds++) {
          if (doc.sets[ds].status === "consumed") seedqConsumedSets++;
          else if (doc.sets[ds].status === "ready") seedqReadySets++;
        }
      }
    } catch (e4) { /* seedq optional */ }
    lineage["seedq"] = { source: "sq_staged (per-user list)", derivation: "count staged docs + consumed/ready sets", sample_size: seedqPools };

    // ── Onboarding-set facts + engine profile ───────────────────────────────
    var profile = safeRead(nk, AahaaEngine.COLL_PROFILE, AahaaEngine.KEY_PROFILE, userId) || {};
    var onboarding = profile.onboarding || {};
    var pendingEvents = profile.pending_events || [];
    for (var pe = 0; pe < pendingEvents.length; pe++) {
      if (pendingEvents[pe] && pendingEvents[pe].type === "pool_exhausted" &&
          (now - (pendingEvents[pe].ms || 0)) < 7 * 86400000) {
        exhaustedPools.push((pendingEvents[pe].mode || "") + "/" + (pendingEvents[pe].topic || ""));
      }
    }
    lineage["onboarding"] = { source: "aahaa_profile/profile.onboarding", derivation: "user-typed values, stored verbatim", sample_size: 1 };

    var avgMs = timedCount > 0 ? Math.round(timeSumMs / timedCount) : 0;
    var accuracyOverall = pct(lifetimeCorrect, lifetimeAnswered);
    var archetype = derivedModel.personality_archetype ||
      computeArchetype(totalGames, accuracyOverall, avgMs, modeNames.length, topModeShare);
    lineage["derived"] = {
      source: "decision table over lifetime counters (or user_model/derived when synced)",
      derivation: "fixed thresholds: top-mode share ≥60%→Specialist; ≥6 modes→Renaissance; ≤6s/q & ≥60%→Speedrunner; ≥80%→Champion",
      sample_size: totalGames
    };

    // Exam goal countdown (only if the user set it — never inferred).
    var daysToExam = -1;
    if (onboarding.exam_date_iso) {
      try {
        var examMs = new Date("" + onboarding.exam_date_iso).getTime();
        if (examMs > 0) daysToExam = Math.ceil((examMs - now) / 86400000);
      } catch (e5) { daysToExam = -1; }
    }

    return {
      version: FACT_PACK_VERSION,
      computed_ms: now,
      user_id: userId,
      identity: {
        username: username,
        days_since_install: daysSinceInstall,
        created_ms: createMs
      },
      lifetime: {
        questions_answered: lifetimeAnswered,
        questions_correct: lifetimeCorrect,
        accuracy_pct: accuracyOverall,
        avg_time_ms: avgMs,
        total_games: totalGames,
        total_wins: totalWins,
        win_streak: winStreak,
        longest_win_streak: longestWinStreak,
        days_since_last_played: daysSinceLastPlayed
      },
      recent: {
        window: RECENT_WINDOW,
        answered: recAnswered,
        correct: recCorrect,
        accuracy_pct: pct(recCorrect, recAnswered),
        avg_time_ms: recTimed > 0 ? Math.round(recTimeSum / recTimed) : 0,
        tail_correct_run: tailCorrectRun,
        tail_wrong_run: tailWrongRun,
        lock_topic: lockTopic,
        lock_run: lockRun,
        struggling_topic: strugglingTopic,
        struggling_wrong: strugglingWrong,
        comebacks_after_3_wrong: comebacks,
        improvement_pts: improvementPts
      },
      topics: { list: topicList.slice(0, 20), strongest: strongest, weakest: weakest, top3: top3 },
      modes: {
        distinct: modeNames.length,
        top_mode: topMode,
        top_mode_games: topModeGames,
        top_mode_share_pct: Math.round(topModeShare * 100),
        lucky_mode: luckyMode,
        lucky_mode_win_rate_pct: luckyWinRate
      },
      streaks: { daily: dailyStreak, win: winStreak, longest_win: longestWinStreak },
      social: { friends_count: friendsCount },
      seedq: {
        pools_engaged: seedqPools,
        sets_consumed: seedqConsumedSets,
        sets_ready: seedqReadySets,
        exhausted_pools_7d: exhaustedPools
      },
      onboarding: {
        target_exam_id: onboarding.target_exam_id || "",
        exam_date_iso: onboarding.exam_date_iso || "",
        days_to_exam: daysToExam,
        preferred_play_time: onboarding.preferred_play_time || "",
        interests: onboarding.interests || [],
        birthday: onboarding.birthday || ""
      },
      derived: {
        personality_archetype: archetype,
        weak_topics: derivedModel.weak_topics || (weakest ? [weakest.topic] : []),
        strong_topics: derivedModel.strong_topics || (strongest ? [strongest.topic] : [])
      },
      lineage: lineage
    };
  }
}
