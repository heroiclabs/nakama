// PlayerDNA — per-player behavioural intelligence profile.
//
// Storage: collection="qv_player_dna", key="dna", owner=userId
//          permissionRead=1 (owner), permissionWrite=0 (server-only)
//
// Updated by:  quizverse_submit_result  (Phase 2 of the Intelligence Platform)
// Read by:     quizverse_get_personalized_quests
//              quizverse_get_questions  (mix algorithm, Elo matching)
//
// Design notes:
//   - No external ML service needed — all computation is pure math inside Goja.
//   - EMA alpha=0.3 → recent 3 sessions weight ~3× more than older history.
//   - Elo per topic mirrors chess rating (K=20/15/10 by tier).
//   - Storage is ~2 KB per player at full maturity — negligible at any scale.

namespace PlayerDNA {

  export var COLLECTION = "qv_player_dna";
  export var KEY        = "dna";

  // ── Schema ──────────────────────────────────────────────────────────────────

  export interface Behavioral {
    peak_hour_utc:         number;   // 0-23, UTC hour player most often plays
    avg_session_questions: number;   // rolling average questions per session
    sessions_per_week:     number;   // rolling EMA of weekly session count
    last_played_at:        number;   // unix seconds
    total_sessions:        number;
    cold_start_done:       boolean;  // true after 3 completed sessions
    comeback_eligible:     boolean;  // true when gap > 3× avg frequency
  }

  export interface DNA {
    affinities: { [topic: string]: number };  // 0.0–1.0 EMA (how much they love this topic)
    masteries:  { [topic: string]: number };  // 0.0–1.0 (how well they know it)
    elos:       { [topic: string]: number };  // e.g. 1200 (adaptive difficulty rating)
    behavioral: Behavioral;
    updated_at: number;                       // unix seconds
  }

  function defaultDNA(): DNA {
    return {
      affinities: {},
      masteries:  {},
      elos:       {},
      behavioral: {
        peak_hour_utc:         19,
        avg_session_questions: 10,
        sessions_per_week:     0,
        last_played_at:        0,
        total_sessions:        0,
        cold_start_done:       false,
        comeback_eligible:     false
      },
      updated_at: 0
    };
  }

  // ── Storage ──────────────────────────────────────────────────────────────────

  export function load(nk: nkruntime.Nakama, userId: string): DNA {
    var rows: nkruntime.StorageObject[] = [];
    try {
      rows = nk.storageRead([{ collection: COLLECTION, key: KEY, userId: userId }]);
    } catch (_) {}
    if (rows && rows.length > 0 && rows[0].value) {
      var stored = rows[0].value as DNA;
      // Back-fill any missing behavioral fields added after initial writes
      if (!stored.behavioral) stored.behavioral = defaultDNA().behavioral;
      if (stored.behavioral.comeback_eligible === undefined) stored.behavioral.comeback_eligible = false;
      return stored;
    }
    return defaultDNA();
  }

  export function save(nk: nkruntime.Nakama, userId: string, dna: DNA): void {
    dna.updated_at = Math.floor(Date.now() / 1000);
    nk.storageWrite([{
      collection:      COLLECTION,
      key:             KEY,
      userId:          userId,
      value:           dna,
      permissionRead:  1 as nkruntime.ReadPermissionValues,
      permissionWrite: 0 as nkruntime.WritePermissionValues
    }]);
  }

  // ── Topic ranking helpers ────────────────────────────────────────────────────

  // Returns topic slugs sorted descending by affinity (most loved first).
  export function topTopics(dna: DNA, limit: number): string[] {
    var topics = Object.keys(dna.affinities);
    topics.sort(function(a, b) {
      return (dna.affinities[b] || 0) - (dna.affinities[a] || 0);
    });
    return topics.slice(0, limit);
  }

  // Returns topic slugs sorted ascending by mastery (weakest first).
  // Only returns topics the player has actually attempted (mastery > 0).
  export function weakestTopics(dna: DNA, limit: number): string[] {
    var topics = Object.keys(dna.masteries).filter(function(t) {
      return (dna.masteries[t] || 0) > 0;
    });
    topics.sort(function(a, b) {
      return (dna.masteries[a] || 0) - (dna.masteries[b] || 0);
    });
    return topics.slice(0, limit);
  }

