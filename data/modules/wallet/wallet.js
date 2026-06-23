// wallet.js - Enhanced Wallet System (Global + Per-Game Sub-Wallets)

/**
 * Get or create global wallet for user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @returns {object} Global wallet data
 */
function getGlobalWallet(nk, logger, userId) {
    var collection = "wallets";
    var key = utils.makeGlobalStorageKey("global_wallet", userId);
    
    var wallet = utils.readStorage(nk, logger, collection, key, userId);
    
    if (!wallet) {
        // Initialize new global wallet
        wallet = {
            userId: userId,
            currencies: {
                xut: 0,
                xp: 0
            },
            items: {},
            nfts: [],
            createdAt: utils.getCurrentTimestamp()
        };
    }
    
    return wallet;
}

/**
 * Get or create game-specific wallet for user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @returns {object} Game wallet data
 */
function getGameWallet(nk, logger, userId, gameId) {
    var collection = "wallets";
    var key = utils.makeGameStorageKey("wallet", userId, gameId);
    
    var wallet = utils.readStorage(nk, logger, collection, key, userId);
    
    if (!wallet) {
        // Initialize new game wallet
        wallet = {
            userId: userId,
            gameId: gameId,
            currencies: {
                tokens: 0,
                xp: 0
            },
            items: {},
            consumables: {},
            cosmetics: {},
            createdAt: utils.getCurrentTimestamp()
        };
    }
    
    return wallet;
}

/**
 * Save global wallet
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {object} wallet - Wallet data
 * @returns {boolean} Success status
 */
function saveGlobalWallet(nk, logger, userId, wallet) {
    var collection = "wallets";
    var key = utils.makeGlobalStorageKey("global_wallet", userId);
    wallet.updatedAt = utils.getCurrentTimestamp();
    return utils.writeStorage(nk, logger, collection, key, userId, wallet);
}

/**
 * Save game wallet
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {string} gameId - Game ID (UUID)
 * @param {object} wallet - Wallet data
 * @returns {boolean} Success status
 */
function saveGameWallet(nk, logger, userId, gameId, wallet) {
    var collection = "wallets";
    var key = utils.makeGameStorageKey("wallet", userId, gameId);
    wallet.updatedAt = utils.getCurrentTimestamp();
    return utils.writeStorage(nk, logger, collection, key, userId, wallet);
}

/**
 * Log transaction
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID
 * @param {object} transaction - Transaction data
 */
function logTransaction(nk, logger, userId, transaction) {
    var key = "transaction_log_" + userId + "_" + utils.getUnixTimestamp();
    transaction.timestamp = utils.getCurrentTimestamp();
    utils.writeStorage(nk, logger, "transaction_logs", key, userId, transaction);
}

/**
 * RPC: Get all wallets (global + all game wallets)
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload (empty)
 * @returns {string} JSON response
 */
function rpcWalletGetAll(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC wallet_get_all called");
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    // Get global wallet
    var globalWallet = getGlobalWallet(nk, logger, userId);
    
    // Get all game wallets
    var gameWallets = [];
    try {
        var records = nk.storageList(userId, "wallets", 100);
        for (var i = 0; i < records.length; i++) {
            if (records[i].key.indexOf("wallet_" + userId + "_") === 0) {
                gameWallets.push(records[i].value);
            }
        }
    } catch (err) {
        utils.logWarn(logger, "Failed to list game wallets: " + err.message);
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        globalWallet: globalWallet,
        gameWallets: gameWallets,
        timestamp: utils.getCurrentTimestamp()
    });
}

/**
 * RPC: Update global wallet
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON payload with { currency: "xut", amount: 100, operation: "add" }
 * @returns {string} JSON response
 */
