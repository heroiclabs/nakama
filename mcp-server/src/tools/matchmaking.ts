import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaApiClient } from "../client.js";

export function registerMatchmakingTools(
  server: McpServer,
  api: NakamaApiClient
) {
  server.tool(
    "matchmaking_find",
    "Add a player to the matchmaker queue with specified criteria. Returns a ticket for tracking.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
      min_count: z.number().int().min(2).optional().describe("Min players for a match (default 2)"),
      max_count: z.number().int().max(100).optional().describe("Max players for a match"),
      query: z.string().optional().describe("Matchmaker query filter (e.g. '+properties.skill:>10')"),
      properties: z.record(z.string(), z.unknown()).optional().describe("Player properties for matching"),
    },
    async ({ device_id, game_id, min_count, max_count, query, properties }) => {
      const data = await api.callRpc("matchmaking_find_match", {
        device_id,
        game_id,
        min_count: min_count ?? 2,
        max_count: max_count ?? 8,
        query: query ?? "*",
        properties: properties ?? {},
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "matchmaking_cancel",
    "Remove a player from the matchmaker queue.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
      ticket: z.string().optional().describe("Matchmaking ticket to cancel"),
    },
    async ({ device_id, game_id, ticket }) => {
      const data = await api.callRpc("matchmaking_cancel", {
        device_id,
        game_id,
        ticket: ticket ?? "",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "matchmaking_status",
    "Check the current matchmaking status for a player — whether they're in queue, matched, or idle.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
    },
    async ({ device_id, game_id }) => {
      const data = await api.callRpc("matchmaking_get_status", {
        device_id,
        game_id,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "matchmaking_create_party",
    "Create a matchmaking party that players can join together. Enables group queuing.",
    {
      device_id: z.string().describe("Device ID of the party leader"),
      game_id: z.string().describe("Game ID"),
      max_size: z.number().int().optional().describe("Max party size"),
    },
    async ({ device_id, game_id, max_size }) => {
      const data = await api.callRpc("matchmaking_create_party", {
        device_id,
        game_id,
        max_size: max_size ?? 4,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Tournament Tools ---

  server.tool(
    "tournament_create",
    "Create a new tournament. Tournaments are time-limited competitive events with leaderboard tracking and prize distribution.",
    {
      id: z.string().describe("Tournament ID"),
      title: z.string().describe("Tournament title"),
      description: z.string().optional().describe("Tournament description"),
      sort_order: z.enum(["ascending", "descending"]).optional().describe("Score sort order (default descending)"),
      operator: z.enum(["best", "set", "incr", "decr"]).optional().describe("Score operator (default best)"),
      duration: z.number().int().positive().optional().describe("Duration in seconds"),
      max_size: z.number().int().positive().optional().describe("Max participants"),
      start_time: z.string().optional().describe("ISO 8601 start time"),
    },
    async ({ id, title, description, sort_order, operator, duration, max_size, start_time }) => {
      const data = await api.callRpc("tournament_create", {
        id,
        title,
        description: description ?? "",
        sort_order: sort_order ?? "descending",
        operator: operator ?? "best",
        duration: duration ?? 86400,
        max_size: max_size ?? 100,
        start_time: start_time ?? "",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "tournament_join",
    "Join a player into an active tournament.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
      tournament_id: z.string().describe("Tournament ID to join"),
    },
    async ({ device_id, game_id, tournament_id }) => {
      const data = await api.callRpc("tournament_join", {
        device_id,
        game_id,
        tournament_id,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "tournament_list_active",
    "List all currently active tournaments. Shows tournament metadata, participant counts, time remaining.",
    {},
    async () => {
      const data = await api.callRpc("tournament_list_active", {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "tournament_submit_score",
    "Submit a score to a tournament on behalf of a player.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
      tournament_id: z.string().describe("Tournament ID"),
      score: z.number().describe("Score to submit"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Score metadata"),
    },
    async ({ device_id, game_id, tournament_id, score, metadata }) => {
      const data = await api.callRpc("tournament_submit_score", {
        device_id,
        game_id,
        tournament_id,
        score,
        metadata: metadata ?? {},
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "tournament_get_leaderboard",
    "Get the leaderboard for a specific tournament. Shows rankings, scores, and participant details.",
    {
      tournament_id: z.string().describe("Tournament ID"),
      limit: z.number().int().optional().describe("Max results"),
    },
    async ({ tournament_id, limit }) => {
      const data = await api.callRpc("tournament_get_leaderboard", {
        tournament_id,
        limit: limit ?? 50,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "leaderboard_submit_score",
    "Submit a score to all leaderboard periods (daily/weekly/monthly/alltime) for a game. Automatically updates rankings.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
      score: z.number().describe("Score value"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Score metadata (e.g. game mode, level)"),
    },
    async ({ device_id, game_id, score, metadata }) => {
      const data = await api.callRpc("submit_leaderboard_score", {
        device_id,
        game_id,
        score,
        metadata: metadata ?? {},
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
