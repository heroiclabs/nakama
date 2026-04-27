// TournamentOrchestrator — bracket / ladder coordinator template.
//
// Reserved opcode range 0x8000-0x8FFF.
//
// Responsibilities:
//   * Accept registrations during a `REGISTRATION` phase; close on
//     registration_close_unix_ms or capacity hit.
//   * Generate bracket pairings (single-elim by default; mode is opaque
//     so a custom IBracketGenerator can implement double-elim, swiss,
//     round-robin, ladder).
//   * Spawn a round's "leg" matches via `nk.matchCreate(target_template_id, ...)`
//     for each pairing, then poll mp_match_result storage to collect winners.
//   * Advance the bracket round-by-round, broadcasting BRACKET_UPDATED.
//   * On final match: resolve champion, emit TOURNAMENT_RESOLVED, persist.
//
// Match cadence: 1 Hz. We're not running a game, we're polling.
//
// Failure modes covered:
//   * leg_match_failed:  if a spawned leg fails to create -> opponent
//                        wins by walkover; logged in audit trail.
//   * leg_match_timeout: if a leg doesn't write a result within
//                        leg_timeout_ms -> both players are eliminated
//                        (or higher-seed wins; configurable).
//   * registration_short:if fewer than min_players registered at deadline
//                        -> CANCELLED with refund signal in result envelope.

namespace MpKernelTournament {
  export var Op = {
    REGISTER:            0x8000, // client -> server
    REGISTRATION_CLOSED: 0x8001, // server -> all
    BRACKET_UPDATED:     0x8002, // server -> all
    LEG_MATCH_INFO:      0x8003, // server -> participants of a leg
    LEG_MATCH_RESULT:    0x8004, // server -> all
    TOURNAMENT_RESOLVED: 0x8005, // server -> all
    PLAYER_FORFEIT:      0x8006, // client -> server
    BYE_AWARDED:         0x8007  // server -> all
  };

  export var DefaultInit = {
    // Stable identifier the game plugin chose; used as storage key.
    tournament_id:               "",
    // Max bracket size; rounded up to next power of 2 for single-elim.
    max_players:                 16,
    min_players:                 2,
    // Registration window — server closes phase on whichever fires first.
    registration_open_unix_ms:   0,        // 0 = open immediately
    registration_close_unix_ms:  0,        // 0 = close on capacity
    // Per-leg game template.
    leg_template_id:             "sync-turn-v1",
    leg_template_init:           {} as any,
    leg_target_game_id:          "",
    leg_target_region:           "",
    // How long a leg has to complete before we declare a forfeit.
    leg_timeout_ms:              15 * 60 * 1000,
    // Time between the end of one round and the start of the next.
    inter_round_grace_ms:        10 * 1000,
    // What to do if a leg's host crashes or matchCreate fails.
    walkover_on_match_failure:   true,
    // Bracket mode hint (the IBracketGenerator decides the actual layout).
    bracket_mode:                "single_elim", // "single_elim" | "round_robin" | "ladder"
    // Custom generator id; "" = built-in single-elim.
    bracket_generator_id:        "",
    // Hard wall-clock cap on the entire tournament.
    max_match_duration_ms:       6 * 60 * 60 * 1000,
    // Allow agents (AI bots) to register? Useful for filling brackets.
    allow_agents:                true,
    // Round-1 byes auto-applied when registered count is not power-of-2.
    allow_byes:                  true
  };

  export interface IBracketGenerator {
    generatorId: string;
    initBracket(state: IState): IBracket;
    nextRoundLegs(state: IState, bracket: IBracket): ILeg[];
    onLegResolved(bracket: IBracket, leg: ILeg, winnerUserId: string, loserUserId: string): IBracket;
    isComplete(bracket: IBracket): boolean;
    championOf(bracket: IBracket): string; // returns "" if not yet decided
  }

  export interface ILeg {
    leg_id: string;          // stable id, e.g. "r1-m0"
    round_index: number;
    player_a: string;
    player_b: string;        // "" = bye for player_a
    match_id: string;        // populated post-spawn
    started_unix_ms: number;
    ended_unix_ms: number;
    winner_user_id: string;
    loser_user_id: string;
    status: "pending" | "live" | "resolved" | "walkover" | "forfeited";
    failure_reason: string;
  }

