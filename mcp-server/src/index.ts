import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, NakamaConsoleClient, NakamaApiClient } from "./client.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerStorageTools } from "./tools/storage.js";
import { registerLeaderboardTools } from "./tools/leaderboards.js";
import { registerEngagementTools } from "./tools/engagement.js";
import { registerModerationTools } from "./tools/moderation.js";
import { registerIdentityTools } from "./tools/identity.js";
import { registerEconomyTools } from "./tools/economy.js";
import { registerMatchmakingTools } from "./tools/matchmaking.js";
import { registerSocialTools } from "./tools/social.js";
import { registerTrustSafetyTools } from "./tools/trust_safety.js";
import { registerOperatorTools } from "./tools/operator.js";
import { registerEventPipelineTools } from "./tools/event_pipeline.js";
import { registerSocialV2Tools } from "./tools/social_v2.js";
import { registerLiveOpsTools } from "./tools/live_ops.js";
import { registerPersonalizationTools } from "./tools/personalization.js";
import { registerGameDepthTools } from "./tools/game_depth.js";
import { registerCrossGameTools } from "./tools/cross_game.js";
import { registerAnalyticsV2Tools } from "./tools/analytics_v2.js";
import { registerGameMetricsTools } from "./tools/game_metrics.js";
import { registerGiftingTools } from "./tools/gifting.js";
import { registerChatModerationTools } from "./tools/chat_moderation.js";
import { registerAiPlayerTools } from "./tools/ai_player.js";
import { registerResources } from "./resources.js";

const config = loadConfig();
const consoleClient = new NakamaConsoleClient(config);
const apiClient = new NakamaApiClient(config);

const server = new McpServer({
  name: "nakama-analytics",
  version: "2.0.0",
});

registerAnalyticsTools(server, consoleClient);
registerStorageTools(server, consoleClient);
registerLeaderboardTools(server, consoleClient);
registerEngagementTools(server, consoleClient, apiClient);
registerModerationTools(server, consoleClient);
registerIdentityTools(server, consoleClient, apiClient);
registerEconomyTools(server, consoleClient, apiClient);
registerMatchmakingTools(server, apiClient);
registerSocialTools(server, consoleClient, apiClient);
registerTrustSafetyTools(server, consoleClient, apiClient);
registerOperatorTools(server, consoleClient, apiClient);
registerEventPipelineTools(server, consoleClient, apiClient);
registerSocialV2Tools(server, consoleClient, apiClient);
registerLiveOpsTools(server, consoleClient, apiClient);
registerPersonalizationTools(server, consoleClient, apiClient);
registerGameDepthTools(server, consoleClient, apiClient);
registerCrossGameTools(server, consoleClient, apiClient);
registerAnalyticsV2Tools(server, consoleClient, apiClient);
registerGameMetricsTools(server, consoleClient, apiClient);
registerGiftingTools(server, consoleClient, apiClient);
registerChatModerationTools(server, consoleClient, apiClient);
registerAiPlayerTools(server, consoleClient, apiClient);
registerResources(server, consoleClient, apiClient);

const transport = new StdioServerTransport();
await server.connect(transport);
