import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

export function registerIdentityTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  server.tool(
    "authenticate_device",
    "Authenticate or create a user via device ID. Returns session token, user ID, and whether the account was just created. The primary way to get a player identity for further operations.",
    {
      device_id: z.string().describe("Unique device identifier"),
      game_id: z.string().optional().describe("Game ID to scope the identity to"),
      username: z.string().optional().describe("Desired username for new accounts"),
    },
    async ({ device_id, game_id, username }) => {
      const data = await api.callRpc("create_or_sync_user", {
        device_id,
        game_id: game_id ?? "",
        username: username ?? "",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_player_profile",
    "Get a player's full profile including metadata, wallet, game-specific data. Combines account info with game profile data.",
    {
      user_id: z.string().describe("User UUID"),
      game_id: z.string().optional().describe("Game ID to fetch game-specific profile"),
    },
    async ({ user_id, game_id }) => {
      const account = await console.getAccount(user_id);
      let gameProfile = null;
      if (game_id) {
        try {
          gameProfile = await api.callRpc("get_player_metadata", {
            user_id,
            game_id,
          });
        } catch {
          // game profile may not exist
        }
      }
      const result = { account, game_profile: gameProfile };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_player_portfolio",
    "Get a player's complete portfolio: wallet balances across games, leaderboard positions, achievement progress. High-level view of a player's standing.",
    {
      device_id: z.string().describe("Device ID of the player"),
      game_id: z.string().optional().describe("Specific game ID to scope to"),
    },
    async ({ device_id, game_id }) => {
      const data = await api.callRpc("get_player_portfolio", {
        device_id,
        game_id: game_id ?? "",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "track_session",
    "Record a session start or end event for a player. Used for analytics tracking and retention analysis.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
      event: z.enum(["start", "end"]).describe("Session event type"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Optional session metadata (duration, platform, etc.)"),
    },
    async ({ device_id, game_id, event, metadata }) => {
      const rpcName = event === "start"
        ? "onboarding_track_session"
        : "onboarding_track_session";
      const data = await api.callRpc(rpcName, {
        device_id,
        game_id,
        event_type: event,
        ...(metadata ?? {}),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "agent_memory_read",
    "Read agent memory from Nakama storage. Use this to persist and retrieve AI agent context, conversation state, user preferences, or any structured data the agent needs across sessions.",
    {
      user_id: z.string().describe("User UUID to scope memory to (use '00000000-0000-0000-0000-000000000000' for global)"),
      key: z.string().describe("Memory key (e.g. 'conversation_context', 'user_preferences', 'engagement_plan')"),
    },
    async ({ user_id, key }) => {
      try {
        const data = await console.getStorageObject("agent_memory", key, user_id);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch {
        return { content: [{ type: "text", text: JSON.stringify({ exists: false, key, user_id }, null, 2) }] };
      }
    }
  );

  server.tool(
    "agent_memory_write",
    "Write agent memory to Nakama storage. Persist AI context, plans, user notes, engagement strategies. Data is stored as JSON in the 'agent_memory' collection.",
    {
      user_id: z.string().describe("User UUID to scope memory to (use '00000000-0000-0000-0000-000000000000' for global)"),
      key: z.string().describe("Memory key"),
      value: z.record(z.string(), z.unknown()).describe("JSON object to store"),
    },
    async ({ user_id, key, value }) => {
      const data = await api.callRpc("batch_execute", {
        operations: [{
          rpc: "storage_write",
          payload: {
            collection: "agent_memory",
            key,
            user_id,
            value: JSON.stringify(value),
            permission_read: 0,
            permission_write: 0,
          }
        }]
      });
      return { content: [{ type: "text", text: `Agent memory written: agent_memory/${key} for ${user_id}` }] };
    }
  );

  server.tool(
    "get_onboarding_state",
    "Get a player's onboarding state: which steps completed, interests set, welcome bonus claimed. Critical for understanding new user activation.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().optional().describe("Game ID"),
    },
    async ({ device_id, game_id }) => {
      const data = await api.callRpc("onboarding_get_state", {
        device_id,
        game_id: game_id ?? "",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_retention_data",
    "Get retention analytics for a player: session frequency, streak history, churn risk signals. Use for identifying at-risk users and planning re-engagement.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().optional().describe("Game ID"),
    },
    async ({ device_id, game_id }) => {
      const data = await api.callRpc("onboarding_get_retention_data", {
        device_id,
        game_id: game_id ?? "",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