function rpcWalletUpdateGlobal(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC wallet_update_global called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['currency', 'amount', 'operation']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var currency = data.currency;
    var amount = Number(data.amount);
    var operation = data.operation; // "add" or "subtract"

    if (!isFinite(amount) || amount < 0) {
        return utils.handleError(ctx, null, "Invalid amount: must be a non-negative finite number");
    }
    
    // Get global wallet
    var wallet = getGlobalWallet(nk, logger, userId);
    
    // Initialize currency if not exists
    if (!wallet.currencies[currency]) {
        wallet.currencies[currency] = 0;
    }
    
    // Update currency
    if (operation === "add") {
        wallet.currencies[currency] += amount;
    } else if (operation === "subtract") {
        wallet.currencies[currency] -= amount;
        if (wallet.currencies[currency] < 0) {
            wallet.currencies[currency] = 0;
        }
    } else {
        return utils.handleError(ctx, null, "Invalid operation: " + operation);
    }
    
    // Save wallet
    if (!saveGlobalWallet(nk, logger, userId, wallet)) {
        return utils.handleError(ctx, null, "Failed to save global wallet");
    }
    
    // Log transaction
    logTransaction(nk, logger, userId, {
        type: "global_wallet_update",
        currency: currency,
        amount: amount,
        operation: operation,
        newBalance: wallet.currencies[currency]
    });
    
    return JSON.stringify({
        success: true,
        userId: userId,
        currency: currency,
        newBalance: wallet.currencies[currency],
        timestamp: utils.getCurrentTimestamp()
    });
}

function rpcWalletUpdateGameWallet(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC wallet_update_game_wallet called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed. data;
    var validation = utils.validatePayload(data, ['gameId', 'currency', 'amount', 'operation']);
    if (! validation.valid) {
        return utils. handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var gameId = data.gameId;
    if (!utils. isValidUUID(gameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx. userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var currency = data.currency;
    var amount = Number(data.amount);
    var operation = data.operation;

    if (!isFinite(amount) || amount < 0) {
        return utils.handleError(ctx, null, "Invalid amount: must be a non-negative finite number");
    }
    
    //  NORMALIZE CURRENCY KEY - Map client aliases to storage keys
    var storageCurrency = currency;
    if (currency === "game") {
        storageCurrency = "game";  // Keep as "game" for consistency
    } else if (currency === "global") {
        storageCurrency = "global";
    }
    
    // Get game wallet
    var wallet = getGameWallet(nk, logger, userId, gameId);
    
    // Initialize currency if not exists
    if (wallet.currencies[storageCurrency] === undefined || wallet.currencies[storageCurrency] === null) {
        wallet.currencies[storageCurrency] = 0;
    }
    
    // Update currency
    if (operation === "add") {
        wallet.currencies[storageCurrency] += amount;
    } else if (operation === "subtract") {
        wallet.currencies[storageCurrency] -= amount;
        if (wallet.currencies[storageCurrency] < 0) {
            wallet. currencies[storageCurrency] = 0;
        }
    } else {
        return utils.handleError(ctx, null, "Invalid operation: " + operation);
    }
    
    //  CRITICAL: Save wallet - ensure this succeeds
    var saveResult = saveGameWallet(nk, logger, userId, gameId, wallet);
    if (!saveResult) {
        utils.logError(logger, "Failed to save game wallet for user: " + userId + ", game: " + gameId);
        return utils.handleError(ctx, null, "Failed to save game wallet");
    }
    
    utils.logInfo(logger, "Successfully saved wallet.  New balance for " + storageCurrency + ": " + wallet. currencies[storageCurrency]);
    
    // Log transaction
    logTransaction(nk, logger, userId, {
        type: "game_wallet_update",
        gameId: gameId,
        currency: storageCurrency,
        amount: amount,
        operation: operation,
        newBalance: wallet.currencies[storageCurrency]
    });
    
    // Return both the specific currency AND the common aliases
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        currency: storageCurrency,
        newBalance: wallet.currencies[storageCurrency],
        // Also return as game_balance/global_balance for Unity compatibility
        game_balance: wallet. currencies["game"] || wallet.currencies["tokens"] || 0,
        global_balance: wallet.currencies["global"] || wallet.currencies["xut"] || 0,
        currencies: wallet.currencies,
        timestamp: utils.getCurrentTimestamp()
    });
}

/**
 * RPC: Transfer between game wallets
 * @param {object} ctx - Request context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime
 * @param {string} payload - JSON with { fromGameId: "uuid", toGameId: "uuid", currency: "tokens", amount: 100 }
 * @returns {string} JSON response
 */
function rpcWalletTransferBetweenGameWallets(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC wallet_transfer_between_game_wallets called");
    
    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }
    
    var data = parsed.data;
    var validation = utils.validatePayload(data, ['fromGameId', 'toGameId', 'currency', 'amount']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }
    
    var fromGameId = data.fromGameId;
    var toGameId = data.toGameId;
    
    if (!utils.isValidUUID(fromGameId) || !utils.isValidUUID(toGameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }
    
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }
    
    var currency = data.currency;
    var amount = Number(data.amount);

    if (!isFinite(amount) || amount <= 0) {
        return utils.handleError(ctx, null, "Invalid amount: must be a positive finite number");
    }
    
    // Get both wallets
    var fromWallet = getGameWallet(nk, logger, userId, fromGameId);
    var toWallet = getGameWallet(nk, logger, userId, toGameId);
    
    // Check if source wallet has enough
    if (!fromWallet.currencies[currency] || fromWallet.currencies[currency] < amount) {
        return JSON.stringify({
            success: false,
            error: "Insufficient balance in source wallet"
        });
    }
    
    // Transfer
    fromWallet.currencies[currency] -= amount;
    if (!toWallet.currencies[currency]) {
        toWallet.currencies[currency] = 0;
    }
    toWallet.currencies[currency] += amount;
    
    // Save both wallets
    if (!saveGameWallet(nk, logger, userId, fromGameId, fromWallet)) {
        return utils.handleError(ctx, null, "Failed to save source wallet");
    }
    if (!saveGameWallet(nk, logger, userId, toGameId, toWallet)) {
        return utils.handleError(ctx, null, "Failed to save destination wallet");
    }
    
    // Log transaction
    logTransaction(nk, logger, userId, {
        type: "wallet_transfer",
        fromGameId: fromGameId,
        toGameId: toGameId,
        currency: currency,
        amount: amount
    });
    
    return JSON.stringify({
        success: true,
        userId: userId,
        fromGameId: fromGameId,
        toGameId: toGameId,
        currency: currency,
        amount: amount,
        fromBalance: fromWallet.currencies[currency],
        toBalance: toWallet.currencies[currency],
        timestamp: utils.getCurrentTimestamp()
    });
}
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TUTORX AI COIN GATE — tracks daily free tier + game wallet
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

