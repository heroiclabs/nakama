// tutorx_progress.ts — Server-authoritative TutorX gamification
// (XP, daily streak with freeze, and idempotent daily-quest claims).
//
// Replaces the previously client-only (localStorage) streak/XP/quest logic in
// the TutorX web SPA. The web client calls these RPCs with `?unwrap`, so every
// handler returns a FLAT JSON object (NOT the {success,data} envelope) whose
// keys match what the SPA reads: res.xp, res.streak, res.streakDate, etc.
//
// RPCs:
//   tutorx_xp_get      → { xp, streak, streakDate, level, freezes }
//   tutorx_xp_add      → { xp, added, level }            payload: { delta }
//   tutorx_streak_touch→ { streak, streakDate, freezes, frozen }
//   tutorx_quest_claim → { claimed, alreadyClaimed, quest, xp, xpAwarded,
//                          questsToday, streak, streakDate }
//                        payload: { quest: "showup"|"ask"|"practice" }
//
// State is stored in ONE record (collection `tutorx_progress`, key `state`) per
// user so streak/XP/quests stay consistent. Optimistic concurrency via the
// storage `version` field prevents lost updates under concurrent calls.
namespace TutorXProgress {

  const COLLECTION = "tutorx_progress";
  const STATE_KEY = "state";

  // XP awarded per quest, enforced SERVER-SIDE (clients cannot inflate).
  const QUEST_XP: { [id: string]: number } = {
    showup: 20,
    ask: 15,
    practice: 15,
  };

  // Anti-abuse: cap a single tutorx_xp_add delta. Quests don't go through
  // xp_add (they use quest_claim), so this only covers misc client XP events.
  const MAX_XP_DELTA = 200;

  // Streak-freeze economy: every user starts with 1 freeze; they earn another
  // each time their streak crosses a 7-day milestone, capped at MAX_FREEZES.
  const START_FREEZES = 1;
  const MAX_FREEZES = 3;
  const FREEZE_MILESTONE = 7;

  interface QuestDay {
    date: string;                       // YYYY-MM-DD this quest-set belongs to
    claimed: { [id: string]: boolean }; // quest id → claimed today
  }

  interface State {
    xp: number;
    streak: number;
    streakDate: string;                 // YYYY-MM-DD of last counted day
    freezes: number;
    lastFreezeMilestone: number;        // highest 7-multiple already rewarded
    quests: QuestDay;
  }

  interface LoadedState {
    state: State;
    version: string | undefined;
  }

  // ─── Date helpers (UTC ISO day, matches the web client's slice(0,10)) ──
  function today(): string {
    return new Date().toISOString().slice(0, 10);
  }
  function addDays(isoDay: string, n: number): string {
    var d = new Date(isoDay + "T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function defaultState(): State {
    return {
      xp: 0,
      streak: 0,
      streakDate: "",
      freezes: START_FREEZES,
      lastFreezeMilestone: 0,
      quests: { date: "", claimed: {} },
    };
  }

  function load(nk: nkruntime.Nakama, userId: string): LoadedState {
    try {
      var records = nk.storageRead([{ collection: COLLECTION, key: STATE_KEY, userId: userId }]);
      if (records && records.length > 0 && records[0].value) {
        var v = records[0].value as Partial<State>;
        var s = defaultState();
        if (typeof v.xp === "number") s.xp = v.xp;
        if (typeof v.streak === "number") s.streak = v.streak;
        if (typeof v.streakDate === "string") s.streakDate = v.streakDate;
        if (typeof v.freezes === "number") s.freezes = v.freezes;
        if (typeof v.lastFreezeMilestone === "number") s.lastFreezeMilestone = v.lastFreezeMilestone;
        if (v.quests && typeof v.quests === "object") {
          s.quests.date = typeof v.quests.date === "string" ? v.quests.date : "";
          s.quests.claimed = (v.quests.claimed && typeof v.quests.claimed === "object") ? v.quests.claimed : {};
        }
        return { state: s, version: records[0].version };
      }
    } catch (_) {
      // fall through to default
    }
    return { state: defaultState(), version: undefined };
  }

  function save(nk: nkruntime.Nakama, userId: string, state: State, version: string | undefined): void {
    var write: nkruntime.StorageWriteRequest = {
      collection: COLLECTION,
      key: STATE_KEY,
      userId: userId,
      value: state as any,
      permissionRead: 1,   // owner can read their own progress
      permissionWrite: 0,  // server-only writes
    };
    // Optimistic concurrency: only attach version when we actually read one,
    // so the very first write (no prior record) isn't rejected.
    if (version) (write as any).version = version;
    nk.storageWrite([write]);
  }

  // Roll the quest-day forward if it belongs to a previous day.
  function rollQuests(state: State, day: string): void {
    if (state.quests.date !== day) {
      state.quests = { date: day, claimed: {} };
    }
  }

  // Grant freeze tokens for any 7-day milestones crossed since last grant.
  function grantFreezeMilestones(state: State): void {
    var milestone = Math.floor(state.streak / FREEZE_MILESTONE) * FREEZE_MILESTONE;
    if (milestone > state.lastFreezeMilestone) {
      var steps = (milestone - state.lastFreezeMilestone) / FREEZE_MILESTONE;
      for (var i = 0; i < steps && state.freezes < MAX_FREEZES; i++) {
        state.freezes++;
      }
      state.lastFreezeMilestone = milestone;
    }
  }

  // Advance the streak for "activity happened today". Returns whether a freeze
  // was consumed to bridge a missed day. Mutates state in place.
  function touchStreak(state: State, day: string): boolean {
    var frozen = false;
    if (state.streakDate === day) {
      // Already counted today — no change.
      return false;
    }
    if (!state.streakDate) {
      // First ever activity.
      state.streak = 1;
    } else if (addDays(state.streakDate, 1) === day) {
      // Consecutive day.
      state.streak = state.streak + 1;
    } else {
      // Missed one or more days. A single freeze bridges exactly one gap day;
      // we consume one if available and the gap is recoverable, else reset.
      if (state.freezes > 0) {
        state.freezes--;
        state.streak = state.streak + 1;
        frozen = true;
      } else {
        state.streak = 1;
      }
    }
    state.streakDate = day;
    grantFreezeMilestones(state);
    return frozen;
  }

  function levelForXp(xp: number): number {
    // Mirror-ish of the web's level curve; informational only (client computes
    // its own). Simple sqrt curve: level grows with total XP.
    if (xp <= 0) return 1;
    return Math.floor(Math.sqrt(xp / 100)) + 1;
  }

  // ─── RPC: tutorx_xp_get ──────────────────────────────────────────────
  function rpcXpGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var loaded = load(nk, userId);
    var s = loaded.state;
    return JSON.stringify({
      xp: s.xp,
      streak: s.streak,
      streakDate: s.streakDate,
      freezes: s.freezes,
      level: levelForXp(s.xp),
    });
  }