  export interface IBracket {
    rounds: ILeg[][]; // rounds[i][j] = j'th leg in round i
    // Winners flow into rounds[i+1] in pair order: [leg0.winner, leg1.winner, ...].
    winners_path: string[][];
  }

  enum Phase {
    REGISTRATION = 0,
    SEEDING      = 1,
    LIVE         = 2,
    DONE         = 3,
    CANCELLED    = 4
  }

  export interface IRegistrant {
    user_id: string;
    is_agent: boolean;
    seed: number;       // assigned at SEEDING time
    eliminated: boolean;
    placement: number;  // populated post-resolution
  }

  export interface IState {
    init: any;
    phase: Phase;
    registrants: { [u: string]: IRegistrant };
    registration_close_unix_ms_effective: number;
    started_unix_ms: number;
    bracket: IBracket | null;
    current_round_index: number;
    current_round_started_unix_ms: number;
    bracket_generator: IBracketGenerator | null;
    pending_end_reason: string;
    outbound_seq: number;
    // Audit trail; lives in result envelope.
    events: Array<{ at_unix_ms: number; kind: string; data: any }>;
  }

  // ---- generator registry ----
  var generators: { [id: string]: IBracketGenerator } = {};
  export function registerGenerator(g: IBracketGenerator): void { generators[g.generatorId] = g; }

  // Built-in single-elim bracket.
  // Seeding: lowest seed plays highest seed (1 vs N, 2 vs N-1, …).
  var SINGLE_ELIM: IBracketGenerator = {
    generatorId: "single-elim",
    initBracket: function (state) {
      var seeded: IRegistrant[] = [];
      for (var u in state.registrants) seeded.push(state.registrants[u]);
      seeded.sort(function (a, b) { return a.seed - b.seed; });
      // Pad to next power of 2 with byes.
      var n = seeded.length;
      var size = 1;
      while (size < n) size *= 2;
      var byes = size - n;
      // Top `byes` seeds get byes (i.e. paired with "" opponent).
      var round0: ILeg[] = [];
      var lo = 0;
      var hi = seeded.length - 1;
      var legIdx = 0;
      // Standard "1 v N, 2 v N-1" pattern with byes attached to top seeds.
      while (lo <= hi) {
        var a = seeded[lo].user_id;
        var b = (lo === hi) ? "" : seeded[hi].user_id;
        // If we still have byes to assign and this leg's `b` is the
        // weakest unpaired player, drop the opponent so player_a gets a bye.
        if (byes > 0 && b !== "") {
          // Walk byes from outside in; only assign to top seeds.
          // Heuristic: assign bye if seeds[lo] is in top `byes` seeds
          // (i.e. lo < byes).
          if (lo < byes) {
            // Bye for seeds[lo].
            b = "";
            // Don't consume hi; the would-be opponent stays for the next pair.
            round0.push({
              leg_id: "r0-m" + legIdx,
              round_index: 0,
              player_a: a, player_b: "",
              match_id: "", started_unix_ms: 0, ended_unix_ms: 0,
              winner_user_id: a, loser_user_id: "",
              status: "walkover", failure_reason: ""
            });
            legIdx++;
            lo++;
            byes--;
            continue;
          }
        }
        round0.push({
          leg_id: "r0-m" + legIdx,
          round_index: 0,
          player_a: a, player_b: b,
          match_id: "", started_unix_ms: 0, ended_unix_ms: 0,
          winner_user_id: (b === "") ? a : "",
          loser_user_id: "",
          status: (b === "") ? "walkover" : "pending",
          failure_reason: ""
        });
        legIdx++;
        lo++;
        if (b !== "") hi--;
      }
      var roundsCount = log2Up(size);
      var rounds: ILeg[][] = [round0];
      for (var r = 1; r < roundsCount; r++) rounds.push([]);
      return {
        rounds: rounds,
        winners_path: [[]]
      };
    },
    nextRoundLegs: function (_state, bracket) {
      // Return legs in `current_round_index` that still need spawning.
      // The orchestrator drives current_round_index; we return all pending
      // legs in that round.
      var roundIdx = bracket.rounds.length - 1;
      // Find the deepest round with any pending leg.
      for (var r = 0; r < bracket.rounds.length; r++) {
        for (var i = 0; i < bracket.rounds[r].length; i++) {
          if (bracket.rounds[r][i].status === "pending") {
            roundIdx = r;
            r = bracket.rounds.length; // break outer
            break;
          }
        }
      }
      var pending: ILeg[] = [];
      for (var i2 = 0; i2 < bracket.rounds[roundIdx].length; i2++) {
        var leg = bracket.rounds[roundIdx][i2];
        if (leg.status === "pending") pending.push(leg);
      }
      return pending;
    },
    onLegResolved: function (bracket, leg, winnerUserId, loserUserId) {
      // Mutate the leg in-place.
      var rl = bracket.rounds[leg.round_index];
      for (var i = 0; i < rl.length; i++) {
        if (rl[i].leg_id === leg.leg_id) {
          rl[i].winner_user_id = winnerUserId;
          rl[i].loser_user_id = loserUserId;
          rl[i].status = leg.status;
          rl[i].ended_unix_ms = Date.now();
          break;
        }
      }
      // If round complete, build next round.
      var roundIdx = leg.round_index;
      var round = bracket.rounds[roundIdx];
      var allDone = true;
      var winners: string[] = [];
      for (var j = 0; j < round.length; j++) {
        if (round[j].status === "pending" || round[j].status === "live") {
          allDone = false; break;
        }
        winners.push(round[j].winner_user_id);
      }
      if (allDone && roundIdx + 1 < bracket.rounds.length) {
        // Pair winners in order: (0,1), (2,3), …
        var nextRound: ILeg[] = [];
        for (var k = 0; k < winners.length; k += 2) {
          var a2 = winners[k];
          var b2 = (k + 1 < winners.length) ? winners[k + 1] : "";
          nextRound.push({
            leg_id: "r" + (roundIdx + 1) + "-m" + (k / 2 | 0),
            round_index: roundIdx + 1,
            player_a: a2, player_b: b2,
            match_id: "", started_unix_ms: 0, ended_unix_ms: 0,
            winner_user_id: (b2 === "") ? a2 : "",
            loser_user_id: "",
            status: (b2 === "") ? "walkover" : "pending",
            failure_reason: ""
          });
        }
        bracket.rounds[roundIdx + 1] = nextRound;
      }
      return bracket;
    },
    isComplete: function (bracket) {
      var last = bracket.rounds[bracket.rounds.length - 1];
      if (!last || last.length === 0) return false;
      // Final round must have exactly 1 resolved leg.
      if (last.length !== 1) return false;
      var l = last[0];
      return l.status === "resolved" || l.status === "walkover" || l.status === "forfeited";
    },
    championOf: function (bracket) {
      var last = bracket.rounds[bracket.rounds.length - 1];
      if (!last || last.length !== 1) return "";
      return last[0].winner_user_id || "";
    }
  };

