/**
 * library-countdown.ts — Top Learners Library exam-countdown subscriptions.
 *
 * Spec lives in the Quizverse-web-frontend repo at QUIZVERSE_LIBRARY_10X_PLAN.md §4.7.
 * Mirrors the runtime contract in `web/lib/library/exam-countdown.ts`.
 *
 * NOTE on file format:
 *   The repo policy (see .gitignore L745-L746) explicitly blocks
 *   `data/modules/*.lua` files from being committed — the TS source at
 *   `data/modules/src/**` is the only source of truth, and the runtime
 *   loads `data/modules/build/index.js` produced by the TS build.
 *   This file is the canonical home for the 4 RPCs. A reference Lua
 *   transliteration exists at `data/modules/library_countdown.lua` for
 *   ops scripts but is intentionally gitignored.
 *
 * RPCs registered:
 *   library.countdown.subscribe     — { exam_id, exam_date, custom?, channels?[], milestones?[] }
 *   library.countdown.unsubscribe   — { exam_id, exam_date }
 *   library.countdown.list_mine     — returns caller's subscriptions with days_remaining
 *   library.countdown.emit_due      — system-only sweep; emits notifications for
 *                                     milestones whose offset matches today's days-to-exam.
 *
 * Storage: collection "library_countdown_subs", key "<exam_id>:<exam_date>".
 * Owner-read + system-read (perm 2), owner-only write (perm 1).
 *
 * Wiring: add `LibraryCountdownPlugin.register(initializer, nk, logger)` to
 * `src/main.ts` next to QuizVersePlugin.register(...). Not done in this commit
 * to keep the bundle rebuild atomic with the rest of the Library mount.
 */

namespace LibraryCountdownPlugin {
  // ---------------------------------------------------------------------------
  // Constants — mirror web/lib/library/exam-countdown.ts
  // ---------------------------------------------------------------------------
  var COLLECTION = "library_countdown_subs";
  var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
  var SECONDS_PER_DAY = 86400;

  interface Milestone { id: string; offset: number; }

  var MILESTONES: Milestone[] = [
    { id: "d-90", offset: 90  },
    { id: "d-60", offset: 60  },
    { id: "d-30", offset: 30  },
    { id: "d-14", offset: 14  },
    { id: "d-7",  offset: 7   },
    { id: "d-3",  offset: 3   },
    { id: "d-1",  offset: 1   },
    { id: "d0",   offset: 0   },
    { id: "d+1",  offset: -1  },
    { id: "d+7",  offset: -7  },
    { id: "d+30", offset: -30 },
  ];

  var DEFAULT_CHANNELS  : string[] = ["push", "inapp", "email"];
  var DEFAULT_MILESTONES: string[] = ["d-30", "d-7", "d-1", "d0"];

  interface SubRecord {
    exam_id:      string;
    exam_date:    string;
    custom:       boolean;
    channels:     string[];
    milestones:   string[];
    created_at:   number;
    last_emitted: { [milestoneId: string]: number };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function nakamaError(msg: string, code: number): nkruntime.Error {
    return { message: msg, code: code };
  }

  function parseIsoDate(iso: string): number | null {
    if (typeof iso !== "string" || iso.length < 10) return null;
    // Expect "YYYY-MM-DD"; rest is ignored.
    var year  = parseInt(iso.substr(0, 4), 10);
    var month = parseInt(iso.substr(5, 2), 10);
    var day   = parseInt(iso.substr(8, 2), 10);
    if (!year || !month || !day) return null;
    // Date.UTC returns ms; convert to seconds-since-epoch like Lua's os.time().
    return Math.floor(Date.UTC(year, month - 1, day) / 1000);
  }

  function subKey(examId: string, examDate: string): string {
    return examId + ":" + examDate;
  }

  function parseJson(payload: string): any {
    try { return JSON.parse(payload || "{}"); } catch (_e) { return null; }
  }

  // ---------------------------------------------------------------------------
  // RPC: library.countdown.subscribe
  // ---------------------------------------------------------------------------
  var rpcSubscribe: nkruntime.RpcFunction = function (ctx, logger, nk, payload) {
    if (!ctx.userId) throw nakamaError("unauthenticated", nkruntime.Codes.UNAUTHENTICATED);
    var data = parseJson(payload);
    if (!data || !data.exam_id || !data.exam_date) {
      throw nakamaError("exam_id and exam_date are required", nkruntime.Codes.INVALID_ARGUMENT);
    }
    if (parseIsoDate(String(data.exam_date)) === null) {
      throw nakamaError("exam_date must be ISO YYYY-MM-DD", nkruntime.Codes.INVALID_ARGUMENT);
    }

    var record: SubRecord = {
      exam_id:      String(data.exam_id),
      exam_date:    String(data.exam_date),
      custom:       data.custom === true,
      channels:     (data.channels && data.channels.length)     ? data.channels     : DEFAULT_CHANNELS,
      milestones:   (data.milestones && data.milestones.length) ? data.milestones   : DEFAULT_MILESTONES,
      created_at:   Math.floor(Date.now() / 1000),
      last_emitted: {},
    };

    nk.storageWrite([{
      collection:      COLLECTION,
      key:             subKey(record.exam_id, record.exam_date),
      userId:          ctx.userId,
      value:           record as unknown as { [key: string]: any },
      permissionRead:  2,
      permissionWrite: 1,
    }]);
    return JSON.stringify({ success: true, subscription: record });
  };

