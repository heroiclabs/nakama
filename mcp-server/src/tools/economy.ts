import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

export function registerEconomyTools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  server.tool(
    "wallet_get",
    "Get wallet balances for a player across game and global wallets. Shows currency amounts, last updated timestamps.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
    },
    async ({ device_id, game_id }) => {
      const data = await api.callRpc("get_wallet_balance", {
        device_id,
        game_id,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "wallet_get_all",
    "Get all wallets for a user across all games. Returns game wallets and global wallet with full balance details.",
    {
      device_id: z.string().describe("Device ID"),
    },
    async ({ device_id }) => {
      const data = await api.callRpc("wallet_get_all", { device_id });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "wallet_update",
    "Update a player's wallet balance. Supports both game-specific and global wallets. Use idempotency key to prevent double-crediting on retries. SENSITIVE: credits/debits real currency.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
      balance: z.number().describe("Amount to add (positive) or subtract (negative)"),
      wallet_type: z.enum(["game", "global"]).optional().describe("Which wallet to update (default: game)"),
      reason: z.string().optional().describe("Audit reason for the wallet change"),
    },
    async ({ device_id, game_id, balance, wallet_type, reason }) => {
      const rpc = wallet_type === "global" ? "wallet_update_global" : "wallet_update_game_wallet";
      const data = await api.callRpc(rpc, {
        device_id,
        game_id,
        balance,
        reason: reason ?? "agent_operator",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "wallet_transfer",
    "Transfer currency between a player's game wallets. Atomic operation — both wallets update together.",
    {
      device_id: z.string().describe("Device ID"),
      from_game_id: z.string().describe("Source game ID"),
      to_game_id: z.string().describe("Destination game ID"),
      amount: z.number().positive().describe("Amount to transfer"),
    },
    async ({ device_id, from_game_id, to_game_id, amount }) => {
      const data = await api.callRpc("wallet_transfer_between_game_wallets", {
        device_id,
        from_game_id,
        to_game_id,
        amount,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "inventory_grant",
    "Grant an item to a player's inventory. Supports quantity. Game-specific (QuizVerse or LastToLive).",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
      item_id: z.string().describe("Item identifier/SKU"),
      quantity: z.number().int().positive().optional().describe("Quantity to grant (default 1)"),
      game_prefix: z.enum(["quizverse", "lasttolive"]).describe("Game prefix for the RPC"),
    },
    async ({ device_id, game_id, item_id, quantity, game_prefix }) => {
      const data = await api.callRpc(`${game_prefix}_grant_item`, {
        device_id,
        game_id,
        item_id,
        quantity: quantity ?? 1,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "inventory_remove",
    "Remove/consume an item from a player's inventory.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
      item_id: z.string().describe("Item identifier/SKU"),
      quantity: z.number().int().positive().optional().describe("Quantity to remove (default 1)"),
      game_prefix: z.enum(["quizverse", "lasttolive"]).describe("Game prefix for the RPC"),
    },
    async ({ device_id, game_id, item_id, quantity, game_prefix }) => {
      const data = await api.callRpc(`${game_prefix}_consume_item`, {
        device_id,
        game_id,
        item_id,
        quantity: quantity ?? 1,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "inventory_list",
    "List all items in a player's inventory for a specific game.",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
      game_prefix: z.enum(["quizverse", "lasttolive"]).describe("Game prefix for the RPC"),
    },
    async ({ device_id, game_id, game_prefix }) => {
      const data = await api.callRpc(`${game_prefix}_list_inventory`, {
        device_id,
        game_id,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "catalog_get_config",
    "Get the server configuration / item catalog for a game. Includes available items, pricing, reward tables.",
    {
      game_id: z.string().describe("Game ID"),
      game_prefix: z.enum(["quizverse", "lasttolive"]).describe("Game prefix"),
    },
    async ({ game_id, game_prefix }) => {
      const data = await api.callRpc(`${game_prefix}_get_server_config`, {
        game_id,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "grant_currency",
    "Grant currency to a player in a specific game. Separate from wallet — this is the in-game currency system (coins, gems, etc.).",
    {
      device_id: z.string().describe("Device ID"),
      game_id: z.string().describe("Game ID"),
      amount: z.number().positive().describe("Currency amount to grant"),
      currency_type: z.string().optional().describe("Currency type (default: primary)"),
      game_prefix: z.enum(["quizverse", "lasttolive"]).describe("Game prefix"),
    },
    async ({ device_id, game_id, amount, currency_type, game_prefix }) => {
      const data = await api.callRpc(`${game_prefix}_grant_currency`, {
        device_id,
        game_id,
        amount,
        currency_type: currency_type ?? "primary",
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "batch_wallet_operations",
    "Execute multiple wallet operations atomically. Useful for distributing rewards to many players at once or complex multi-step economy transactions.",
    {
      operations: z.array(z.object({
        device_id: z.string(),
        game_id: z.string(),
        balance: z.number(),
        wallet_type: z.enum(["game", "global"]).optional(),
      })).describe("Array of wallet operations to execute"),
    },
    async ({ operations }) => {
      const data = await api.callRpc("batch_wallet_operations", { operations });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