  // Returns topics the player hasn't played yet (for discovery slot).
  export function undiscoveredTopics(dna: DNA, allTopics: string[], limit: number): string[] {
    var out: string[] = [];
    for (var i = 0; i < allTopics.length; i++) {
      if (!dna.affinities[allTopics[i]]) {
        out.push(allTopics[i]);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  // ── EMA update (call after each session) ────────────────────────────────────
  // alpha = 0.3 → recent sessions have ~3× more influence than older ones.
  // played=true when the player voluntarily chose or completed this topic.

  var EMA_ALPHA = 0.3;

  export function updateAffinity(dna: DNA, topic: string, played: boolean): void {
    var signal = played ? 1.0 : 0.0;
    var prev   = dna.affinities[topic] !== undefined ? dna.affinities[topic] : 0.5;
    dna.affinities[topic] = round3(EMA_ALPHA * signal + (1 - EMA_ALPHA) * prev);
  }

  // accuracy: 0.0–1.0 (correct / total for this topic in the session).
  // Mastery grows +0.02 when accuracy ≥ 0.7, shrinks -0.01 otherwise.
  export function updateMastery(dna: DNA, topic: string, accuracy: number): void {
    var prev  = dna.masteries[topic] !== undefined ? dna.masteries[topic] : 0.0;
    var delta = accuracy >= 0.7 ? 0.02 : -0.01;
    dna.masteries[topic] = clamp(round3(prev + delta), 0, 1);
  }

  // ── Elo update (per topic, per session) ─────────────────────────────────────
  // Standard Elo formula.  avgDifficulty acts as the "opponent" Elo.
  // K-factor tiers: novice < 1000 → K=20, intermediate → K=15, advanced > 1600 → K=10.

  export function updateElo(dna: DNA, topic: string, accuracy: number, avgDifficulty: number): void {
    var playerElo = dna.elos[topic] !== undefined ? dna.elos[topic] : 1200;
    var K         = playerElo < 1000 ? 20 : (playerElo < 1600 ? 15 : 10);
    var oppElo    = avgDifficulty > 0 ? avgDifficulty : 1200;
    var expected  = 1 / (1 + Math.pow(10, (oppElo - playerElo) / 400));
    dna.elos[topic] = Math.round(playerElo + K * (accuracy - expected));
  }

  // ── Behavioral update ───────────────────────────────────────────────────────

  export function updateBehavioral(
    dna:             DNA,
    questionCount:   number,
    sessionHourUtc:  number   // 0-23
  ): void {
    var b   = dna.behavioral;
    var now = Math.floor(Date.now() / 1000);

    // Detect comeback (gap > 3× avg play frequency, min 3 days)
    if (b.last_played_at > 0 && b.sessions_per_week > 0) {
      var avgIntervalSec = (7 * 86400) / b.sessions_per_week;
      var gapSec         = now - b.last_played_at;
      b.comeback_eligible = gapSec > Math.max(avgIntervalSec * 3, 3 * 86400);
    }

    // Rolling average question count per session (alpha=0.3)
    b.avg_session_questions = round3(EMA_ALPHA * questionCount + (1 - EMA_ALPHA) * b.avg_session_questions);

    // Rolling sessions_per_week: increment then EMA towards 7-day rhythm
    b.sessions_per_week = round3(EMA_ALPHA * 7 + (1 - EMA_ALPHA) * b.sessions_per_week);

    // Peak hour: simple mode approximation via EMA on hour buckets (not stored
    // separately — just keep last peak_hour_utc with slow drift)
    if (b.peak_hour_utc === undefined) {
      b.peak_hour_utc = sessionHourUtc;
    } else {
      // Drift by 1 hour per 10 sessions toward actual session hour
      var diff = sessionHourUtc - b.peak_hour_utc;
      // Wrap-around for hours (e.g. 23 vs 1)
      if (diff > 12) diff -= 24;
      if (diff < -12) diff += 24;
      b.peak_hour_utc = Math.round((b.peak_hour_utc + diff * 0.1 + 24) % 24);
    }

    b.total_sessions++;
    b.last_played_at = now;

    // Mark cold start done after 3 sessions
    if (!b.cold_start_done && b.total_sessions >= 3) {
      b.cold_start_done = true;
    }
  }

  // ── Cold-start topic sequence ────────────────────────────────────────────────
  // Returns the pre-defined topic for a player's nth session (0-indexed)
  // during cold start.  After 3 sessions, personalization takes over.

  var COLD_START_TOPICS = ["anime", "pokemon", "movies"];

  export function coldStartTopic(sessionIndex: number): string {
    return COLD_START_TOPICS[sessionIndex % COLD_START_TOPICS.length];
  }

  // ── Math helpers ─────────────────────────────────────────────────────────────

  function clamp(val: number, min: number, max: number): number {
    return val < min ? min : val > max ? max : val;
  }

  function round3(val: number): number {
    return Math.round(val * 1000) / 1000;
  }
}
