/**
 * Cricket Auction — Nakama server module
 *
 * Provides real-time, server-authoritative IPL-style auction rooms.
 * Each room is identified by {leagueId}_{seasonId} and persists in
 * the CRICKET_AUCTION_COLLECTION storage collection.
 *
 * RPCs:
 *   cricket_auction_create_room   — create / reset an auction room
 *   cricket_auction_get_room      — read current room state
 *   cricket_auction_place_bid     — place a server-validated bid
 *   cricket_auction_next_player   — advance to the next nominated player
 *   cricket_auction_get_events    — paginated event log for replay / UI
 */

// ─────────────────────────────── Interfaces ──────────────────────────────────

interface AuctionBid {
  teamId: string;
  amount: number;
  bidderId: string;
  timestamp: string;
}

interface NominatedPlayer {
  playerId: string;
  playerName: string;
  basePrice: number;
  category: string;
  role: string;
  nationality: string;
}

interface AuctionRoomState {
  leagueId: string;
  seasonId: string;
  status: "waiting" | "active" | "paused" | "completed";
  currentPlayer: NominatedPlayer | null;
  currentBid: AuctionBid | null;
  bidHistory: AuctionBid[];
  soldPlayers: Array<{
    playerId: string;
    playerName: string;
    soldToTeamId: string;
    soldPrice: number;
  }>;
  unsoldPlayers: string[];
  teamBudgets: Record<string, { remaining: number; playersAcquired: number; overseasUsed: number }>;
  round: number;
  createdAt: string;
  updatedAt: string;
}

interface AuctionEventRecord {
  eventId: string;
  roomKey: string;
  type: "room_created" | "bid_placed" | "player_sold" | "player_unsold" | "next_player" | "room_completed";
  data: any;
  userId: string;
  timestamp: string;
}

// ─────────────────────────────── Constants ────────────────────────────────────

const TOTAL_BUDGET = 12_000;
const MAX_PLAYERS = 25;
const MAX_OVERSEAS = 8;

// ─────────────────────────────── Helpers ──────────────────────────────────────

function roomKey(leagueId: string, seasonId: string): string {
  return leagueId.toLowerCase() + "_" + seasonId;
}

function readRoom(nk: nkruntime.Nakama, key: string): AuctionRoomState | null {
  return Storage.readSystemJson<AuctionRoomState>(nk, Constants.CRICKET_AUCTION_COLLECTION, key);
}

function writeRoom(nk: nkruntime.Nakama, key: string, state: AuctionRoomState): void {
  state.updatedAt = new Date().toISOString();
  Storage.writeSystemJson(nk, Constants.CRICKET_AUCTION_COLLECTION, key, state);
}

function appendEvent(nk: nkruntime.Nakama, event: AuctionEventRecord): void {
  Storage.writeSystemJson(nk, Constants.CRICKET_AUCTION_EVENTS_COLLECTION, event.eventId, event);
}

function generateId(): string {
  var ts = Date.now().toString(36);
  var rand = Math.random().toString(36).substring(2, 8);
  return ts + "_" + rand;
}

// ─────────────────────────────── RPC: Create Room ────────────────────────────

function rpcCreateRoom(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string,
): string {
  var data = RpcHelpers.parseRpcPayload(payload);
  var validation = RpcHelpers.validatePayload(data, ["leagueId", "seasonId", "teams"]);
  if (!validation.valid) {
    return RpcHelpers.errorResponse("Missing fields: " + validation.missing.join(", "));
  }

  var key = roomKey(data.leagueId, data.seasonId);
  var existing = readRoom(nk, key);
  if (existing && existing.status === "active") {
    return RpcHelpers.errorResponse("Auction room already active. Pause or complete it first.");
  }

  var budgets: Record<string, { remaining: number; playersAcquired: number; overseasUsed: number }> = {};
  var teams: string[] = data.teams;
  for (var i = 0; i < teams.length; i++) {
    budgets[teams[i]] = { remaining: TOTAL_BUDGET, playersAcquired: 0, overseasUsed: 0 };
  }

  var now = new Date().toISOString();
  var state: AuctionRoomState = {
    leagueId: data.leagueId,
    seasonId: data.seasonId,
    status: "active",
    currentPlayer: null,
    currentBid: null,
    bidHistory: [],
    soldPlayers: [],
    unsoldPlayers: [],
    teamBudgets: budgets,
    round: 1,
    createdAt: now,
    updatedAt: now,
  };

  writeRoom(nk, key, state);

  appendEvent(nk, {
    eventId: generateId(),
    roomKey: key,
    type: "room_created",
    data: { teams: teams, round: 1 },
    userId: ctx.userId || "",
    timestamp: now,
  });

  logger.info("[CricketAuction] Room created: " + key + " with " + teams.length + " teams");
  return RpcHelpers.successResponse({ roomKey: key, status: "active", teams: teams.length });
}

