import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

export function registerSocialV2Tools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  server.tool(
    "find_rivalry_pairs",
    "Discover pairs of players with very close leaderboard scores in a game — natural rivals who would benefit from head-to-head challenges, targeted notifications, or competitive events. Use to seed organic social moments and drive re-engagement through rivalry.",
    {
      game_id: z.string().describe("Game ID to scan leaderboards for"),
      limit: z.number().int().min(1).max(50).optional().describe("Max rivalry pairs to return (default 10)"),
    },
    async ({ game_id, limit }) => {
      const pairLimit = limit ?? 10;

      const [accounts, records] = await Promise.all([
        console.listAccounts({ limit: 100 }),
        console.listLeaderboardRecords(`${game_id}_weekly`, { limit: 100 }),
      ]);

      const entries: Array<{ user_id: string; username: string; score: number }> = [];
      const recs = (records as any)?.records ?? (records as any)?.owner_records ?? [];
      for (const rec of recs) {
        entries.push({
          user_id: rec.owner_id ?? rec.ownerId ?? "",
          username: rec.username ?? "",
          score: Number(rec.score) || 0,
        });
      }

      entries.sort((a, b) => b.score - a.score);

      const pairs: Array<{ player_a: typeof entries[0]; player_b: typeof entries[0]; score_diff: number }> = [];
      for (let i = 0; i < entries.length - 1 && pairs.length < pairLimit; i++) {
        const diff = Math.abs(entries[i].score - entries[i + 1].score);
        if (diff <= entries[i].score * 0.1 || diff <= 100) {
          pairs.push({
            player_a: entries[i],
            player_b: entries[i + 1],
            score_diff: diff,
          });
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ game_id, rivalry_pairs: pairs, total_found: pairs.length }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "spark_social_moment",
    "Trigger a social interaction between two players — a challenge, a kudos notification, or a rivalry prompt. Use to engineer engagement spikes by connecting players at the right moment (after a close match, milestone, or shared achievement).",
    {
      user_id: z.string().describe("Initiating user UUID"),
      target_user_id: z.string().describe("Target user UUID"),
      moment_type: z.enum(["challenge", "kudos", "rivalry", "team_invite"]).describe("Type of social moment to create"),
      game_id: z.string().describe("Game context for the social moment"),
    },
    async ({ user_id, target_user_id, moment_type, game_id }) => {
      if (moment_type === "challenge") {
        const data = await api.callRpc("friends_challenge_user", {
          device_id: "",
          game_id,
          target_user_id,
          challenge_type: "social_moment",
          metadata: { initiated_by: user_id, moment_type },
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      await console.sendNotification({
        user_id: target_user_id,
        subject: moment_type === "kudos" ? "You got kudos!" :
                 moment_type === "rivalry" ? "A rival approaches!" :
                 "Team invite!",
        content: JSON.stringify({
          moment_type,
          from_user_id: user_id,
          game_id,
        }),
        code: moment_type === "kudos" ? 200 : moment_type === "rivalry" ? 201 : 202,
        sender_id: user_id,
        persistent: true,
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            moment_type,
            from: user_id,
            to: target_user_id,
            game_id,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "group_health_check",
    "Comprehensive health assessment for a game group/guild: member count, activity levels, chat frequency, leadership presence. Use to identify dying groups that need intervention, thriving groups to showcase, or groups ready for competitive events.",
    {
      group_id: z.string().describe("Group UUID to analyze"),
    },
    async ({ group_id }) => {
      const [groupInfo, chatHistory] = await Promise.all([
        console.get(`/v2/console/group/${encodeURIComponent(group_id)}`),
        console.listStorage({ collection: "group_chat", key: group_id, limit: 100 }),
      ]);

      const group = groupInfo as any;
      const messages = (chatHistory as any)?.objects ?? [];

      const memberCount = group?.edge_count ?? group?.member_count ?? 0;
      const recentMessages = messages.length;

      let healthScore = 0;
      if (memberCount >= 5) healthScore += 25;
      if (memberCount >= 15) healthScore += 15;
      if (recentMessages >= 10) healthScore += 30;
      if (recentMessages >= 50) healthScore += 15;
      if (group?.open !== false) healthScore += 15;

      const healthLabel =
        healthScore >= 80 ? "thriving" :
        healthScore >= 50 ? "healthy" :
        healthScore >= 25 ? "at_risk" :
        "critical";

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            group_id,
            group_name: group?.name ?? "unknown",
            member_count: memberCount,
            recent_messages: recentMessages,
            health_score: healthScore,
            health_label: healthLabel,
            is_open: group?.open ?? false,
            recommendations:
              healthLabel === "critical" ? ["Send re-engagement notifications", "Merge with another small group", "Assign active leader"] :
              healthLabel === "at_risk" ? ["Start a group event", "Send activity prompt", "Highlight group achievements"] :
              healthLabel === "healthy" ? ["Consider group vs group events", "Promote active members"] :
              ["Feature as showcase group", "Use for competitive events"],
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "viral_loop_trigger",
    "Send contextual notifications designed to trigger viral sharing and re-engagement loops. Trigger types include 'friend_beat_score' (notify when a friend beats your score), 'comeback' (lure lapsed players back), 'achievement_share' (prompt sharing a milestone), and 'referral' (invite incentive).",
    {
      user_id: z.string().describe("Target user UUID to receive the viral prompt"),
      trigger_type: z.enum(["friend_beat_score", "comeback", "achievement_share", "referral"]).describe("Type of viral loop to trigger"),
      game_id: z.string().describe("Game context"),
    },
    async ({ user_id, trigger_type, game_id }) => {
      const notificationMap: Record<string, { subject: string; content: Record<string, unknown>; code: number }> = {
        friend_beat_score: {
          subject: "Your friend just beat your score!",
          content: { trigger: "friend_beat_score", game_id, action: "reclaim_top_spot" },
          code: 300,
        },
        comeback: {
          subject: "We miss you! Come back for a bonus",
          content: { trigger: "comeback", game_id, bonus_coins: 200, action: "claim_comeback_bonus" },
          code: 301,
        },
        achievement_share: {
          subject: "Share your achievement and earn rewards!",
          content: { trigger: "achievement_share", game_id, share_bonus: 50, action: "share_achievement" },
          code: 302,
        },
        referral: {
          subject: "Invite a friend, both get rewarded!",
          content: { trigger: "referral", game_id, referrer_bonus: 100, referee_bonus: 100, action: "send_invite" },
          code: 303,
        },
      };

      const notif = notificationMap[trigger_type];

      await console.sendNotification({
        user_id,
        subject: notif.subject,
        content: JSON.stringify(notif.content),
        code: notif.code,
        persistent: true,
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            user_id,
            trigger_type,
            game_id,
            notification_sent: notif.subject,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "create_team_event",
    "Create a team-based competitive event within a game. Sets up a group quest that teams compete in over a time window. Use for community engagement, seasonal events, or to activate dormant groups.",
    {
      game_id: z.string().describe("Game ID for the event"),
      event_name: z.string().describe("Human-readable event name"),
      team_size: z.number().int().min(2).max(50).describe("Number of players per team"),
      duration_hours: z.number().positive().describe("Event duration in hours"),
    },
    async ({ game_id, event_name, team_size, duration_hours }) => {
      const data = await api.callRpc("group_quest_create", {
        game_id,
        quest_name: event_name,
        quest_type: "team_event",
        team_size,
        duration_hours,
        metadata: {
          created_by: "agent_operator",
          event_type: "team_competition",
        },
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