  registerGenerator(SINGLE_ELIM);

  // ---- helpers ----
  function log2Up(n: number): number {
    var i = 0;
    var v = 1;
    while (v < n) { v *= 2; i++; }
    return Math.max(1, i);
  }

  function mergeInit(params: any): any {
    var out: any = {};
    for (var k in DefaultInit) if (DefaultInit.hasOwnProperty(k)) out[k] = (DefaultInit as any)[k];
    if (params) for (var k2 in params) if (params.hasOwnProperty(k2)) out[k2] = params[k2];
    return out;
  }

  function pickGenerator(state: IState): IBracketGenerator {
    var id = state.init.bracket_generator_id || "";
    if (id && generators[id]) return generators[id];
    return SINGLE_ELIM;
  }

  function logEvent(s: IState, kind: string, data: any): void {
    s.events.push({ at_unix_ms: Date.now(), kind: kind, data: data });
    if (s.events.length > 500) s.events = s.events.slice(s.events.length - 500);
  }

  // ---- template ----
  export var template: MpKernel.IMatchTemplate<IState> = {
    templateId: "tournament-v1",
    opRange: { from: 0x8000, to: 0x8FFF },
    defaultInit: DefaultInit,

    initState: function (_ctx, _logger, _nk, params) {
      var init = mergeInit(params.template_init);
      var s: IState = {
        init: init,
        phase: Phase.REGISTRATION,
        registrants: {},
        registration_close_unix_ms_effective:
          init.registration_close_unix_ms || (Date.now() + 5 * 60 * 1000),
        started_unix_ms: Date.now(),
        bracket: null,
        current_round_index: 0,
        current_round_started_unix_ms: 0,
        bracket_generator: null,
        pending_end_reason: "",
        outbound_seq: 1,
        events: []
      };
      var label = JSON.stringify({
        template_id: template.templateId,
        game_id: params.game_id,
        tournament_id: init.tournament_id,
        max_players: init.max_players
      });
      // 1 Hz — orchestrator polls leg results, drives phase transitions.
      return { state: s, tickRate: 1, label: label };
    },

    onJoinAttempt: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presence, _metadata) {
      var ks = state as IState;
      if (ks.phase !== Phase.REGISTRATION) {
        return { state: ks, accept: false, rejectMessage: "registration closed" };
      }
      var n = 0;
      for (var u in ks.registrants) n++;
      if (n >= ks.init.max_players) {
        return { state: ks, accept: false, rejectMessage: "tournament full" };
      }
      var isAgent = (presence.userId.indexOf("agt_") === 0);
      if (isAgent && !ks.init.allow_agents) {
        return { state: ks, accept: false, rejectMessage: "agents not allowed" };
      }
      return { state: ks, accept: true };
    },