// ─────────────────────────────── RPC: Get Room ───────────────────────────────

function rpcGetRoom(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string,
): string {
  var data = RpcHelpers.parseRpcPayload(payload);
  var validation = RpcHelpers.validatePayload(data, ["leagueId", "seasonId"]);
  if (!validation.valid) {
    return RpcHelpers.errorResponse("Missing fields: " + validation.missing.join(", "));
  }

  var state = readRoom(nk, roomKey(data.leagueId, data.seasonId));
  if (!state) {
    return RpcHelpers.errorResponse("Auction room not found");
  }

  return RpcHelpers.successResponse(state);
}

// ─────────────────────────────── RPC: Place Bid ──────────────────────────────

function rpcPlaceBid(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string,
): string {
  var userId = RpcHelpers.requireUserId(ctx);
  var data = RpcHelpers.parseRpcPayload(payload);
  var validation = RpcHelpers.validatePayload(data, ["leagueId", "seasonId", "teamId", "amount"]);
  if (!validation.valid) {
    return RpcHelpers.errorResponse("Missing fields: " + validation.missing.join(", "));
  }

  var key = roomKey(data.leagueId, data.seasonId);
  var state = readRoom(nk, key);
  if (!state) return RpcHelpers.errorResponse("Auction room not found");
  if (state.status !== "active") return RpcHelpers.errorResponse("Auction is not active (status: " + state.status + ")");
  if (!state.currentPlayer) return RpcHelpers.errorResponse("No player currently nominated");

  var budget = state.teamBudgets[data.teamId];
  if (!budget) return RpcHelpers.errorResponse("Team not in this auction: " + data.teamId);

  var amount: number = data.amount;
  var minBid = state.currentBid ? state.currentBid.amount + 5 : state.currentPlayer.basePrice;
  if (amount < minBid) return RpcHelpers.errorResponse("Bid must be at least " + minBid);
  if (amount > budget.remaining) return RpcHelpers.errorResponse("Exceeds remaining budget (" + budget.remaining + ")");
  if (budget.playersAcquired >= MAX_PLAYERS) return RpcHelpers.errorResponse("Squad full (25 players)");

  var now = new Date().toISOString();
  var bid: AuctionBid = { teamId: data.teamId, amount: amount, bidderId: userId, timestamp: now };

  state.currentBid = bid;
  state.bidHistory.push(bid);
  writeRoom(nk, key, state);

  appendEvent(nk, {
    eventId: generateId(),
    roomKey: key,
    type: "bid_placed",
    data: { teamId: data.teamId, playerId: state.currentPlayer.playerId, amount: amount },
    userId: userId,
    timestamp: now,
  });

  logger.info("[CricketAuction] Bid: " + data.teamId + " → " + amount + " for " + state.currentPlayer.playerName);
  return RpcHelpers.successResponse({
    accepted: true,
    currentBid: bid,
    budgetRemaining: budget.remaining - amount,
  });
}

// ─────────────────────────────── RPC: Next Player ────────────────────────────

