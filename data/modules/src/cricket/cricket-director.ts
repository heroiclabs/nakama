/**
 * Cricket Director — Nakama server module
 *
 * Enforces single-active session per player for the AI Director game mode.
 * Supports save / resume / end flows so players can leave and return
 * to the exact same game state.
 *
 * Storage: CRICKET_DIRECTOR_COLLECTION  (one key per userId)
 *
 * RPCs:
 *   cricket_director_start_session   — start or resume a session
 *   cricket_director_save_session    — checkpoint current state
 *   cricket_director_end_session     — explicitly finish a session
 *   cricket_director_get_session     — read current session (if any)
 *   cricket_director_list_history    — past completed sessions
 */

// ─────────────────────────────── Interfaces ──────────────────────────────────

interface DirectorSessionState {
  sessionId: string;
  userId: string;
  status: "active" | "paused" | "completed" | "abandoned";
  gameMode: string;
  fixtureId: string;
  matchContext: {
    battingTeamId: string;
    bowlingTeamId: string;
    innings: number;
    overs: number;
    balls: number;
    score: number;
    wickets: number;
  };
  directorState: {
    commentaryQueue: string[];
    soundManifestVersion: string;
    difficultyLevel: number;
    aiPersonality: string;
    lastDecisionTimestamp: string;
  };
  checkpoints: Array<{
    timestamp: string;
    label: string;
    stateSnapshot: any;
  }>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  totalPlayTimeSec: number;
  lastActiveAt: string;
}

interface DirectorHistoryEntry {
  sessionId: string;
  gameMode: string;
  fixtureId: string;
  finalScore: string;
  totalPlayTimeSec: number;
  completedAt: string;
}

// ─────────────────────────────── Constants ────────────────────────────────────

var HISTORY_COLLECTION = "cricket_director_history";
var SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min inactivity → auto-pause

// ─────────────────────────────── Helpers ──────────────────────────────────────

function generateSessionId(): string {
  var ts = Date.now().toString(36);
  var rand = Math.random().toString(36).substring(2, 8);
  return "dir_" + ts + "_" + rand;
}

function readSession(nk: nkruntime.Nakama, userId: string): DirectorSessionState | null {
  return Storage.readJson<DirectorSessionState>(
    nk,
    Constants.CRICKET_DIRECTOR_COLLECTION,
    "active_session",
    userId,
  );
}

function writeSession(nk: nkruntime.Nakama, userId: string, session: DirectorSessionState): void {
  session.updatedAt = new Date().toISOString();
  session.lastActiveAt = session.updatedAt;
  Storage.writeJson(
    nk,
    Constants.CRICKET_DIRECTOR_COLLECTION,
    "active_session",
    userId,
    session,
    2, // owner-read + public-read
    1, // owner-write only
  );
}

function deleteSession(nk: nkruntime.Nakama, userId: string): void {
  Storage.deleteRecord(nk, Constants.CRICKET_DIRECTOR_COLLECTION, "active_session", userId);
}

function archiveSession(nk: nkruntime.Nakama, userId: string, session: DirectorSessionState): void {
  var entry: DirectorHistoryEntry = {
    sessionId: session.sessionId,
    gameMode: session.gameMode,
    fixtureId: session.fixtureId,
    finalScore: session.matchContext.score + "/" + session.matchContext.wickets,
    totalPlayTimeSec: session.totalPlayTimeSec,
    completedAt: session.completedAt || new Date().toISOString(),
  };
  Storage.writeJson(nk, HISTORY_COLLECTION, session.sessionId, userId, entry, 2, 1);
}

function isTimedOut(session: DirectorSessionState): boolean {
  var lastActive = new Date(session.lastActiveAt).getTime();
  return Date.now() - lastActive > SESSION_TIMEOUT_MS;
}

// ─────────────────────────────── RPC: Start Session ──────────────────────────