  // ---------------------------------------------------------------------------
  // RPC: library.countdown.unsubscribe
  // ---------------------------------------------------------------------------
  var rpcUnsubscribe: nkruntime.RpcFunction = function (ctx, logger, nk, payload) {
    if (!ctx.userId) throw nakamaError("unauthenticated", nkruntime.Codes.UNAUTHENTICATED);
    var data = parseJson(payload);
    if (!data || !data.exam_id || !data.exam_date) {
      throw nakamaError("exam_id and exam_date are required", nkruntime.Codes.INVALID_ARGUMENT);
    }
    nk.storageDelete([{
      collection: COLLECTION,
      key:        subKey(String(data.exam_id), String(data.exam_date)),
      userId:     ctx.userId,
    }]);
    return JSON.stringify({ success: true });
  };

  // ---------------------------------------------------------------------------
  // RPC: library.countdown.list_mine
  // ---------------------------------------------------------------------------
  var rpcListMine: nkruntime.RpcFunction = function (ctx, logger, nk, _payload) {
    if (!ctx.userId) throw nakamaError("unauthenticated", nkruntime.Codes.UNAUTHENTICATED);
    var page = nk.storageList(ctx.userId, COLLECTION, 100, "");
    var now = Math.floor(Date.now() / 1000);
    var out: any[] = [];
    var records = page.objects || [];
    for (var i = 0; i < records.length; i++) {
      var v = records[i].value as unknown as SubRecord;
      if (!v) continue;
      var examTs = parseIsoDate(v.exam_date);
      var daysRemaining: number | null = (examTs !== null) ? Math.floor((examTs - now) / SECONDS_PER_DAY) : null;
      out.push({
        exam_id:        v.exam_id,
        exam_date:      v.exam_date,
        custom:         v.custom === true,
        channels:       v.channels   || DEFAULT_CHANNELS,
        milestones:     v.milestones || DEFAULT_MILESTONES,
        days_remaining: daysRemaining,
      });
    }
    return JSON.stringify({ success: true, subscriptions: out });
  };

  // ---------------------------------------------------------------------------
  // RPC: library.countdown.emit_due — system-only sweep
  // ---------------------------------------------------------------------------
  var rpcEmitDue: nkruntime.RpcFunction = function (ctx, logger, nk, _payload) {
    if (ctx.userId && ctx.userId !== "" && ctx.userId !== SYSTEM_USER_ID) {
      throw nakamaError("system-only", nkruntime.Codes.PERMISSION_DENIED);
    }
    var now = Math.floor(Date.now() / 1000);
    var scanned = 0, emitted = 0;
    var cursor = "";
    do {
      var page = nk.storageList(null, COLLECTION, 200, cursor);
      cursor = page.cursor || "";
      var records = page.objects || [];
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        var v = r.value as unknown as SubRecord;
        if (!v) continue;
        scanned++;
        var examTs = parseIsoDate(v.exam_date);
        if (examTs === null) continue;
        var daysTo = Math.floor((examTs - now) / SECONDS_PER_DAY);
        var wantSet: { [k: string]: boolean } = {};
        var wants = v.milestones || DEFAULT_MILESTONES;
        for (var w = 0; w < wants.length; w++) wantSet[wants[w]] = true;
        for (var m = 0; m < MILESTONES.length; m++) {
          var ms = MILESTONES[m];
          var lastEmitted = v.last_emitted || {};
          if (wantSet[ms.id] && daysTo === ms.offset && !lastEmitted[ms.id]) {
            nk.notificationSend(
              r.userId,
              "Exam countdown — " + v.exam_id,
              { milestone: ms.id, exam_id: v.exam_id, exam_date: v.exam_date, days_to: daysTo },
              1001,
              "",
              false,
            );
            v.last_emitted = lastEmitted;
            v.last_emitted[ms.id] = now;
            nk.storageWrite([{
              collection: COLLECTION,
              key:        r.key,
              userId:     r.userId,
              value:      v as unknown as { [key: string]: any },
              version:    r.version,
            }]);
            emitted++;
          }
        }
      }
    } while (cursor !== "");
    logger.info("[library_countdown] emit_due scanned=" + scanned + " emitted=" + emitted);
    return JSON.stringify({ success: true, scanned: scanned, emitted: emitted });
  };

  // ---------------------------------------------------------------------------
  // register — call from src/main.ts after the multiplayer kernel mounts.
  // ---------------------------------------------------------------------------
  export function register(initializer: nkruntime.Initializer, _nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
    initializer.registerRpc("library.countdown.subscribe",   rpcSubscribe);
    initializer.registerRpc("library.countdown.unsubscribe", rpcUnsubscribe);
    initializer.registerRpc("library.countdown.list_mine",   rpcListMine);
    initializer.registerRpc("library.countdown.emit_due",    rpcEmitDue);
    logger.info("[LibraryCountdown] 4 RPCs registered (subscribe/unsubscribe/list_mine/emit_due)");
  }
}