function rpcNextPlayer(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string,
): string {
  var data = RpcHelpers.parseRpcPayload(payload);
  var validation = RpcHelpers.validatePayload(data, ["leagueId", "seasonId"]);
  if (!validation.valid) {
    return RpcHelpers.errorResponse("Missing fields: " + validation.missing.join(", "));
  }

  var key = roomKey(data.leagueId, data.seasonId);
  var state = readRoom(nk, key);
  if (!state) return RpcHelpers.errorResponse("Auction room not found");
  if (state.status !== "active") return RpcHelpers.errorResponse("Auction is not active");

  var now = new Date().toISOString();

  // Resolve current player if there was one
  if (state.currentPlayer) {
    if (state.currentBid) {
      var winTeam = state.currentBid.teamId;
      var winAmount = state.currentBid.amount;
      state.soldPlayers.push({
        playerId: state.currentPlayer.playerId,
        playerName: state.currentPlayer.playerName,
        soldToTeamId: winTeam,
        soldPrice: winAmount,
      });
      state.teamBudgets[winTeam].remaining -= winAmount;
      state.teamBudgets[winTeam].playersAcquired++;

      appendEvent(nk, {
        eventId: generateId(),
        roomKey: key,
        type: "player_sold",
        data: { playerId: state.currentPlayer.playerId, teamId: winTeam, price: winAmount },
        userId: ctx.userId || "",
        timestamp: now,
      });

      logger.info("[CricketAuction] SOLD: " + state.currentPlayer.playerName + " → " + winTeam + " @ " + winAmount);
    } else {
      state.unsoldPlayers.push(state.currentPlayer.playerId);
      appendEvent(nk, {
        eventId: generateId(),
        roomKey: key,
        type: "player_unsold",
        data: { playerId: state.currentPlayer.playerId },
        userId: ctx.userId || "",
        timestamp: now,
      });
      logger.info("[CricketAuction] UNSOLD: " + state.currentPlayer.playerName);
    }
  }

  // Nominate next player (from payload or null to complete)
  if (data.nextPlayer) {
    var np: NominatedPlayer = {
      playerId: data.nextPlayer.playerId,
      playerName: data.nextPlayer.playerName || data.nextPlayer.playerId,
      basePrice: data.nextPlayer.basePrice || 20,
      category: data.nextPlayer.category || "General",
      role: data.nextPlayer.role || "Unknown",
      nationality: data.nextPlayer.nationality || "",
    };
    state.currentPlayer = np;
    state.currentBid = null;
    state.bidHistory = [];

    appendEvent(nk, {
      eventId: generateId(),
      roomKey: key,
      type: "next_player",
      data: { playerId: np.playerId, basePrice: np.basePrice },
      userId: ctx.userId || "",
      timestamp: now,
    });
  } else {
    state.currentPlayer = null;
    state.currentBid = null;
    state.status = "completed";
    appendEvent(nk, {
      eventId: generateId(),
      roomKey: key,
      type: "room_completed",
      data: { soldCount: state.soldPlayers.length, unsoldCount: state.unsoldPlayers.length },
      userId: ctx.userId || "",
      timestamp: now,
    });
    logger.info("[CricketAuction] Auction completed: " + key);
  }

  writeRoom(nk, key, state);
  return RpcHelpers.successResponse(state);
}

// ─────────────────────────────── RPC: Get Events ─────────────────────────────

function rpcGetEvents(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string,
): string {
  var data = RpcHelpers.parseRpcPayload(payload);
  var validation = RpcHelpers.validatePayload(data, ["leagueId", "seasonId"]);
  if (!validation.valid) {
    return RpcHelpers.errorResponse("Missing fields: " + validation.missing.join(", "));
  }

  var key = roomKey(data.leagueId, data.seasonId);
  var limit = data.limit || 50;
  var cursor: string = data.cursor || "";

  var result = Storage.listUserRecords(
    nk,
    Constants.CRICKET_AUCTION_EVENTS_COLLECTION,
    Constants.SYSTEM_USER_ID,
    limit,
    cursor,
  );

  var events: AuctionEventRecord[] = [];
  for (var i = 0; i < result.records.length; i++) {
    var rec = result.records[i].value as AuctionEventRecord;
    if (rec.roomKey === key) {
      events.push(rec);
    }
  }

  return RpcHelpers.successResponse({
    events: events,
    cursor: result.cursor || null,
    total: events.length,
  });
}

// ─────────────────────────────── Registration ────────────────────────────────

namespace CricketAuction {
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("cricket_auction_create_room", rpcCreateRoom);
    initializer.registerRpc("cricket_auction_get_room", rpcGetRoom);
    initializer.registerRpc("cricket_auction_place_bid", rpcPlaceBid);
    initializer.registerRpc("cricket_auction_next_player", rpcNextPlayer);
    initializer.registerRpc("cricket_auction_get_events", rpcGetEvents);
  }
}