    onJoin: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presences) {
      var ks = state as IState;
      for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        if (!ks.registrants[p.userId]) {
          ks.registrants[p.userId] = {
            user_id: p.userId,
            is_agent: p.userId.indexOf("agt_") === 0,
            seed: 0,
            eliminated: false,
            placement: 0
          };
        }
      }
      return { state: ks };
    },

    onLeave: function (_ctx, _logger, _nk, _dispatcher, _tick, state, presences) {
      var ks = state as IState;
      // Pre-bracket: remove from registrants.
      for (var i = 0; i < presences.length; i++) {
        var u = presences[i].userId;
        if (ks.phase === Phase.REGISTRATION) {
          delete ks.registrants[u];
        } else {
          // Mid-tournament leave is a forfeit of any active leg they're in.
          forfeitPlayer(ks, u);
        }
      }
      return { state: ks };
    },

    onLoop: function (ctx, logger, nk, dispatcher, _tick, state, messages) {
      var ks = state as IState;
      var matchId = (ctx as any).matchId || "";
      var nowUnixMs = Date.now();

      // Hard wall-clock cap.
      if (nowUnixMs > ks.started_unix_ms + ks.init.max_match_duration_ms &&
          ks.phase !== Phase.DONE && ks.phase !== Phase.CANCELLED) {
        ks.pending_end_reason = "duration_exceeded";
        ks.phase = Phase.CANCELLED;
        return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.DURATION_EXCEEDED);
      }

      // Inbound.
      for (var i = 0; i < messages.length; i++) {
        applyInbound(ks, messages[i], dispatcher, matchId);
      }

      // ---------- Phase machine ----------
      if (ks.phase === Phase.REGISTRATION) {
        var n = 0;
        for (var u in ks.registrants) n++;
        var capHit = n >= ks.init.max_players;
        var deadlineHit = nowUnixMs >= ks.registration_close_unix_ms_effective;
        if (capHit || deadlineHit) {
          if (n < ks.init.min_players) {
            broadcastTemplate(ks, dispatcher, matchId, Op.REGISTRATION_CLOSED, {
              registered: n,
              cancelled: true,
              reason: "registration_short"
            });
            ks.phase = Phase.CANCELLED;
            ks.pending_end_reason = "registration_short";
            return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.CANCELLED);
          }
          // Seed by registration order (fast path; real tournaments
          // would seed by ELO via a custom IBracketGenerator).
          var idx = 1;
          for (var u2 in ks.registrants) {
            ks.registrants[u2].seed = idx++;
          }
          ks.bracket_generator = pickGenerator(ks);
          ks.bracket = ks.bracket_generator.initBracket(ks);
          ks.phase = Phase.SEEDING;
          ks.current_round_started_unix_ms = nowUnixMs;
          broadcastTemplate(ks, dispatcher, matchId, Op.REGISTRATION_CLOSED, {
            registered: n,
            seeded: idx - 1,
            bracket: ks.bracket
          });
          // Fall through to LIVE on next tick.
          return { state: ks };
        }
      }

      if (ks.phase === Phase.SEEDING) {
        // Auto-advance: SEEDING is a one-tick handoff so clients see the
        // bracket before legs spawn.
        ks.phase = Phase.LIVE;
      }

      if (ks.phase === Phase.LIVE) {
        if (!ks.bracket || !ks.bracket_generator) {
          ks.pending_end_reason = "kernel_internal_no_bracket";
          ks.phase = Phase.CANCELLED;
          return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.KERNEL_INTERNAL);
        }
        // Pump pending legs.
        var pendingLegs = ks.bracket_generator.nextRoundLegs(ks, ks.bracket);
        for (var li = 0; li < pendingLegs.length; li++) {
          var leg = pendingLegs[li];
          if (leg.status !== "pending") continue;
          // Spawn the leg match.
          var legMatchId = "";
          try {
            legMatchId = nk.matchCreate(ks.init.leg_template_id, {
              game_id:         ks.init.leg_target_game_id || "",
              region:          ks.init.leg_target_region || "",
              template_init:   ks.init.leg_template_init || {},
              creator_user_id: leg.player_a,
              tournament_id:   ks.init.tournament_id,
              tournament_leg:  leg.leg_id
            });
          } catch (err: any) {
            logger.warn("[Tournament] leg matchCreate failed leg=%s err=%s",
              leg.leg_id, (err && err.message) ? err.message : String(err));
          }
          if (!legMatchId) {
            // walkover_on_match_failure: top seed advances; otherwise cancel.
            if (ks.init.walkover_on_match_failure) {
              leg.status = "walkover";
              leg.winner_user_id = leg.player_a;
              leg.loser_user_id = leg.player_b;
              leg.failure_reason = "leg_create_failed";
              leg.ended_unix_ms = nowUnixMs;
              ks.bracket = ks.bracket_generator.onLegResolved(ks.bracket, leg, leg.player_a, leg.player_b);
              broadcastTemplate(ks, dispatcher, matchId, Op.LEG_MATCH_RESULT, {
                leg_id: leg.leg_id,
                round_index: leg.round_index,
                winner_user_id: leg.player_a,
                loser_user_id: leg.player_b,
                status: "walkover",
                reason: "leg_create_failed"
              });
              logEvent(ks, "leg_walkover", { leg_id: leg.leg_id, reason: "leg_create_failed" });
            } else {
              broadcastTemplate(ks, dispatcher, matchId, Op.LEG_MATCH_RESULT, {
                leg_id: leg.leg_id,
                round_index: leg.round_index,
                status: "failed",
                reason: "leg_create_failed"
              });
              ks.pending_end_reason = "leg_create_failed_no_walkover";
              ks.phase = Phase.CANCELLED;
              return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.KERNEL_INTERNAL);
            }
          } else {
            leg.match_id = legMatchId;
            leg.status = "live";
            leg.started_unix_ms = nowUnixMs;
            broadcastTemplate(ks, dispatcher, matchId, Op.LEG_MATCH_INFO, {
              leg_id: leg.leg_id,
              round_index: leg.round_index,
              match_id: legMatchId,
              player_a: leg.player_a,
              player_b: leg.player_b,
              template_id: ks.init.leg_template_id
            });
            logEvent(ks, "leg_spawned", { leg_id: leg.leg_id, match_id: legMatchId });
          }
        }
        // Poll live legs for results.
        for (var rIdx = 0; rIdx < ks.bracket.rounds.length; rIdx++) {
          var round = ks.bracket.rounds[rIdx];
          for (var lIdx = 0; lIdx < round.length; lIdx++) {
            var lg = round[lIdx];
            if (lg.status !== "live") continue;
            var result = MpKernelMatchResult.read(nk, lg.match_id);
            if (result) {
              // Decode winner from outcomes (placement === 1).
              var winner = "";
              var loser = "";
              for (var o = 0; o < result.outcomes.length; o++) {
                if (result.outcomes[o].placement === 1) winner = result.outcomes[o].user_id;
                else if (lg.player_b !== "" && result.outcomes[o].user_id !== winner) loser = result.outcomes[o].user_id;
              }
              if (winner === "") {
                // Tie / no winner — pick higher seed (lower seed value wins).
                var sa = ks.registrants[lg.player_a];
                var sb = ks.registrants[lg.player_b];
                winner = (sa && sb && sa.seed <= sb.seed) ? lg.player_a : lg.player_b;
                loser = (winner === lg.player_a) ? lg.player_b : lg.player_a;
              }
              lg.winner_user_id = winner;
              lg.loser_user_id = loser;
              lg.status = "resolved";
              lg.ended_unix_ms = nowUnixMs;
              ks.bracket = ks.bracket_generator.onLegResolved(ks.bracket, lg, winner, loser);
              if (loser && ks.registrants[loser]) ks.registrants[loser].eliminated = true;
              broadcastTemplate(ks, dispatcher, matchId, Op.LEG_MATCH_RESULT, {
                leg_id: lg.leg_id,
                round_index: lg.round_index,
                winner_user_id: winner,
                loser_user_id: loser,
                status: "resolved"
              });
              logEvent(ks, "leg_resolved", { leg_id: lg.leg_id, winner: winner });
            } else if (nowUnixMs > lg.started_unix_ms + ks.init.leg_timeout_ms) {
              // Leg timed out without writing a result.
              var seedA = ks.registrants[lg.player_a];
              var seedB = ks.registrants[lg.player_b];
              var winner2 = (seedA && seedB && seedA.seed <= seedB.seed) ? lg.player_a : lg.player_b;
              var loser2 = (winner2 === lg.player_a) ? lg.player_b : lg.player_a;
              lg.winner_user_id = winner2;
              lg.loser_user_id = loser2;
              lg.status = "forfeited";
              lg.failure_reason = "leg_timeout";
              lg.ended_unix_ms = nowUnixMs;
              ks.bracket = ks.bracket_generator.onLegResolved(ks.bracket, lg, winner2, loser2);
              if (loser2 && ks.registrants[loser2]) ks.registrants[loser2].eliminated = true;
              broadcastTemplate(ks, dispatcher, matchId, Op.LEG_MATCH_RESULT, {
                leg_id: lg.leg_id,
                round_index: lg.round_index,
                winner_user_id: winner2,
                loser_user_id: loser2,
                status: "forfeited",
                reason: "leg_timeout"
              });
              logEvent(ks, "leg_forfeit", { leg_id: lg.leg_id, reason: "leg_timeout" });
            }
          }
        }
        // Walkover legs need to be threaded through onLegResolved so the
        // bracket builds the next round even when we never spawned a match.
        for (var rIdx2 = 0; rIdx2 < ks.bracket.rounds.length; rIdx2++) {
          var roundW = ks.bracket.rounds[rIdx2];
          for (var lIdx2 = 0; lIdx2 < roundW.length; lIdx2++) {
            var lgW = roundW[lIdx2];
            if (lgW.status === "walkover" && lgW.ended_unix_ms === 0) {
              lgW.ended_unix_ms = nowUnixMs;
              ks.bracket = ks.bracket_generator.onLegResolved(ks.bracket, lgW, lgW.winner_user_id, lgW.loser_user_id);
              broadcastTemplate(ks, dispatcher, matchId, Op.BYE_AWARDED, {
                leg_id: lgW.leg_id,
                round_index: lgW.round_index,
                user_id: lgW.winner_user_id
              });
            }
          }
        }
        broadcastTemplate(ks, dispatcher, matchId, Op.BRACKET_UPDATED, {
          rounds: ks.bracket.rounds
        });

        if (ks.bracket_generator.isComplete(ks.bracket)) {
          var champion = ks.bracket_generator.championOf(ks.bracket);
          if (champion && ks.registrants[champion]) ks.registrants[champion].placement = 1;
          // Fill placements for remaining: eliminated players in round
          // order (later round = higher placement).
          var place = 2;
          for (var rr = ks.bracket.rounds.length - 1; rr >= 0; rr--) {
            var rrRound = ks.bracket.rounds[rr];
            for (var ll = 0; ll < rrRound.length; ll++) {
              var lll = rrRound[ll];
              var loser3 = lll.loser_user_id;
              if (loser3 && ks.registrants[loser3] && ks.registrants[loser3].placement === 0) {
                ks.registrants[loser3].placement = place++;
              }
            }
          }
          broadcastTemplate(ks, dispatcher, matchId, Op.TOURNAMENT_RESOLVED, {
            champion_user_id: champion,
            bracket: ks.bracket,
            registrants: ks.registrants
          });
          ks.phase = Phase.DONE;
          ks.pending_end_reason = "completed";
          return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.COMPLETED);
        }
      }

      if (ks.pending_end_reason !== "" && ks.phase !== Phase.DONE && ks.phase !== Phase.CANCELLED) {
        return endMatch(ks, dispatcher, matchId, MpKernel.EndReason.KERNEL_INTERNAL);
      }
      return { state: ks };
    },

    onTerminate: function (_ctx, _logger, _nk, _dispatcher, _tick, state, _grace) {
      return { state: state };
    },

    buildResult: function (state, reason) {
      var ks = state as IState;
      var outcomes: MpKernel.IPlayerOutcome[] = [];
      for (var u in ks.registrants) {
        var r = ks.registrants[u];
        outcomes.push({
          user_id: u,
          is_agent: r.is_agent,
          placement: r.placement,
          score: 0,
          completed: !r.eliminated || r.placement > 0,
          left_early: false,
          game_payload: { seed: r.seed, eliminated: r.eliminated }
        });
      }
      return {
        match_id: "",
        template_id: template.templateId,
        game_id: "",
        started_unix_ms: ks.started_unix_ms,
        ended_unix_ms: 0,
        duration_ms: 0,
        outcomes: outcomes,
        game_payload: {
          tournament_id:   ks.init.tournament_id,
          bracket_mode:    ks.init.bracket_mode,
          bracket:         ks.bracket,
          end_reason:      reason,
          events:          ks.events
        }
      };
    }
  };

  // ---- inbound + helpers ----
  function applyInbound(
    ks: IState,
    m: nkruntime.MatchMessage,
    _dispatcher: nkruntime.MatchDispatcher,
    _matchId: string
  ): void {
    var raw = (typeof m.data === "string") ? m.data : (m.data ? String.fromCharCode.apply(null, m.data as any) : "");
    if (!raw) return;
    var parsed: any;
    try { parsed = JSON.parse(raw); } catch (_e) { return; }
    var p = parsed.p || {};
    var sender = m.sender.userId;
    if (m.opCode === Op.PLAYER_FORFEIT) {
      forfeitPlayer(ks, sender);
      logEvent(ks, "player_forfeit", { user_id: sender, reason: p.reason || "self" });
    }
    // Op.REGISTER is not used as a separate inbound — joining the match
    // IS the registration. Future versions can use it for late registration
    // with payment info.
  }

  function forfeitPlayer(ks: IState, userId: string): void {
    var r = ks.registrants[userId];
    if (!r) return;
    r.eliminated = true;
    if (!ks.bracket) return;
    for (var rIdx = 0; rIdx < ks.bracket.rounds.length; rIdx++) {
      var round = ks.bracket.rounds[rIdx];
      for (var lIdx = 0; lIdx < round.length; lIdx++) {
        var lg = round[lIdx];
        if ((lg.status === "pending" || lg.status === "live") &&
            (lg.player_a === userId || lg.player_b === userId)) {
          var opp = (lg.player_a === userId) ? lg.player_b : lg.player_a;
          lg.winner_user_id = opp;
          lg.loser_user_id = userId;
          lg.status = "forfeited";
          lg.failure_reason = "self_forfeit";
          lg.ended_unix_ms = Date.now();
          if (ks.bracket_generator) {
            ks.bracket = ks.bracket_generator.onLegResolved(ks.bracket, lg, opp, userId);
          }
        }
      }
    }
  }

  function endMatch(ks: IState, dispatcher: nkruntime.MatchDispatcher, matchId: string, reasonEnum: number): null {
    var resultEnvelope: MpKernel.IMatchResultEnvelope | null = null;
    if (template.buildResult) {
      var built = template.buildResult(ks, ks.pending_end_reason || "completed");
      if (built) {
        built.match_id = matchId;
        if (!built.started_unix_ms) built.started_unix_ms = ks.started_unix_ms;
        resultEnvelope = built;
      }
    }
    broadcastTemplate(ks, dispatcher, matchId, MpKernel.KernelOp.MATCH_ENDED, {
      reason: reasonEnum,
      result_envelope: resultEnvelope
    });
    return null;
  }

  function broadcastTemplate(
    ks: IState,
    dispatcher: nkruntime.MatchDispatcher,
    matchId: string,
    op: number,
    payload: any
  ): void {
    var seqProvider = (ks as any).__seqProvider;
    var matchTimeProvider = (ks as any).__matchTimeMs;
    var seq = (typeof seqProvider === "function") ? seqProvider() : ks.outbound_seq++;
    var matchTimeMs = (typeof matchTimeProvider === "function")
      ? matchTimeProvider()
      : (Date.now() - ks.started_unix_ms);
    var env = {
      h: {
        wire_version: 1,
        op: op,
        seq: seq,
        match_time_ms: matchTimeMs,
        sender_user_id: "server",
        match_id: matchId,
        client_opcode_uuid: ""
      },
      p: payload
    };
    dispatcher.broadcastMessage(op, JSON.stringify(env));
  }
}
