import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

export function registerEngagementTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  server.tool(
    "send_notification",
    "Send a notification to a specific user. Use for re-engagement, rewards announcements, social prompts, or system messages. Code 0 = system, custom codes for game events.",
    {
      user_id: z.string().describe("Target user UUID"),
      subject: z.string().describe("Notification subject/title"),
      content: z.string().describe("Notification body as JSON string (will be stored as JSON object)"),
      code: z.number().int().min(0).optional().describe("Notification type code (0=system, custom codes for game events). Default 0."),
      sender_id: z.string().optional().describe("Sender user UUID (omit for system notification)"),
      persistent: z.boolean().optional().describe("Whether to persist the notification (default true)"),
    },
    async ({ user_id, subject, content, code, sender_id, persistent }) => {
      await console.sendNotification({
        user_id,
        subject,
        content,
        code: code ?? 0,
        sender_id,
        persistent: persistent ?? true,
      });
      return {
        content: [{ type: "text", text: `Notification sent to user ${user_id}: "${subject}"` }],
      };
    }
  );

  server.tool(
    "call_rpc",
    `Call any registered Nakama RPC by name. There are 175+ RPCs available covering:
- Wallet: create_player_wallet, update_wallet_balance, get_wallet_balance, wallet_transfer_between_game_wallets
- Leaderboards: submit_leaderboard_score, get_leaderboard, get_all_leaderboards
- Social: send_group_chat_message, send_direct_message, friends_list, create_game_group
- Daily systems: daily_rewards_claim, daily_missions_get, daily_missions_update_progress
- Analytics: analytics_log_event
- Retention: onboarding_get_state, retention_get_recommendations, winback_check_status
- Tournaments: tournament_create, tournament_join, tournament_submit_score
- Game-specific: quizverse_*, lasttolive_* prefixed RPCs
Pass the RPC name and a JSON payload object.`,
    {
      rpc_id: z.string().describe("RPC function name (e.g. 'send_group_chat_message', 'daily_rewards_claim', 'get_all_leaderboards')"),
      payload: z.record(z.string(), z.unknown()).optional().describe("JSON payload to send to the RPC. Structure depends on the specific RPC."),
    },
    async ({ rpc_id, payload }) => {
      const data = await api.callRpc(rpc_id, payload ?? {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "update_account",
    "Update a user's account information: display name, username, avatar URL, language, location, timezone, or custom metadata",
    {
      user_id: z.string().describe("User UUID to update"),
      username: z.string().optional().describe("New username"),
      display_name: z.string().optional().describe("New display name"),
      avatar_url: z.string().optional().describe("New avatar URL"),
      lang_tag: z.string().optional().describe("Language tag (e.g. 'en')"),
      location: z.string().optional().describe("Location string"),
      timezone: z.string().optional().describe("Timezone string"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("Custom metadata JSON object"),
    },
    async ({ user_id, username, display_name, avatar_url, lang_tag, location, timezone, metadata }) => {
      const body: Record<string, unknown> = {};
      if (username !== undefined) body.username = username;
      if (display_name !== undefined) body.display_name = display_name;
      if (avatar_url !== undefined) body.avatar_url = avatar_url;
      if (lang_tag !== undefined) body.lang_tag = lang_tag;
      if (location !== undefined) body.location = location;
      if (timezone !== undefined) body.timezone = timezone;
      if (metadata !== undefined) body.metadata = JSON.stringify(metadata);
      await console.updateAccount(user_id, body);
      return {
        content: [{ type: "text", text: `Account ${user_id} updated successfully` }],
      };
    }
  );
}