var TUTORX_CONFIG = {
    FREE_MESSAGES_PER_DAY: 5,
    COST_PER_MESSAGE: 20,
    COLLECTION: "tutorx_daily_usage"
};

/**
 * Resolve which currency key holds the TutorX coin balance for a wallet.
 * Defined in tutorx/tutorx_coin_gate.js when merged; keep local fallback for tests.
 */
if (typeof tutorxCurrencyKey !== "function") {
    function tutorxCurrencyKey(wallet) {
        if (wallet && wallet.currencies && typeof wallet.currencies.game === "number") return "game";
        return "tokens";
    }
}
if (typeof tutorxCoinBalance !== "function") {
    function tutorxCoinBalance(wallet) {
        if (!wallet || !wallet.currencies) return 0;
        var v = wallet.currencies[tutorxCurrencyKey(wallet)];
        return (typeof v === "number") ? v : 0;
    }
}

/**
 * RPC: Check if user can send TutorX AI message
 * Returns daily free tier status + coin balance for gating
 * Payload: { gameId: "uuid" } (optional, defaults to QuizVerse ID)
 */
function rpcTutorXCheckAllowance(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC tutorx_check_allowance called");

    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }

    var parsed = utils.safeJsonParse(payload || "{}");
    var data = parsed.data || {};
    var gameId = data.gameId || "126bf539-dae2-4bcf-964d-316c0fa1f92b";
    var charge = tutorxResolveServiceCharge(data, TUTORX_CONFIG);
    var today = tutorxTodayKey();

    var usage = tutorxReadUsage(nk, TUTORX_CONFIG.COLLECTION, userId, today, TUTORX_CONFIG.FREE_MESSAGES_PER_DAY);
    var freeRemaining = tutorxFreeRemaining(usage, TUTORX_CONFIG.FREE_MESSAGES_PER_DAY);

    var coinBalance = 0;
    try {
        var wallet = getGameWallet(nk, logger, userId, gameId);
        coinBalance = tutorxCoinBalance(wallet);
    } catch (err) {
        utils.logWarn(logger, "tutorx_check_allowance: wallet read error: " + err.message);
    }

    var canUse = (charge.useFreeTier && freeRemaining > 0) || coinBalance >= charge.cost;

    return JSON.stringify({
        success: true,
        canUse: canUse,
        freeRemaining: freeRemaining,
        freeLimit: TUTORX_CONFIG.FREE_MESSAGES_PER_DAY,
        coinBalance: coinBalance,
        costPerMsg: charge.cost,
        service: charge.service,
        useFreeTier: charge.useFreeTier,
        usedToday: usage.usedToday,
        userId: userId,
        gameId: gameId,
        timestamp: utils.getCurrentTimestamp()
    });
}