function rpcStartSession(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string,
): string {
  var userId = RpcHelpers.requireUserId(ctx);
  var data = RpcHelpers.parseRpcPayload(payload);

  var existing = readSession(nk, userId);
  if (existing) {
    if (existing.status === "active" && !isTimedOut(existing)) {
      return RpcHelpers.successResponse({
        resumed: true,
        message: "Existing active session resumed",
        session: existing,
      });
    }
    if (existing.status === "active" && isTimedOut(existing)) {
      existing.status = "paused";
      writeSession(nk, userId, existing);
      logger.info("[CricketDirector] Auto-paused timed-out session: " + existing.sessionId);
    }
    if (existing.status === "paused") {
      existing.status = "active";
      writeSession(nk, userId, existing);
      logger.info("[CricketDirector] Resumed paused session: " + existing.sessionId);
      return RpcHelpers.successResponse({
        resumed: true,
        message: "Paused session resumed",
        session: existing,
      });
    }
    // abandoned or completed — archive and allow new
    archiveSession(nk, userId, existing);
    deleteSession(nk, userId);
  }

  // Create new session
  var validation = RpcHelpers.validatePayload(data, ["gameMode", "fixtureId"]);
  if (!validation.valid) {
    return RpcHelpers.errorResponse("New session requires: " + validation.missing.join(", "));
  }

  var now = new Date().toISOString();
  var session: DirectorSessionState = {
    sessionId: generateSessionId(),
    userId: userId,
    status: "active",
    gameMode: data.gameMode,
    fixtureId: data.fixtureId,
    matchContext: {
      battingTeamId: data.battingTeamId || "",
      bowlingTeamId: data.bowlingTeamId || "",
      innings: 1,
      overs: 0,
      balls: 0,
      score: 0,
      wickets: 0,
    },
    directorState: {
      commentaryQueue: [],
      soundManifestVersion: data.soundManifestVersion || "v1",
      difficultyLevel: data.difficultyLevel || 3,
      aiPersonality: data.aiPersonality || "neutral",
      lastDecisionTimestamp: now,
    },
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    totalPlayTimeSec: 0,
    lastActiveAt: now,
  };

  writeSession(nk, userId, session);

  EventBus.emit(nk, logger, ctx, EventBus.Events.SESSION_START, {
    gameId: "cricket_director",
    sessionId: session.sessionId,
    gameMode: session.gameMode,
    fixtureId: session.fixtureId,
  });

  logger.info("[CricketDirector] New session: " + session.sessionId + " for user " + userId);
  return RpcHelpers.successResponse({ resumed: false, message: "New session created", session: session });
}

// ─────────────────────────────── RPC: Save Session ───────────────────────────

function rpcSaveSession(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string,
): string {
  var userId = RpcHelpers.requireUserId(ctx);
  var data = RpcHelpers.parseRpcPayload(payload);

  var session = readSession(nk, userId);
  if (!session) return RpcHelpers.errorResponse("No active session found");
  if (session.status !== "active") return RpcHelpers.errorResponse("Session is not active (status: " + session.status + ")");

  // Merge matchContext updates
  if (data.matchContext) {
    var mc = session.matchContext;
    var incoming = data.matchContext;
    if (incoming.innings !== undefined) mc.innings = incoming.innings;
    if (incoming.overs !== undefined) mc.overs = incoming.overs;
    if (incoming.balls !== undefined) mc.balls = incoming.balls;
    if (incoming.score !== undefined) mc.score = incoming.score;
    if (incoming.wickets !== undefined) mc.wickets = incoming.wickets;
    if (incoming.battingTeamId) mc.battingTeamId = incoming.battingTeamId;
    if (incoming.bowlingTeamId) mc.bowlingTeamId = incoming.bowlingTeamId;
  }

  // Merge directorState updates
  if (data.directorState) {
    var ds = session.directorState;
    var incDs = data.directorState;
    if (incDs.commentaryQueue) ds.commentaryQueue = incDs.commentaryQueue;
    if (incDs.difficultyLevel !== undefined) ds.difficultyLevel = incDs.difficultyLevel;
    if (incDs.aiPersonality) ds.aiPersonality = incDs.aiPersonality;
    ds.lastDecisionTimestamp = new Date().toISOString();
  }

  // Add checkpoint if label provided
  if (data.checkpointLabel) {
    session.checkpoints.push({
      timestamp: new Date().toISOString(),
      label: data.checkpointLabel,
      stateSnapshot: { matchContext: session.matchContext },
    });
    if (session.checkpoints.length > 20) {
      session.checkpoints = session.checkpoints.slice(-20);
    }
  }

  if (data.playTimeDelta) {
    session.totalPlayTimeSec += data.playTimeDelta;
  }

  writeSession(nk, userId, session);
  logger.info("[CricketDirector] Session saved: " + session.sessionId);
  return RpcHelpers.successResponse({ saved: true, sessionId: session.sessionId, checkpoints: session.checkpoints.length });
}

