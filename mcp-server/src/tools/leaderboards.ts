import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient } from "../client.js";

export function registerLeaderboardTools(
  server: McpServer,
  console: NakamaConsoleClient
) {
  server.tool(
    "list_leaderboards",
    "List all leaderboards with metadata (sort order, operator, reset schedule). Leaderboard IDs follow pattern: leaderboard_{gameId}_{period} where period is daily/weekly/monthly/alltime.",
    {
      cursor: z.string().optional().describe("Pagination cursor"),
      limit: z.number().min(1).max(100).optional().describe("Max results per page"),
    },
    async ({ cursor, limit }) => {
      const data = await console.listLeaderboards({ cursor, limit });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_leaderboard",
    "Get details for a specific leaderboard by ID",
    {
      leaderboard_id: z.string().describe("Leaderboard ID (e.g. 'leaderboard_<gameId>_weekly')"),
    },
    async ({ leaderboard_id }) => {
      const data = await console.getLeaderboard(leaderboard_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "list_leaderboard_records",
    "List records (scores) for a leaderboard. Returns ranked players with scores, subscores, metadata. Use for analyzing competition, finding top players, and score distributions.",
    {
      leaderboard_id: z.string().describe("Leaderboard ID"),
      limit: z.number().min(1).max(100).optional().describe("Max records to return"),
      cursor: z.string().optional().describe("Pagination cursor"),
      owner_ids: z.array(z.string()).optional().describe("Filter by specific user IDs"),
    },
    async ({ leaderboard_id, limit, cursor, owner_ids }) => {
      const data = await console.listLeaderboardRecords(leaderboard_id, {
        limit,
        cursor,
        owner_ids,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "delete_leaderboard_record",
    "Delete a specific leaderboard record by leaderboard ID and owner user ID. Use for removing cheater scores or test data.",
    {
      leaderboard_id: z.string().describe("Leaderboard ID"),
      owner_id: z.string().describe("User UUID whose record to delete"),
    },
    async ({ leaderboard_id, owner_id }) => {
      await console.deleteLeaderboardRecord(leaderboard_id, owner_id);
      return {
        content: [
          {
            type: "text",
            text: `Deleted record for user ${owner_id} from leaderboard ${leaderboard_id}`,
          },
        ],
      };
    }
  );
}
