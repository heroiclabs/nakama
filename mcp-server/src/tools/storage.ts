import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient } from "../client.js";

export function registerStorageTools(
  server: McpServer,
  console: NakamaConsoleClient
) {
  server.tool(
    "list_storage_collections",
    "List all storage collection names in the database. Collections include analytics_events, daily_streaks, wallets, user_sessions, group_chat, and many more.",
    {},
    async () => {
      const data = await console.listStorageCollections();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "list_storage",
    "Browse storage objects in a collection. Filter by collection name, key pattern, or user ID. Essential for analyzing player data, analytics events, sessions, chat messages, and retention data.",
    {
      collection: z.string().optional().describe("Collection name (e.g. 'analytics_events', 'daily_streaks', 'group_chat', 'wallets')"),
      key: z.string().optional().describe("Storage key filter"),
      user_id: z.string().optional().describe("Filter by user UUID"),
      cursor: z.string().optional().describe("Pagination cursor"),
      limit: z.number().min(1).max(100).optional().describe("Max results per page"),
    },
    async ({ collection, key, user_id, cursor, limit }) => {
      const data = await console.listStorage({ collection, key, user_id, cursor, limit });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_storage_object",
    "Read a specific storage object by collection, key, and user ID. Returns the full JSON value stored.",
    {
      collection: z.string().describe("Collection name"),
      key: z.string().describe("Object key"),
      user_id: z.string().describe("Owner user UUID"),
    },
    async ({ collection, key, user_id }) => {
      const data = await console.getStorageObject(collection, key, user_id);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "delete_storage_object",
    "Delete a specific storage object. Requires collection, key, user ID, and version string. Use for cleaning up corrupt or test data.",
    {
      collection: z.string().describe("Collection name"),
      key: z.string().describe("Object key"),
      user_id: z.string().describe("Owner user UUID"),
      version: z.string().describe("Object version (from list_storage or get_storage_object response)"),
    },
    async ({ collection, key, user_id, version }) => {
      await console.deleteStorageObject(collection, key, user_id, version);
      return {
        content: [{ type: "text", text: `Deleted storage object: ${collection}/${key} for user ${user_id}` }],
      };
    }
  );
}