// ─────────────────────────────── RPC: End Session ────────────────────────────

function rpcEndSession(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string,
): string {
  var userId = RpcHelpers.requireUserId(ctx);
  var data = RpcHelpers.parseRpcPayload(payload);

  var session = readSession(nk, userId);
  if (!session) return RpcHelpers.errorResponse("No active session found");

  var reason: string = data.reason || "player_ended";

  if (data.matchContext) {
    var mc = session.matchContext;
    var fin = data.matchContext;
    if (fin.score !== undefined) mc.score = fin.score;
    if (fin.wickets !== undefined) mc.wickets = fin.wickets;
    if (fin.overs !== undefined) mc.overs = fin.overs;
  }

  session.status = reason === "abandoned" ? "abandoned" : "completed";
  session.completedAt = new Date().toISOString();
  if (data.playTimeDelta) session.totalPlayTimeSec += data.playTimeDelta;

  archiveSession(nk, userId, session);
  deleteSession(nk, userId);

  EventBus.emit(nk, logger, ctx, EventBus.Events.SESSION_END, {
    gameId: "cricket_director",
    sessionId: session.sessionId,
    reason: reason,
    totalPlayTimeSec: session.totalPlayTimeSec,
    finalScore: session.matchContext.score + "/" + session.matchContext.wickets,
  });

  logger.info("[CricketDirector] Session ended: " + session.sessionId + " (" + reason + ")");
  return RpcHelpers.successResponse({
    ended: true,
    sessionId: session.sessionId,
    finalScore: session.matchContext.score + "/" + session.matchContext.wickets,
    totalPlayTimeSec: session.totalPlayTimeSec,
  });
}

// ─────────────────────────────── RPC: Get Session ────────────────────────────

function rpcGetSession(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string,
): string {
  var userId = RpcHelpers.requireUserId(ctx);
  var session = readSession(nk, userId);
  if (!session) {
    return RpcHelpers.successResponse({ hasActiveSession: false, session: null });
  }

  if (session.status === "active" && isTimedOut(session)) {
    session.status = "paused";
    writeSession(nk, userId, session);
  }

  return RpcHelpers.successResponse({ hasActiveSession: true, session: session });
}

// ─────────────────────────────── RPC: List History ────────────────────────────

function rpcListHistory(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string,
): string {
  var userId = RpcHelpers.requireUserId(ctx);
  var data = RpcHelpers.parseRpcPayload(payload);
  var limit = data.limit || 20;
  var cursor: string = data.cursor || "";

  var result = Storage.listUserRecords(nk, HISTORY_COLLECTION, userId, limit, cursor);

  var sessions: DirectorHistoryEntry[] = [];
  for (var i = 0; i < result.records.length; i++) {
    sessions.push(result.records[i].value as DirectorHistoryEntry);
  }

  return RpcHelpers.successResponse({
    sessions: sessions,
    cursor: result.cursor || null,
    total: sessions.length,
  });
}

// ─────────────────────────────── Registration ────────────────────────────────

namespace CricketDirector {
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("cricket_director_start_session", rpcStartSession);
    initializer.registerRpc("cricket_director_save_session", rpcSaveSession);
    initializer.registerRpc("cricket_director_end_session", rpcEndSession);
    initializer.registerRpc("cricket_director_get_session", rpcGetSession);
    initializer.registerRpc("cricket_director_list_history", rpcListHistory);
  }
}
