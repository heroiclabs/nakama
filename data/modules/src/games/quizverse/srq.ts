// QuizVerse — Spaced Repetition Queue (SRQ)
//
// Schedules questions for review using a simplified SM-2 algorithm:
//   Wrong answers → review in 3 days
//   Correct answers → review in 7 days (mastery reinforcement)
//   Re-correct during review → remove from queue (mastered)
//
// Storage:
//   collection = "qv_srq"
//   key        = topic slug  (one doc per user × topic)
//   owner      = userId
//   value      = { entries: { [question_id]: SRQEntry } }
//
// Used by:
//   submit_result.ts — schedule() called after every graded session
//   get_questions.ts — getDueInPool() injects due questions at top

namespace QvSRQ {

  var COLLECTION = "qv_srq";

  // Interval constants (milliseconds)
  var WRONG_INTERVAL_MS   = 3 * 24 * 3600 * 1000;  // 3 days for wrong answers
  var CORRECT_INTERVAL_MS = 7 * 24 * 3600 * 1000;  // 7 days for correct (reinforcement)
  var MAX_ENTRIES         = 200;                    // cap per topic to keep storage lean

  // ── Schema ──────────────────────────────────────────────────────────────────

  interface SRQEntry {
    due_at_ms:    number;   // Unix ms timestamp when this question is next due
    review_count: number;   // how many times reviewed
    last_wrong:   boolean;  // true if the last attempt was wrong
  }

  // ── Low-level helpers ────────────────────────────────────────────────────────

  function nowMs(): number { return Date.now(); }

  function readQueue(nk: nkruntime.Nakama, userId: string, topic: string): any {
    try {
      var rows = nk.storageRead([{ collection: COLLECTION, key: topic, userId: userId }]);
      if (rows && rows.length > 0 && rows[0].value && rows[0].value.entries) {
        return { entries: rows[0].value.entries, version: rows[0].version || "" };
      }
    } catch (_e) {}
    return { entries: {}, version: "" };
  }

