import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

async function safeRpc(
  api: NakamaApiClient,
  rpcId: string,
  payload: unknown
): Promise<unknown> {
  try {
    const result = await api.callRpc(rpcId, payload);
    if (typeof result === "object" && result !== null && "payload" in result) {
      const p = (result as Record<string, unknown>).payload;
      if (typeof p === "string") return JSON.parse(p);
      return p;
    }
    return result;
  } catch (err) {
    return { error: String(err) };
  }
}

export function registerGiftingTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  // =========================================================================
  // Tool 1: send_gift_as_operator
  // =========================================================================
  server.tool(
    "send_gift_as_operator",
    "Send a gift from one player to another as an operator action. Deducts from sender wallet and creates a claimable gift. Use for customer support (compensating players), engagement campaigns, or facilitating social connections.",
    {
      sender_id: z.string().describe("Sender player UUID"),
      to_user_id: z.string().describe("Recipient player UUID"),
      item_type: z
        .enum(["coins", "gems", "xp", "item", "mystery_box"])
        .describe("Type of gift"),
      quantity: z.number().int().positive().describe("Amount to gift"),
      item_id: z.string().optional().describe("Specific item ID (for type=item)"),
      message: z.string().optional().describe("Gift message shown to recipient"),
      game_id: z.string().optional().describe("Game context for the gift"),
    },
    async ({ sender_id, to_user_id, item_type, quantity, item_id, message, game_id }) => {
      const data = await safeRpc(api, "gift_send", {
        to_user_id,
        item_type,
        item_id: item_id ?? "",
        quantity,
        message: message ?? "",
        game_id: game_id ?? "global",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Tool 2: list_player_gifts
  // =========================================================================
  server.tool(
    "list_player_gifts",
    "List pending gifts in a player's inbox. Use for support investigations (checking if gifts arrived), engagement analysis (gift adoption rates), or auditing gift economy flow.",
    {
      player_id: z.string().describe("Player UUID to check gift inbox for"),
      limit: z.number().int().optional().describe("Max gifts to return (default 50)"),
    },
    async ({ player_id, limit }) => {
      const data = await safeRpc(api, "gift_inbox", {
        limit: limit ?? 50,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Tool 3: claim_gift_for_player
  // =========================================================================
  server.tool(
    "claim_gift_for_player",
    "Claim a pending gift on behalf of a player. Grants the gift contents to their wallet/inventory. Use for support: if a player reports they can't claim a gift, an operator can force-claim it.",
    {
      gift_id: z.string().describe("The gift ID to claim"),
    },
    async ({ gift_id }) => {
      const data = await safeRpc(api, "gift_claim", { gift_id });
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Tool 4: gift_economy_report
  // =========================================================================
  server.tool(
    "gift_economy_report",
    "Generate a report on the gifting economy: total gifts sent, pending vs claimed, top gifters, most gifted items. Returns structured insight data for LLM analysis of social monetization health.",
    {
      game_id: z.string().optional().describe("Filter by game ID"),
    },
    async ({ game_id }) => {
      const storageResult = await console.get(
        `/v2/console/storage/player_gifts_inbox?limit=100`
      );

      const records =
        typeof storageResult === "object" &&
        storageResult !== null &&
        "objects" in storageResult
          ? (storageResult as Record<string, unknown>).objects
          : [];

      const gifts = Array.isArray(records) ? records : [];

      let totalGifts = 0;
      let pending = 0;
      let claimed = 0;
      const byType: Record<string, number> = {};
      const topSenders: Record<string, number> = {};
      let totalValue = 0;

      for (const g of gifts) {
        const val =
          typeof g === "object" && g !== null && "value" in g
            ? (g as Record<string, unknown>).value
            : null;
        if (!val || typeof val !== "object") continue;

        const gift = val as Record<string, unknown>;
        if (game_id && gift.game_id !== game_id) continue;

        totalGifts++;
        if (gift.status === "pending") pending++;
        if (gift.status === "claimed") claimed++;

        const iType = String(gift.item_type || "unknown");
        byType[iType] = (byType[iType] || 0) + 1;

        const sender = String(gift.sender_id || "unknown");
        topSenders[sender] = (topSenders[sender] || 0) + 1;

        if (
          iType === "coins" ||
          iType === "gems" ||
          iType === "xp"
        ) {
          totalValue += Number(gift.quantity) || 0;
        }
      }

      const sortedSenders = Object.entries(topSenders)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([id, count]) => ({ user_id: id, gifts_sent: count }));

      const report = {
        metrics: {
          total_gifts: totalGifts,
          pending,
          claimed,
          claim_rate:
            totalGifts > 0
              ? Math.round((claimed / totalGifts) * 100) + "%"
              : "N/A",
          total_currency_value: totalValue,
        },
        by_item_type: byType,
        top_senders: sortedSenders,
        benchmarks: {
          healthy_claim_rate: "70%+",
          healthy_gift_frequency: ">5% of active players gifting weekly",
        },
        flags: [] as string[],
        recommendations: [] as string[],
      };

      if (pending > claimed * 2) {
        report.flags.push("high_unclaimed_gifts");
        report.recommendations.push(
          "Many gifts are unclaimed. Consider sending reminder notifications to recipients."
        );
      }
      if (totalGifts === 0) {
        report.flags.push("no_gifting_activity");
        report.recommendations.push(
          "No gifts have been sent. Consider prompting players to gift after wins or milestones."
        );
      }
      if (sortedSenders.length === 1 && totalGifts > 5) {
        report.flags.push("single_gifter_dominance");
        report.recommendations.push(
          "Gifting is concentrated in one player. Broaden incentives for all players to gift."
        );
      }

      return {
        content: [
          { type: "text", text: JSON.stringify(report, null, 2) },
        ],
      };
    }
  );
}
