namespace LegacyWallet {

  var DEFAULT_REWARD_CONFIG = {
    game_name: "Default",
    score_to_coins_multiplier: 0.1,
    min_score_for_reward: 0,
    max_reward_per_match: 100000,
    currency: "coins",
    bonus_thresholds: [] as { score: number; bonus: number; type: string }[],
    streak_multipliers: {} as { [streak: number]: number }
  };

  function getGlobalApiConfig(nk: nkruntime.Nakama): { url: string; webhookSecret?: string; defaultGameId?: string } | null {
    var config = Storage.readSystemJson<{ url: string; webhookSecret?: string; defaultGameId?: string }>(nk, Constants.WALLETS_COLLECTION, "wallet_api_config");
    return config && config.url ? config : null;
  }

  function getConversionRatios(nk: nkruntime.Nakama): { [gameId: string]: number } {
    var data = Storage.readSystemJson<{ ratios?: { [gameId: string]: number } }>(nk, Constants.WALLETS_COLLECTION, "conversion_rate");
    return (data && data.ratios) ? data.ratios : {};
  }

  function getRewardConfig(nk: nkruntime.Nakama, gameId: string): typeof DEFAULT_REWARD_CONFIG {
    var cfg = Storage.readSystemJson<any>(nk, Constants.WALLETS_COLLECTION, "reward_config_" + gameId);
    if (!cfg) return DEFAULT_REWARD_CONFIG;
    return {
      game_name: cfg.game_name || "Default",
      score_to_coins_multiplier: cfg.score_to_coins_multiplier !== undefined ? cfg.score_to_coins_multiplier : 0.1,
      min_score_for_reward: cfg.min_score_for_reward !== undefined ? cfg.min_score_for_reward : 0,
      max_reward_per_match: cfg.max_reward_per_match !== undefined ? cfg.max_reward_per_match : 100000,
      currency: cfg.currency || "coins",
      bonus_thresholds: cfg.bonus_thresholds || [],
      streak_multipliers: cfg.streak_multipliers || {}
    };
  }

  function proxyGlobalApi(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, endpoint: string, body: any, gameId?: string): any {
    var config = getGlobalApiConfig(nk);
    if (!config || !config.url) {
      throw new Error("Global wallet API not configured. Store wallet_api_config in wallets collection.");
    }
    var url = config.url.replace(/\/$/, "") + "/game-bridge/s2s/wallet/" + endpoint;
    var bodyStr = JSON.stringify(body || {});
    var headers: { [key: string]: string } = {
      "Content-Type": "application/json",
      "X-Source": "nakama-rpc",
      "X-User-Id": userId,
      "X-Game-Id": gameId || config.defaultGameId || "00000000-0000-0000-0000-000000000000"
    };
    if (config.webhookSecret) {
      var sig: string = (nk.hmacSha256Hash(config.webhookSecret, bodyStr) as unknown) as string;
      headers["X-Webhook-Signature"] = sig;
    }
    return HttpClient.postJson(nk, url, body, headers);
  }

  function getGlobalWallet(nk: nkruntime.Nakama, userId: string): { userId: string; currencies: { [key: string]: number }; items: { [key: string]: number } } {
    var key = "global_" + userId;
    var wallet = Storage.readJson<{ userId: string; currencies: { [key: string]: number }; items: { [key: string]: number } }>(nk, Constants.WALLETS_COLLECTION, key, userId);
    if (!wallet) {
      wallet = { userId: userId, currencies: { global: 0, xut: 0, xp: 0 }, items: {} };
    }
    if (wallet.currencies) {
      if (wallet.currencies.global === undefined) wallet.currencies.global = wallet.currencies.xut || 0;
      if (wallet.currencies.xut === undefined) wallet.currencies.xut = wallet.currencies.global || 0;
    }
    return wallet;
  }