  function writeQueue(
    nk:      nkruntime.Nakama,
    userId:  string,
    topic:   string,
    entries: any,
    version: string
  ): void {
    // Prune to MAX_ENTRIES keeping the soonest due entries
    var ids = Object.keys(entries);
    if (ids.length > MAX_ENTRIES) {
      ids.sort(function(a, b) { return (entries[a].due_at_ms || 0) - (entries[b].due_at_ms || 0); });
      for (var pi = MAX_ENTRIES; pi < ids.length; pi++) delete entries[ids[pi]];
    }

    var writeObj: nkruntime.StorageWriteRequest = {
      collection:      COLLECTION,
      key:             topic,
      userId:          userId,
      value:           { entries: entries },
      permissionRead:  1 as nkruntime.ReadPermissionValues,
      permissionWrite: 0 as nkruntime.WritePermissionValues
    };
    if (version) (writeObj as any).version = version;
    nk.storageWrite([writeObj]);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Schedule questions for spaced review after a quiz session.
   * - wrongIds  → due in WRONG_INTERVAL_MS (3 days)
   * - correctIds → due in CORRECT_INTERVAL_MS (7 days) for reinforcement
   *   If an ID was previously in the queue and is now correct, its interval
   *   doubles (capped at 21 days) to back off scheduling.
   */
  export function schedule(
    nk:         nkruntime.Nakama,
    userId:     string,
    topic:      string,
    wrongIds:   string[],
    correctIds: string[]
  ): void {
    if (wrongIds.length === 0 && correctIds.length === 0) return;

    var doc = readQueue(nk, userId, topic);
    var entries: any = doc.entries;
    var now = nowMs();

    for (var wi = 0; wi < wrongIds.length; wi++) {
      var qid = wrongIds[wi];
      if (!qid) continue;
      var existing: any = entries[qid] || {};
      entries[qid] = {
        due_at_ms:    now + WRONG_INTERVAL_MS,
        review_count: (existing.review_count || 0) + 1,
        last_wrong:   true
      };
    }

    for (var ci = 0; ci < correctIds.length; ci++) {
      var cqid = correctIds[ci];
      if (!cqid) continue;
      var cexist: any = entries[cqid];
      if (cexist && cexist.last_wrong) {
        // Previously wrong, now correct → back off: double interval (max 21d)
        var newInterval = Math.min(CORRECT_INTERVAL_MS * 2, 21 * 24 * 3600 * 1000);
        entries[cqid] = {
          due_at_ms:    now + newInterval,
          review_count: (cexist.review_count || 0) + 1,
          last_wrong:   false
        };
      }
      // Correct on first attempt → no scheduling (optional: 7-day reinforcement)
      // Uncomment to enable mastery-reinforcement for first-time correct:
      // else {
      //   entries[cqid] = {
      //     due_at_ms: now + CORRECT_INTERVAL_MS,
      //     review_count: (cexist ? (cexist.review_count || 0) + 1 : 1),
      //     last_wrong: false
      //   };
      // }
    }

    try {
      writeQueue(nk, userId, topic, entries, doc.version);
    } catch (_e) {}
  }

  /**
   * Return questions from `pool` whose IDs are due for SRQ review now.
   * Results are sorted by due_at_ms ascending (most overdue first).
   * This list is prepended to the delivered pack so the player reviews
   * weak questions before seeing fresh ones.
   */
  export function getDueInPool(
    nk:     nkruntime.Nakama,
    userId: string,
    topic:  string,
    pool:   any[]
  ): any[] {
    if (!pool || pool.length === 0) return [];
    try {
      var doc = readQueue(nk, userId, topic);
      var entries: any = doc.entries;
      var now = nowMs();

      // Build a set of due question IDs
      var dueIds: { [id: string]: number } = {};
      for (var key in entries) {
        if (!entries.hasOwnProperty(key)) continue;
        var entry: SRQEntry = entries[key];
        if (entry.due_at_ms <= now) {
          dueIds[key] = entry.due_at_ms;
        }
      }
      if (Object.keys(dueIds).length === 0) return [];

      // Filter pool to due questions and sort most-overdue first
      var due: any[] = [];
      for (var pi = 0; pi < pool.length; pi++) {
        if (dueIds[pool[pi].id] !== undefined) {
          due.push({ q: pool[pi], due_at_ms: dueIds[pool[pi].id] });
        }
      }
      due.sort(function(a, b) { return a.due_at_ms - b.due_at_ms; });
      var result: any[] = [];
      for (var ri = 0; ri < due.length; ri++) result.push(due[ri].q);
      return result;
    } catch (_e) { return []; }
  }

  /**
   * Remove reviewed question IDs from the SRQ (they are now mastered or
   * explicitly dismissed).  Call after a successful review session.
   */
  export function markReviewed(
    nk:          nkruntime.Nakama,
    userId:      string,
    topic:       string,
    questionIds: string[]
  ): void {
    if (!questionIds || questionIds.length === 0) return;
    try {
      var doc = readQueue(nk, userId, topic);
      var entries: any = doc.entries;
      var changed = false;
      for (var i = 0; i < questionIds.length; i++) {
        if (entries[questionIds[i]]) {
          delete entries[questionIds[i]];
          changed = true;
        }
      }
      if (changed) writeQueue(nk, userId, topic, entries, doc.version);
    } catch (_e) {}
  }

  /**
   * Count the total number of SRQ entries due right now across ALL topics
   * for this user.  Used to populate the `personalization.srq_due_count`
   * field in submit_result responses.  Reads at most 20 topic queues.
   */
  export function countDue(nk: nkruntime.Nakama, userId: string): number {
    try {
      var now = nowMs();
      var result = nk.storageList(userId, COLLECTION, 20, "");
      if (!result || !Array.isArray(result.objects)) return 0;
      var count = 0;
      for (var oi = 0; oi < result.objects.length; oi++) {
        var obj = result.objects[oi];
        if (!obj || !obj.value || !obj.value.entries) continue;
        var entries: any = obj.value.entries;
        for (var key in entries) {
          if (entries.hasOwnProperty(key) && entries[key].due_at_ms <= now) count++;
        }
      }
      return count;
    } catch (_e) { return 0; }
  }
}
