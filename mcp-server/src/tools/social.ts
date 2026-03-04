import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

export function registerSocialTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  // --- Friends ---

  server.tool(
    "friends_list",
    "List a player's friends with friendship state (mutual, invited, blocked). Essential for social graph analysis and virality metrics.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().optional().describe("Game ID"),
    },
    async ({ device_id, game_id }) => {
      const data = await api.callRpc("friends_list", {
        device_id,
        game_id: game_id ?? "",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "friends_add",
    "Send a friend invite from one player to another. Drives social connectivity and retention.",
    {
      device_id: z.string().describe("Device ID of the sender"),
      game_id: z.string().describe("Game ID"),
      target_username: z.string().optional().describe("Username to invite"),
      target_user_id: z.string().optional().describe("User ID to invite"),
    },
    async ({ device_id, game_id, target_username, target_user_id }) => {
      const data = await api.callRpc("send_friend_invite", {
        device_id,
        game_id,
        target_username: target_username ?? "",
        target_user_id: target_user_id ?? "",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "friends_remove",
    "Remove a friend connection between two players.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
      target_user_id: z.string().describe("User ID to unfriend"),
    },
    async ({ device_id, game_id, target_user_id }) => {
      const data = await api.callRpc("friends_remove", {
        device_id,
        game_id,
        target_user_id,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "friends_challenge",
    "Send a friend challenge — a competitive prompt between friends. Drives engagement through social competition.",
    {
      device_id: z.string().describe("Device ID of challenger"),
      game_id: z.string().describe("Game ID"),
      target_user_id: z.string().describe("User ID to challenge"),
      challenge_type: z.string().optional().describe("Type of challenge (e.g. 'score_beat', 'quiz_duel')"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Challenge parameters"),
    },
    async ({ device_id, game_id, target_user_id, challenge_type, metadata }) => {
      const data = await api.callRpc("friends_challenge_user", {
        device_id,
        game_id,
        target_user_id,
        challenge_type: challenge_type ?? "default",
        metadata: metadata ?? {},
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Groups ---

  server.tool(
    "group_create",
    "Create a new game group/guild. Groups are the foundation for community engagement, team play, and group competitions.",
    {
      device_id: z.string().describe("Device ID of the creator"),
      game_id: z.string().describe("Game ID"),
      name: z.string().describe("Group name"),
      description: z.string().optional().describe("Group description"),
      max_count: z.number().int().optional().describe("Max members"),
      open: z.boolean().optional().describe("Whether anyone can join (default true)"),
    },
    async ({ device_id, game_id, name, description, max_count, open }) => {
      const data = await api.callRpc("create_game_group", {
        device_id,
        game_id,
        name,
        description: description ?? "",
        max_count: max_count ?? 100,
        open: open ?? true,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "group_update_xp",
    "Add XP to a group. Groups level up as members contribute, driving collective engagement.",
    {
      group_id: z.string().describe("Group UUID"),
      xp_amount: z.number().int().positive().describe("XP to add"),
    },
    async ({ group_id, xp_amount }) => {
      const data = await api.callRpc("update_group_xp", {
        group_id,
        xp_amount,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "group_get_wallet",
    "Get a group's shared wallet balance. Groups can accumulate and spend currency collectively.",
    {
      group_id: z.string().describe("Group UUID"),
    },
    async ({ group_id }) => {
      const data = await api.callRpc("get_group_wallet", { group_id });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "group_update_wallet",
    "Update a group's shared wallet. Use for group rewards, event prizes, or collective purchases.",
    {
      group_id: z.string().describe("Group UUID"),
      amount: z.number().describe("Amount to add (positive) or subtract (negative)"),
      reason: z.string().optional().describe("Audit reason"),
    },
    async ({ group_id, amount, reason }) => {
      const data = await api.callRpc("update_group_wallet", {
        group_id,
        amount,
        reason: reason ?? "agent_operator",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // --- Chat & Messaging ---

  server.tool(
    "chat_send_group",
    "Send a message to a group chat channel. Use for announcements, event notifications, engagement prompts, AI-driven community interaction.",
    {
      group_id: z.string().describe("Group UUID"),
      sender_id: z.string().describe("Sender user UUID"),
      content: z.string().describe("Message content as JSON string"),
    },
    async ({ group_id, sender_id, content }) => {
      const data = await api.callRpc("send_group_chat_message", {
        group_id,
        sender_id,
        content,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "chat_send_direct",
    "Send a direct message to a specific user. Use for personalized engagement, support, rewards announcements.",
    {
      sender_id: z.string().describe("Sender user UUID"),
      target_id: z.string().describe("Recipient user UUID"),
      content: z.string().describe("Message content as JSON string"),
    },
    async ({ sender_id, target_id, content }) => {
      const data = await api.callRpc("send_direct_message", {
        sender_id,
        target_id,
        content,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "chat_send_room",
    "Send a message to a public chat room. Use for global announcements, event broadcasts, community engagement.",
    {
      room_id: z.string().describe("Chat room identifier"),
      sender_id: z.string().describe("Sender user UUID"),
      content: z.string().describe("Message content as JSON string"),
    },
    async ({ room_id, sender_id, content }) => {
      const data = await api.callRpc("send_chat_room_message", {
        room_id,
        sender_id,
        content,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "chat_get_history",
    "Get chat message history for a group, DM, or room. Useful for analyzing conversation patterns, engagement levels, and community health.",
    {
      channel_type: z.enum(["group", "direct", "room"]).describe("Channel type"),
      channel_id: z.string().describe("Group ID, user pair ID, or room ID"),
      limit: z.number().int().optional().describe("Max messages to return"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ channel_type, channel_id, limit, cursor }) => {
      const rpcMap = {
        group: "get_group_chat_history",
        direct: "get_direct_message_history",
        room: "get_chat_room_history",
      };
      const data = await api.callRpc(rpcMap[channel_type], {
        channel_id,
        limit: limit ?? 50,
        cursor: cursor ?? "",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