/**
 * RPC: Record TutorX AI message usage
 * Increments daily usage counter (call after each AI message)
 * Payload: { gameId: "uuid" } (optional)
 */
function rpcTutorXRecordUsage(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC tutorx_record_usage called");

    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }

    var parsed = utils.safeJsonParse(payload || "{}");
    var data = parsed.data || {};
    var gameId = data.gameId || "126bf539-dae2-4bcf-964d-316c0fa1f92b";
    var charge = tutorxResolveServiceCharge(data, TUTORX_CONFIG);
    var today = tutorxTodayKey();

    var usage = tutorxReadUsage(nk, TUTORX_CONFIG.COLLECTION, userId, today, TUTORX_CONFIG.FREE_MESSAGES_PER_DAY);
    var freeRemaining = tutorxFreeRemaining(usage, TUTORX_CONFIG.FREE_MESSAGES_PER_DAY);
    var usesFreeSlot = charge.useFreeTier && freeRemaining > 0;
    var coinCharged = 0;
    var coinBalance = 0;

    if (!usesFreeSlot) {
        var wallet = null;
        try {
            wallet = getGameWallet(nk, logger, userId, gameId);
        } catch (err) {
            utils.logWarn(logger, "tutorx_record_usage: wallet read error: " + err.message);
        }

        if (wallet) {
            var currentBal = tutorxCoinBalance(wallet);
            if (currentBal < charge.cost) {
                return JSON.stringify({
                    success: false,
                    error: "insufficient_coins",
                    coinBalance: currentBal,
                    costPerMsg: charge.cost,
                    service: charge.service,
                    timestamp: utils.getCurrentTimestamp()
                });
            }
            var currencyKey = tutorxCurrencyKey(wallet);
            wallet.currencies[currencyKey] -= charge.cost;
            coinCharged = charge.cost;
            coinBalance = wallet.currencies[currencyKey];
            try {
                saveGameWallet(nk, logger, userId, gameId, wallet);
                logTransaction(nk, logger, userId, {
                    type: "tutorx_coin_charge",
                    gameId: gameId,
                    service: charge.service,
                    currency: currencyKey,
                    amount: coinCharged,
                    operation: "subtract",
                    newBalance: coinBalance
                });
            } catch (err) {
                utils.logError(logger, "tutorx_record_usage: wallet save failed: " + err.message);
            }
        }

        usage.paidToday = (usage.paidToday || 0) + 1;
    } else {
        try {
            var w = getGameWallet(nk, logger, userId, gameId);
            coinBalance = tutorxCoinBalance(w);
        } catch (err) {
            utils.logWarn(logger, "tutorx_record_usage: wallet read (balance-only) error: " + err.message);
        }
        usage.freeUsedToday = (usage.freeUsedToday || 0) + 1;
    }

    usage.usedToday = (usage.usedToday || 0) + 1;
    usage.date = today;

    try {
        tutorxWriteUsage(nk, TUTORX_CONFIG.COLLECTION, userId, today, usage);
    } catch (err) {
        utils.logError(logger, "tutorx_record_usage: storage write failed: " + err.message);
        return utils.handleError(ctx, null, "Failed to record usage");
    }

    freeRemaining = tutorxFreeRemaining(usage, TUTORX_CONFIG.FREE_MESSAGES_PER_DAY);

    utils.logInfo(logger, "tutorx_record_usage: user=" + userId + " service=" + charge.service + " usedToday=" + usage.usedToday + " coinCharged=" + coinCharged + " coinBalance=" + coinBalance);

    return JSON.stringify({
        success: true,
        usedToday: usage.usedToday,
        freeRemaining: freeRemaining,
        freeLimit: TUTORX_CONFIG.FREE_MESSAGES_PER_DAY,
        coinCharged: coinCharged,
        coinsDeducted: coinCharged,
        coinBalance: coinBalance,
        costPerMsg: charge.cost,
        service: charge.service,
        useFreeTier: charge.useFreeTier,
        timestamp: utils.getCurrentTimestamp()
    });
}