  function saveGlobalWallet(nk: nkruntime.Nakama, userId: string, wallet: { userId: string; currencies: { [key: string]: number }; items: { [key: string]: number } }): void {
    var key = "global_" + userId;
    Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, userId, wallet);
  }

  // ---- RPC implementations ----

  export function rpcGetUserWallet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var userId = ctx.userId || data.userId || data.sub;
      var username = ctx.username || data.username || userId;
      if (!userId) return RpcHelpers.errorResponse("User ID required");
      var key = "registry_" + userId;
      var registry = Storage.readJson<{ walletId: string; userId: string; gamesLinked: string[]; status: string; createdAt: string }>(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID);
      if (!registry) {
        registry = {
          walletId: userId,
          userId: userId,
          gamesLinked: [],
          status: "active",
          createdAt: new Date().toISOString()
        };
        Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID, registry);
      }
      return RpcHelpers.successResponse({
        walletId: registry.walletId,
        userId: registry.userId,
        status: registry.status,
        gamesLinked: registry.gamesLinked || [],
        createdAt: registry.createdAt
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "get_user_wallet failed");
    }
  }

  export function rpcLinkWalletToGame(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var gameId = data.gameId;
      if (!gameId) return RpcHelpers.errorResponse("gameId required");
      var userId = ctx.userId || data.userId || data.sub;
      var username = ctx.username || data.username || userId;
      if (!userId) return RpcHelpers.errorResponse("User ID required");
      var key = "registry_" + userId;
      var registry = Storage.readJson<{ walletId: string; userId: string; gamesLinked: string[] }>(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID);
      if (!registry) {
        registry = { walletId: userId, userId: userId, gamesLinked: [] };
      }
      if (!registry.gamesLinked) registry.gamesLinked = [];
      if (registry.gamesLinked.indexOf(gameId) === -1) {
        registry.gamesLinked.push(gameId);
      }
      Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID, registry);
      return RpcHelpers.successResponse({
        walletId: registry.walletId,
        gameId: gameId,
        gamesLinked: registry.gamesLinked,
        message: "Game successfully linked to wallet"
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "link_wallet_to_game failed");
    }
  }

  export function rpcGetWalletRegistry(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var limit = data.limit || 100;
      var result = nk.storageList(Constants.SYSTEM_USER_ID, Constants.WALLETS_COLLECTION, limit, "");
      var wallets: any[] = [];
      if (result && result.objects) {
        for (var i = 0; i < result.objects.length; i++) {
          var obj = result.objects[i];
          if (obj.key && obj.key.indexOf("registry_") === 0 && obj.value) {
            wallets.push(obj.value);
          }
        }
      }
      return RpcHelpers.successResponse({ wallets: wallets, count: wallets.length });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "get_wallet_registry failed");
    }
  }

  export function rpcWalletGetAll(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var globalWallet = getGlobalWallet(nk, userId);
      var result = Storage.listUserRecords(nk, Constants.WALLETS_COLLECTION, userId, 100);
      var gameWallets: any[] = [];
      var prefix = "wallet_" + userId + "_";
      for (var i = 0; i < result.records.length; i++) {
        var r = result.records[i];
        if (r.key && r.key.indexOf(prefix) === 0 && r.value) {
          gameWallets.push(r.value);
        }
      }
      return RpcHelpers.successResponse({
        userId: userId,
        globalWallet: globalWallet,
        gameWallets: gameWallets,
        timestamp: new Date().toISOString()
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "wallet_get_all failed");
    }
  }

  export function rpcWalletUpdateGlobal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var v = RpcHelpers.validatePayload(data, ["currency", "amount", "operation"]);
      if (!v.valid) return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
      var userId = RpcHelpers.requireUserId(ctx);
      var wallet = getGlobalWallet(nk, userId);
      if (!wallet.currencies[data.currency]) wallet.currencies[data.currency] = 0;
      var op = data.operation;
      var amt = Number(data.amount);
      if (op === "add") wallet.currencies[data.currency] += amt;
      else if (op === "subtract") {
        wallet.currencies[data.currency] -= amt;
        if (wallet.currencies[data.currency] < 0) wallet.currencies[data.currency] = 0;
      } else return RpcHelpers.errorResponse("Invalid operation");
      saveGlobalWallet(nk, userId, wallet);
      return RpcHelpers.successResponse({
        userId: userId,
        currency: data.currency,
        newBalance: wallet.currencies[data.currency],
        timestamp: new Date().toISOString()
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "wallet_update_global failed");
    }
  }

  export function rpcWalletUpdateGameWallet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var v = RpcHelpers.validatePayload(data, ["gameId", "currency", "amount", "operation"]);
      if (!v.valid) return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
      var userId = RpcHelpers.requireUserId(ctx);
      var wallet = WalletHelpers.getGameWallet(nk, userId, data.gameId);
      var currency = data.currency;
      var currenciesToUpdate = (currency === "game" || currency === "tokens") ? ["game", "tokens"] : [currency];
      var amt = Number(data.amount);
      var op = data.operation;
      for (var i = 0; i < currenciesToUpdate.length; i++) {
        var c = currenciesToUpdate[i];
        if (wallet.currencies[c] === undefined) wallet.currencies[c] = 0;
        if (op === "add") wallet.currencies[c] += amt;
        else if (op === "subtract") {
          wallet.currencies[c] -= amt;
          if (wallet.currencies[c] < 0) wallet.currencies[c] = 0;
        } else return RpcHelpers.errorResponse("Invalid operation");
      }
      WalletHelpers.saveGameWallet(nk, wallet);
      return RpcHelpers.successResponse({
        userId: userId,
        gameId: data.gameId,
        currency: currency,
        newBalance: wallet.currencies[currency] || wallet.currencies.game || 0,
        game_balance: wallet.currencies.game || 0,
        currencies: wallet.currencies,
        timestamp: new Date().toISOString()
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "wallet_update_game_wallet failed");
    }
  }

  export function rpcWalletTransferBetweenGameWallets(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var v = RpcHelpers.validatePayload(data, ["fromGameId", "toGameId", "currency", "amount"]);
      if (!v.valid) return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
      var userId = RpcHelpers.requireUserId(ctx);
      var from = WalletHelpers.getGameWallet(nk, userId, data.fromGameId);
      var to = WalletHelpers.getGameWallet(nk, userId, data.toGameId);
      var amt = Number(data.amount);
      var cur = data.currency;
      var bal = from.currencies[cur] || 0;
      if (bal < amt) return RpcHelpers.errorResponse("Insufficient balance in source wallet");
      from.currencies[cur] = bal - amt;
      to.currencies[cur] = (to.currencies[cur] || 0) + amt;
      WalletHelpers.saveGameWallet(nk, from);
      WalletHelpers.saveGameWallet(nk, to);
      return RpcHelpers.successResponse({
        userId: userId,
        fromGameId: data.fromGameId,
        toGameId: data.toGameId,
        currency: cur,
        amount: amt,
        fromBalance: from.currencies[cur],
        toBalance: to.currencies[cur],
        timestamp: new Date().toISOString()
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "wallet_transfer_between_game_wallets failed");
    }
  }

  export function rpcWalletGetBalances(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!data.gameId) return RpcHelpers.errorResponse("gameId required");
      var userId = RpcHelpers.requireUserId(ctx);
      var wallet = WalletHelpers.getGameWallet(nk, userId, data.gameId);
      var global = getGlobalWallet(nk, userId);
      var ratios = getConversionRatios(nk);
      var ratio = ratios[data.gameId] || 0;
      var gameBal = wallet.currencies.game || wallet.currencies.tokens || 0;
      var globalBal = global.currencies.global || global.currencies.xut || 0;
      var globalEquivalent = ratio > 0 ? Math.floor(gameBal / ratio) : 0;
      return RpcHelpers.successResponse({
        userId: userId,
        gameId: data.gameId,
        game_balance: gameBal,
        global_balance: globalBal,
        currencies: wallet.currencies,
        conversion: { ratio: ratio, globalEquivalent: globalEquivalent, canConvert: ratio > 0 && gameBal >= ratio, minConvertAmount: ratio },
        timestamp: new Date().toISOString()
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "wallet_get_balances failed");
    }
  }

  export function rpcWalletConvertPreview(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!data.gameId) return RpcHelpers.errorResponse("gameId required");
      var userId = RpcHelpers.requireUserId(ctx);
      var ratios = getConversionRatios(nk);
      var ratio = ratios[data.gameId] || 0;
      if (ratio <= 0) return RpcHelpers.errorResponse("No conversion ratio configured for game");
      var wallet = WalletHelpers.getGameWallet(nk, userId, data.gameId);
      var gameBal = wallet.currencies.game || wallet.currencies.tokens || 0;
      var reqAmt = data.amount != null ? Number(data.amount) : gameBal;
      if (reqAmt <= 0) return RpcHelpers.errorResponse("No game coins to convert");
      var globalYield = Math.floor(reqAmt / ratio);
      var coinsUsed = globalYield * ratio;
      var coinsLeft = reqAmt - coinsUsed;
      return RpcHelpers.successResponse({
        userId: userId,
        gameId: data.gameId,
        gameBalance: gameBal,
        requestedAmount: reqAmt,
        ratio: ratio,
        globalPointsYield: globalYield,
        coinsUsed: coinsUsed,
        coinsLeftOver: coinsLeft,
        canConvert: gameBal >= ratio,
        minConvertAmount: ratio,
        timestamp: new Date().toISOString()
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "wallet_convert_preview failed");
    }
  }

  export function rpcWalletConvertToGlobal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var v = RpcHelpers.validatePayload(data, ["gameId", "amount"]);
      if (!v.valid) return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
      var userId = RpcHelpers.requireUserId(ctx);
      var amt = Number(data.amount);
      if (isNaN(amt) || amt <= 0) return RpcHelpers.errorResponse("amount must be positive");
      var ratios = getConversionRatios(nk);
      var ratio = ratios[data.gameId] || 0;
      if (ratio <= 0) return RpcHelpers.errorResponse("No conversion ratio configured");
      if (amt < ratio) return RpcHelpers.errorResponse("Minimum conversion is " + ratio + " game coins");
      var wallet = WalletHelpers.getGameWallet(nk, userId, data.gameId);
      var gameBal = wallet.currencies.game || wallet.currencies.tokens || 0;
      if (gameBal < amt) return RpcHelpers.errorResponse("Insufficient game balance");
      var globalEarned = Math.floor(amt / ratio);
      var coinsBurned = globalEarned * ratio;
      var keys = ["game", "tokens"];
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (wallet.currencies[k] !== undefined) {
          wallet.currencies[k] -= coinsBurned;
          if (wallet.currencies[k] < 0) wallet.currencies[k] = 0;
        }
      }
      WalletHelpers.saveGameWallet(nk, wallet);
      var newGlobal: number | null = null;
      try {
        var res = proxyGlobalApi(nk, logger, userId, "earn", {
          amount: globalEarned,
          sourceType: "game_to_global_conversion",
          sourceId: data.gameId,
          description: "Converted " + coinsBurned + " game coins -> " + globalEarned + " global points"
        }, data.gameId);
        newGlobal = res && res.newBalance != null ? res.newBalance : null;
      } catch (_) { /* non-critical */ }
      return RpcHelpers.successResponse({
        userId: userId,
        gameId: data.gameId,
        coinsBurned: coinsBurned,
        globalPointsEarned: globalEarned,
        ratio: ratio,
        newGameBalance: wallet.currencies.game || wallet.currencies.tokens || 0,
        newGlobalBalance: newGlobal,
        timestamp: new Date().toISOString()
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "wallet_convert_to_global failed");
    }
  }

  export function rpcWalletConversionRate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var ratios = getConversionRatios(nk);
      if (data.gameId) {
        var r = ratios[data.gameId] || 0;
        return RpcHelpers.successResponse({
          gameId: data.gameId,
          ratio: r,
          configured: r > 0,
          description: r > 0 ? (r + " game coins = 1 global point") : "No conversion configured",
          timestamp: new Date().toISOString()
        });
      }
      return RpcHelpers.successResponse({ ratios: ratios, timestamp: new Date().toISOString() });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "wallet_conversion_rate failed");
    }
  }

  export function rpcGlobalToGameConvert(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var gameId = data.gameId || "";
      var amt = parseInt(String(data.amount), 10) || 0;
      if (!gameId) return RpcHelpers.errorResponse("gameId required");
      if (amt <= 0) return RpcHelpers.errorResponse("amount must be > 0");
      proxyGlobalApi(nk, logger, userId, "spend", {
        amount: amt,
        sourceType: "global_to_game_convert",
        sourceId: "game:" + gameId,
        description: "Convert " + amt + " global points to game currency"
      }, gameId);
      var ratios = getConversionRatios(nk);
      var ratio = ratios[gameId] || 100;
      var gameCurrency = amt * ratio;
      var wallet = WalletHelpers.getGameWallet(nk, userId, gameId);
      var cur = data.currency || "game";
      wallet.currencies[cur] = (wallet.currencies[cur] || 0) + gameCurrency;
      WalletHelpers.saveGameWallet(nk, wallet);
      return RpcHelpers.successResponse({
        userId: userId,
        gameId: gameId,
        globalPointsSpent: amt,
        gameCurrencyEarned: gameCurrency,
        conversionRatio: ratio,
        timestamp: new Date().toISOString()
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "global_to_game_convert failed");
    }
  }

  export function rpcGlobalWalletBalance(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var result = proxyGlobalApi(nk, logger, userId, "balance", {});
      return RpcHelpers.successResponse({ userId: userId, balance: result.balance || result || 0 });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "global_wallet_balance failed");
    }
  }

  export function rpcGlobalWalletEarn(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!data.amount || data.amount <= 0) return RpcHelpers.errorResponse("amount required and must be > 0");
      var body = {
        amount: data.amount,
        sourceType: data.sourceType || "nakama_rpc",
        sourceId: data.sourceId || ("rpc:" + userId),
        description: data.description || "Earn via Nakama RPC"
      };
      var result = proxyGlobalApi(nk, logger, userId, "earn", body, data.gameId);
      return RpcHelpers.successResponse({ userId: userId, result: result });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "global_wallet_earn failed");
    }
  }

  export function rpcGlobalWalletSpend(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!data.amount || data.amount <= 0) return RpcHelpers.errorResponse("amount required and must be > 0");
      var body = {
        amount: data.amount,
        sourceType: data.sourceType || "nakama_rpc",
        sourceId: data.sourceId || ("rpc:" + userId),
        description: data.description || "Spend via Nakama RPC"
      };
      var result = proxyGlobalApi(nk, logger, userId, "spend", body, data.gameId);
      return RpcHelpers.successResponse({ userId: userId, result: result });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "global_wallet_spend failed");
    }
  }

  export function rpcGlobalWalletHistory(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var body = { page: data.page || 1, limit: data.limit || 20 };
      var result = proxyGlobalApi(nk, logger, userId, "history", body);
      return RpcHelpers.successResponse({ userId: userId, result: result });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "global_wallet_history failed");
    }
  }

  export function rpcCreatePlayerWallet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var deviceId = data.device_id || data.deviceId;
      var gameId = data.game_id || data.gameId;
      if (!deviceId || !gameId) return RpcHelpers.errorResponse("device_id and game_id required");
      var userId = ctx.userId || deviceId;
      var gameWallet = WalletHelpers.getGameWallet(nk, userId, gameId);
      var globalWallet = getGlobalWallet(nk, userId);
      var key = "registry_" + userId;
      var registry = Storage.readJson<any>(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID);
      if (!registry) {
        registry = { walletId: userId, userId: userId, gamesLinked: [gameId], status: "active", createdAt: new Date().toISOString() };
        Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID, registry);
      } else if (registry.gamesLinked && registry.gamesLinked.indexOf(gameId) === -1) {
        registry.gamesLinked.push(gameId);
        Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID, registry);
      }
      return RpcHelpers.successResponse({
        wallet_id: registry.walletId,
        global_wallet_id: userId,
        game_wallet: { wallet_id: "wallet_" + userId + "_" + gameId, balance: gameWallet.currencies.game || 0, currency: "game", game_id: gameId },
        global_wallet: { wallet_id: "global_" + userId, balance: globalWallet.currencies.global || 0, currency: "global" },
        message: "Player wallet created successfully"
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "create_player_wallet failed");
    }
  }

  export function rpcUpdateWalletBalance(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var deviceId = data.device_id || data.deviceId;
      var gameId = data.game_id || data.gameId;
      if (!deviceId || !gameId) return RpcHelpers.errorResponse("device_id and game_id required");
      if (data.balance === undefined || data.balance === null) return RpcHelpers.errorResponse("balance required");
      var userId = ctx.userId || deviceId;
      var bal = Number(data.balance);
      if (isNaN(bal) || bal < 0) return RpcHelpers.errorResponse("balance must be non-negative");
      var walletType = data.wallet_type || data.walletType || "game";
      if (walletType === "global") {
        var gw = getGlobalWallet(nk, userId);
        gw.currencies.global = gw.currencies.xut = bal;
        saveGlobalWallet(nk, userId, gw);
        return RpcHelpers.successResponse({ wallet_type: "global", balance: bal, message: "Wallet balance updated" });
      } else {
        var w = WalletHelpers.getGameWallet(nk, userId, gameId);
        w.currencies.game = w.currencies.tokens = bal;
        WalletHelpers.saveGameWallet(nk, w);
        return RpcHelpers.successResponse({ wallet_type: "game", balance: bal, message: "Wallet balance updated" });
      }
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "update_wallet_balance failed");
    }
  }

  export function rpcGetWalletBalance(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var deviceId = data.device_id || data.deviceId;
      var gameId = data.game_id || data.gameId;
      if (!deviceId || !gameId) return RpcHelpers.errorResponse("device_id and game_id required");
      var userId = ctx.userId || deviceId;
      var gameWallet = WalletHelpers.getGameWallet(nk, userId, gameId);
      var globalWallet = getGlobalWallet(nk, userId);
      return RpcHelpers.successResponse({
        game_wallet: { wallet_id: "wallet_" + userId + "_" + gameId, balance: gameWallet.currencies.game || 0, currency: "game", game_id: gameId },
        global_wallet: { wallet_id: "global_" + userId, balance: globalWallet.currencies.global || 0, currency: "global" },
        device_id: deviceId,
        game_id: gameId
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "get_wallet_balance failed");
    }
  }

  export function rpcCreateOrGetWallet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var deviceId = data.device_id || data.deviceId;
      var gameId = data.game_id || data.gameId;
      if (!deviceId || !gameId) return RpcHelpers.errorResponse("device_id and game_id required");
      var userId = ctx.userId || deviceId;
      var gameWallet = WalletHelpers.getGameWallet(nk, userId, gameId);
      var globalWallet = getGlobalWallet(nk, userId);
      return RpcHelpers.successResponse({
        game_wallet: { wallet_id: "wallet_" + userId + "_" + gameId, balance: gameWallet.currencies.game || 0, currency: "game", game_id: gameId },
        global_wallet: { wallet_id: "global_" + userId, balance: globalWallet.currencies.global || 0, currency: "global" }
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "create_or_get_wallet failed");
    }
  }

  function calculateScoreReward(nk: nkruntime.Nakama, gameId: string, score: number, currentStreak: number): { reward: number; currency: string; bonuses: any[]; details: any } {
    var config = getRewardConfig(nk, gameId);
    if (score < config.min_score_for_reward) {
      return {
        reward: 0,
        currency: config.currency,
        bonuses: [],
        details: { reason: "below_minimum", min_required: config.min_score_for_reward }
      };
    }
    var baseReward = Math.floor(score * config.score_to_coins_multiplier);
    var streakMult = 1.0;
    if (currentStreak && config.streak_multipliers) {
      var keys = Object.keys(config.streak_multipliers).map(Number).sort((a, b) => b - a);
      for (var i = 0; i < keys.length; i++) {
        if (currentStreak >= keys[i]) {
          streakMult = config.streak_multipliers[keys[i]];
          break;
        }
      }
    }
    var rewardWithStreak = Math.floor(baseReward * streakMult);
    var bonuses: any[] = [];
    var totalBonus = 0;
    if (config.bonus_thresholds) {
      for (var j = 0; j < config.bonus_thresholds.length; j++) {
        var t = config.bonus_thresholds[j];
        if (score >= t.score) {
          bonuses.push({ type: t.type, amount: t.bonus, threshold: t.score });
          totalBonus += t.bonus;
        }
      }
    }
    var finalReward = Math.min(rewardWithStreak + totalBonus, config.max_reward_per_match);
    return {
      reward: finalReward,
      currency: config.currency,
      bonuses: bonuses,
      details: {
        game_name: config.game_name,
        score: score,
        base_reward: baseReward,
        multiplier: config.score_to_coins_multiplier,
        streak: currentStreak,
        streak_multiplier: streakMult,
        milestone_bonus: totalBonus,
        final_reward: finalReward,
        capped: finalReward === config.max_reward_per_match
      }
    };
  }

  export function rpcCalculateScoreReward(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var gameId = data.game_id || data.gameId;
      if (!gameId) return RpcHelpers.errorResponse("game_id required");
      if (data.score === undefined && data.score !== 0) return RpcHelpers.errorResponse("score required");
      var score = parseInt(String(data.score), 10) || 0;
      var streak = data.current_streak != null ? parseInt(String(data.current_streak), 10) || 0 : 0;
      var result = calculateScoreReward(nk, gameId, score, streak);
      return RpcHelpers.successResponse({
        reward: result.reward,
        currency: result.currency,
        bonuses: result.bonuses,
        details: result.details
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "calculate_score_reward failed");
    }
  }

  export function rpcUpdateGameRewardConfig(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var gameId = data.game_id || data.gameId;
      if (!gameId) return RpcHelpers.errorResponse("game_id required");
      var config = data.config;
      if (!config) return RpcHelpers.errorResponse("config object required");
      if (config.score_to_coins_multiplier === undefined || config.min_score_for_reward === undefined ||
          config.max_reward_per_match === undefined || !config.currency) {
        return RpcHelpers.errorResponse("Invalid config: score_to_coins_multiplier, min_score_for_reward, max_reward_per_match, currency required");
      }
      Storage.writeSystemJson(nk, Constants.WALLETS_COLLECTION, "reward_config_" + gameId, config);
      return RpcHelpers.successResponse({
        game_id: gameId,
        config: config,
        message: "Reward configuration updated successfully"
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "update_game_reward_config failed");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("get_user_wallet", rpcGetUserWallet);
    initializer.registerRpc("link_wallet_to_game", rpcLinkWalletToGame);
    initializer.registerRpc("get_wallet_registry", rpcGetWalletRegistry);
    initializer.registerRpc("wallet_get_all", rpcWalletGetAll);
    initializer.registerRpc("wallet_update_global", rpcWalletUpdateGlobal);
    initializer.registerRpc("wallet_update_game_wallet", rpcWalletUpdateGameWallet);
    initializer.registerRpc("wallet_transfer_between_game_wallets", rpcWalletTransferBetweenGameWallets);
    initializer.registerRpc("wallet_get_balances", rpcWalletGetBalances);
    initializer.registerRpc("wallet_convert_preview", rpcWalletConvertPreview);
    initializer.registerRpc("wallet_convert_to_global", rpcWalletConvertToGlobal);
    initializer.registerRpc("wallet_conversion_rate", rpcWalletConversionRate);
    initializer.registerRpc("global_to_game_convert", rpcGlobalToGameConvert);
    initializer.registerRpc("global_wallet_balance", rpcGlobalWalletBalance);
    initializer.registerRpc("global_wallet_earn", rpcGlobalWalletEarn);
    initializer.registerRpc("global_wallet_spend", rpcGlobalWalletSpend);
    initializer.registerRpc("global_wallet_history", rpcGlobalWalletHistory);
    initializer.registerRpc("create_player_wallet", rpcCreatePlayerWallet);
    initializer.registerRpc("update_wallet_balance", rpcUpdateWalletBalance);
    initializer.registerRpc("get_wallet_balance", rpcGetWalletBalance);
    initializer.registerRpc("create_or_get_wallet", rpcCreateOrGetWallet);
    initializer.registerRpc("calculate_score_reward", rpcCalculateScoreReward);
    initializer.registerRpc("update_game_reward_config", rpcUpdateGameRewardConfig);
  }
}
