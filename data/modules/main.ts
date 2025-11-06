import { InitModule } from "@heroiclabs/nakama-runtime";
import { createAllLeaderboardsPersistent } from "./leaderboard_rpc";

const InitModule: InitModule = function (ctx, logger, nk, initializer) {
  initializer.registerRpc("create_all_leaderboards_persistent", createAllLeaderboardsPersistent);
  logger.info("Custom RPC registered successfully.");
};

export { InitModule };
