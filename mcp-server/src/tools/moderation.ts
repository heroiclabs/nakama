import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient } from "../client.js";

export function registerModerationTools(
  server: McpServer,
  console: NakamaConsoleClient
) {
  server.tool(
    "ban_account",
    "Ban a user account. The user will be immediately disconnected and unable to authenticate. Use for abusive users, cheaters, or policy violations.",
    {
      user_id: z.string().describe("User UUID to ban"),
    },
    async ({ user_id }) => {
      await console.banAccount(user_id);
      return {
        content: [{ type: "text", text: `Account ${user_id} has been banned` }],
      };
    }
  );

  server.tool(
    "unban_account",
    "Lift a ban on a user account, allowing them to authenticate and play again.",
    {
      user_id: z.string().describe("User UUID to unban"),
    },
    async ({ user_id }) => {
      await console.unbanAccount(user_id);
      return {
        content: [{ type: "text", text: `Account ${user_id} has been unbanned` }],
      };
    }
  );
}
