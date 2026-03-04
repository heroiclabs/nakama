import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient } from "../client.js";

export function registerAnalyticsTools(
  server: McpServer,
  console: NakamaConsoleClient
) {
  server.tool(
    "get_server_status",
    "Get Nakama server status: connected users, running matches, goroutines, health info",
    {},
    async () => {
      const data = await console.getStatus();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "list_accounts",
    "List user accounts with optional filter. Use filter for search (e.g. username, email). Returns paginated results.",
    {
      filter: z.string().optional().describe("Filter string (username, email, or user ID)"),
      cursor: z.string().optional().describe("Pagination cursor from previous response"),
      limit: z.number().min(1).max(100).optional().describe("Max results per page (1-100, default 100)"),
    },
    async ({ filter, cursor, limit }) => {
      const data = await console.listAccounts({ filter, cursor, limit });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_account",
    "Get full account details for a user: profile, wallet, devices, metadata, friends count, group memberships",
    {
      user_id: z.string().describe("The user's UUID"),
    },
    async ({ user_id }) => {
      const data = await console.getAccount(user_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_wallet_ledger",
    "Get wallet transaction history for a user. Shows all currency changes with timestamps — useful for economy analysis.",
    {
      user_id: z.string().describe("The user's UUID"),
      limit: z.number().min(1).max(100).optional().describe("Max results per page"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ user_id, limit, cursor }) => {
      const data = await console.getWalletLedger(user_id, { limit, cursor });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "export_account",
    "Export complete account data for a user including all storage objects, friends, groups, notifications — for deep analysis",
    {
      user_id: z.string().describe("The user's UUID"),
    },
    async ({ user_id }) => {
      const data = await console.exportAccount(user_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "list_notifications",
    "List notifications for a specific user or all users. Shows notification history and delivery status.",
    {
      user_id: z.string().optional().describe("Filter by user UUID"),
      limit: z.number().min(1).max(100).optional().describe("Max results per page"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
    async ({ user_id, limit, cursor }) => {
      const data = await console.listNotifications({ user_id, limit, cursor });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_user_friends",
    "Get the friends list for a specific user — useful for social graph analysis",
    {
      user_id: z.string().describe("The user's UUID"),
    },
    async ({ user_id }) => {
      const data = await console.getFriends(user_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_user_groups",
    "Get all groups a specific user belongs to — useful for community engagement analysis",
    {
      user_id: z.string().describe("The user's UUID"),
    },
    async ({ user_id }) => {
      const data = await console.getGroups(user_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