/**
 * RPC: Refresh (re-issue) the caller's own session token.
 * The TutorX webview receives a Nakama session token from the Unity app via
 * deep link, but has no refresh_token — once that token expires the web can
 * no longer bill AI usage and has to ask the user to reopen the app.
 * This RPC lets the web exchange a STILL-VALID token for a fresh one
 * (proactive keep-alive). It only ever issues a token for ctx.userId, so a
 * caller can never mint a session for another account.
 * Payload: {} — Response: { success, token, exp, userId }
 */
var TUTORX_SESSION_REFRESH_TTL_SEC = 3600; // 1 hour per refresh; web renews every ~2 min

function rpcTutorXSessionRefresh(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }

    var exp = Math.floor(Date.now() / 1000) + TUTORX_SESSION_REFRESH_TTL_SEC;
    var token;
    try {
        var result = nk.authenticateTokenGenerate(userId, ctx.username || "", exp);
        token = result && (result.token || result.Token);
    } catch (err) {
        utils.logError(logger, "tutorx_session_refresh: token generate failed: " + err.message);
        return utils.handleError(ctx, null, "Failed to refresh session");
    }
    if (!token) {
        return utils.handleError(ctx, null, "Failed to refresh session");
    }

    utils.logInfo(logger, "tutorx_session_refresh: re-issued session for user=" + userId + " exp=" + exp);

    return JSON.stringify({
        success: true,
        token: token,
        exp: exp,
        userId: userId,
        timestamp: utils.getCurrentTimestamp()
    });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WALLET BALANCE RPC (existing)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// RPC: Get balances for a specific game wallet
// Payload: { gameId: "uuid" }
// Response: { success, game_balance, global_balance, currencies }
function rpcWalletGetBalances(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC wallet_get_balances called");

    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }

    var data = parsed.data;
    var validation = utils.validatePayload(data, ['gameId']);
    if (!validation.valid) {
        return utils.handleError(ctx, null, "Missing required fields: " + validation.missing.join(", "));
    }

    var gameId = data.gameId;
    if (!utils.isValidUUID(gameId)) {
        return utils.handleError(ctx, null, "Invalid gameId UUID format");
    }

    var userId = ctx.userId;
    if (!userId) {
        return utils.handleError(ctx, null, "User not authenticated");
    }

    // Reuse existing helper – this is how wallet_update_game_wallet works
    var wallet = getGameWallet(nk, logger, userId, gameId);

    var currencies = wallet.currencies || {};

    // Convention: treat "game" and "global" as main ones, if present
    var gameBalance   = currencies["game"]   || 0;
    var globalBalance = currencies["global"] || 0;

    return JSON.stringify({
        success:        true,
        userId:         userId,
        gameId:         gameId,
        game_balance:   gameBalance,
        global_balance: globalBalance,
        currencies:     currencies,
        timestamp:      utils.getCurrentTimestamp()
    });
}

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("tutorx_check_allowance", rpcTutorXCheckAllowance);
    initializer.registerRpc("tutorx_record_usage", rpcTutorXRecordUsage);
}
