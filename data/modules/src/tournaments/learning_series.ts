// =============================================================================
// learning_series.ts — AMOE-unlock progression tracker
//
// Plan ref: §1G/§4. Users watch up to 6 short videos per topic + answer a
// 5-question check. 6/6 videos with ≥3/5 check correctness unlocks one
// free (AMOE) tournament entry on that topic.
//
// Storage: collection `learning_progress`, key `<topic_tag>`, per-user owner.
//
// AMOE proof bookkeeping: this is the legal anchor for the no-purchase
// sweepstakes path. We retain `learning_progress` rows for 7 years.
// =============================================================================

namespace LearningSeries {

  const COLLECTION = "learning_progress";

  function nowSec(): number { return Math.floor(Date.now() / 1000); }

  export interface VideoCheck {
    video_index: number;
    correct: number;
    total: number;
    completed_at: number;
    passed: boolean;
  }

  export interface ProgressRow {
    topic_tag: string;
    user_id: string;
    checks: VideoCheck[];   // one per video_index
    last_updated: number;
    amoe_unlocked: boolean;
  }

  function key(topicTag: string): string { return topicTag; }

  export function read(nk: nkruntime.Nakama, userId: string, topicTag: string): ProgressRow | null {
    try {
      var rows = nk.storageRead([{ collection: COLLECTION, key: key(topicTag), userId: userId }]);
      if (rows && rows.length > 0) return rows[0].value as ProgressRow;
    } catch (_) { }
    return null;
  }

  function write(nk: nkruntime.Nakama, userId: string, row: ProgressRow): void {
    row.last_updated = nowSec();
    nk.storageWrite([{
      collection: COLLECTION,
      key: key(row.topic_tag),
      userId: userId,
      value: row,
      permissionRead: 1,
      permissionWrite: 0,
    }]);
  }

  export function recordVideoCheck(nk: nkruntime.Nakama, userId: string, topicTag: string, videoIndex: number, correct: number, total: number): ProgressRow {
    var row = read(nk, userId, topicTag);
    if (!row) {
      row = { topic_tag: topicTag, user_id: userId, checks: [], last_updated: 0, amoe_unlocked: false };
    }
    var passed = (correct / Math.max(1, total)) >= 0.6;  // 3/5 = pass
    // Upsert by video_index (replace if exists)
    var replaced = false;
    for (var i = 0; i < row.checks.length; i++) {
      if (row.checks[i].video_index === videoIndex) {
        row.checks[i] = { video_index: videoIndex, correct: correct, total: total, completed_at: nowSec(), passed: passed };
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      row.checks.push({ video_index: videoIndex, correct: correct, total: total, completed_at: nowSec(), passed: passed });
    }
    // Re-evaluate AMOE unlock: 6 passed checks → unlocked.
    var passedCount = 0;
    for (var j = 0; j < row.checks.length; j++) {
      if (row.checks[j].passed) passedCount++;
    }
    row.amoe_unlocked = passedCount >= 6;
    write(nk, userId, row);
    return row;
  }

  export function getProgress(nk: nkruntime.Nakama, userId: string, topicTag: string): ProgressRow {
    var row = read(nk, userId, topicTag);
    if (row) return row;
    return { topic_tag: topicTag, user_id: userId, checks: [], last_updated: 0, amoe_unlocked: false };
  }

  export function hasUnlockedAmoe(nk: nkruntime.Nakama, userId: string, topicTag: string, requiredVideos: number): boolean {
    var row = read(nk, userId, topicTag);
    if (!row) return false;
    if (row.amoe_unlocked) return true;
    // Defensive: if amoe_unlocked is false but actual passed count meets
    // requiredVideos, still allow it (handles a stale row).
    var passed = 0;
    for (var i = 0; i < row.checks.length; i++) if (row.checks[i].passed) passed++;
    return passed >= requiredVideos;
  }
}