  // ─── RPC: tutorx_xp_add ──────────────────────────────────────────────
  function rpcXpAdd(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);

    var delta = 0;
    if (typeof data.delta === "number" && isFinite(data.delta)) {
      delta = Math.floor(data.delta);
    }
    // Only positive, capped deltas are honoured. Negative/zero → no-op (but we
    // still return the authoritative total so the client can reconcile).
    if (delta < 0) delta = 0;
    if (delta > MAX_XP_DELTA) delta = MAX_XP_DELTA;

    var loaded = load(nk, userId);
    var s = loaded.state;
    if (delta > 0) {
      s.xp = s.xp + delta;
      try {
        save(nk, userId, s, loaded.version);
      } catch (err: any) {
        logger.warn("[TutorXProgress] xp_add save failed: " + (err && err.message ? err.message : String(err)));
      }
    }
    return JSON.stringify({ xp: s.xp, added: delta, level: levelForXp(s.xp) });
  }

  // ─── RPC: tutorx_streak_touch ────────────────────────────────────────
  function rpcStreakTouch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var day = today();
    var loaded = load(nk, userId);
    var s = loaded.state;
    var frozen = touchStreak(s, day);
    try {
      save(nk, userId, s, loaded.version);
    } catch (err: any) {
      logger.warn("[TutorXProgress] streak_touch save failed: " + (err && err.message ? err.message : String(err)));
    }
    return JSON.stringify({
      streak: s.streak,
      streakDate: s.streakDate,
      freezes: s.freezes,
      frozen: frozen,
    });
  }

  // ─── RPC: tutorx_quest_claim ─────────────────────────────────────────
  // Idempotent per (user, quest, day). Awards server-enforced XP on FIRST claim
  // only, and also touches the streak (claiming a quest is real daily activity).
  function rpcQuestClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);

    var quest = typeof data.quest === "string" ? data.quest : "";
    if (!QUEST_XP.hasOwnProperty(quest)) {
      // Flat error (no throw) so anonymous/buggy callers don't get a goja
      // stack trace + HTTP 500; the client just treats it as a no-op.
      return JSON.stringify({ claimed: false, alreadyClaimed: false, quest: quest, error: "unknown_quest" });
    }

    var day = today();
    var loaded = load(nk, userId);
    var s = loaded.state;
    rollQuests(s, day);

    var already = s.quests.claimed[quest] === true;
    var xpAwarded = 0;
    if (!already) {
      s.quests.claimed[quest] = true;
      xpAwarded = QUEST_XP[quest];
      s.xp = s.xp + xpAwarded;
      // Completing a quest is genuine daily activity → keep the streak alive.
      touchStreak(s, day);
    }

    try {
      save(nk, userId, s, loaded.version);
    } catch (err: any) {
      logger.warn("[TutorXProgress] quest_claim save failed: " + (err && err.message ? err.message : String(err)));
    }

    return JSON.stringify({
      claimed: !already,
      alreadyClaimed: already,
      quest: quest,
      xp: s.xp,
      xpAwarded: xpAwarded,
      questsToday: s.quests.claimed,
      streak: s.streak,
      streakDate: s.streakDate,
      freezes: s.freezes,
      level: levelForXp(s.xp),
    });
  }

  // ─── Registration ────────────────────────────────────────────────────
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("tutorx_xp_get", RpcHelpers.withCleanAuthError(rpcXpGet));
    initializer.registerRpc("tutorx_xp_add", RpcHelpers.withCleanAuthError(rpcXpAdd));
    initializer.registerRpc("tutorx_streak_touch", RpcHelpers.withCleanAuthError(rpcStreakTouch));
    initializer.registerRpc("tutorx_quest_claim", RpcHelpers.withCleanAuthError(rpcQuestClaim));
  }
}
