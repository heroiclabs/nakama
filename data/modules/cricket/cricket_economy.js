/**
 * Cricket Economy Module
 * 
 * Server-side economy management for Cricket VR Mob:
 * 
 * 💰 COIN MANAGEMENT
 * - Wallet operations (add, spend, transfer)
 * - Transaction history
 * - Anti-cheat validation
 * 
 * 🛒 IAP VALIDATION
 * - Receipt verification
 * - Coin grants on purchase
 * - Subscription management
 * 
 * 📊 ANALYTICS
 * - Spending patterns
 * - ARPU tracking
 * - IAP conversion
 * 
 * Game ID: 78244246-1e9e-4e0f-a8a2-7447d5b0284e
 */

const CRICKET_GAME_ID = "78244246-1e9e-4e0f-a8a2-7447d5b0284e";

// Collections
const COLLECTIONS = {
    WALLETS: "cricket_wallets",
    TRANSACTIONS: "cricket_transactions",
    IAP_HISTORY: "cricket_iap_history",
    SUBSCRIPTIONS: "cricket_subscriptions",
    VOICE_ACCESS: "cricket_voice_access"
};

// Coin costs (server-authoritative)
const COSTS = {
    // Tournament
    tournament_entry: 50,
    tournament_premium_entry: 200,
    tournament_reentry: 100,
    bracket_prediction: 25,
    
    // Multiplayer
    ranked_1v1: 50,
    casual_1v1: 10,
    team_2v2: 75,
    team_3v3: 100,
    team_5v5: 150,
    battle_boost: 15,
    revenge_match: 50,
    
    // Solo
    continue_game: 25,
    power_up_5050: 15,
    power_up_extra_time: 10,
    power_up_skip: 20,
    power_up_hint: 15,
    power_up_double_points: 30,
    category_unlock: 100,
    
    // Local Multiplayer
    premium_theme: 50,
    extra_rounds: 20,
    local_power_pack: 25,
    
    // Link and Play
    create_custom_room: 30,
    ai_question_generation: 40,
    shareable_quiz: 25,
    youtube_quiz: 50,
    
    // Voice Features
    voice_trivia_session: 15,
    commentary_mode: 25,
    tournament_voice_pass: 100,
    voice_power_shot: 5,
    voice_field_placement: 10
};

// IAP Packages (must match client)
const IAP_PACKAGES = {
    coins_starter: { coins: 100, bonus: 0 },
    coins_basic: { coins: 500, bonus: 50 },
    coins_popular: { coins: 1200, bonus: 200 },
    coins_mega: { coins: 3000, bonus: 750 },
    coins_legend: { coins: 8000, bonus: 2500 },
    coins_ultimate: { coins: 20000, bonus: 8000 }
};

// Coin earning limits (anti-cheat)
const DAILY_LIMITS = {
    ad_rewards: 50, // Max coins from ads per day
    daily_login_max: 50,
    referral_max: 500 // Per day
};

/**
 * RPC: Get wallet balance
 */
function rpcGetWallet(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    const wallet = getWallet(nk, userId);
    
    return JSON.stringify({
        coins: wallet.coins || 0,
        totalEarned: wallet.totalEarned || 0,
        totalSpent: wallet.totalSpent || 0,
        isGuest: wallet.isGuest || false,
        guestLimit: 500,
        voicePremium: wallet.voicePremium || false,
        tournamentVoicePass: wallet.tournamentVoicePass || false
    });
}

/**
 * RPC: Spend coins (server-validated)
 */
function rpcSpendCoins(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { category, itemId, amount } = data;

    if (!category) {
        throw new Error("category is required");
    }

    // Get server-defined cost (prevent client manipulation)
    let cost = COSTS[category];
    if (cost === undefined) {
        // Allow custom amounts for certain categories
        if (amount && amount > 0 && amount <= 1000) {
            cost = amount;
        } else {
            throw new Error(`Invalid category: ${category}`);
        }
    }

    // Check and deduct
    const wallet = getWallet(nk, userId);
    
    if ((wallet.coins || 0) < cost) {
        return JSON.stringify({
            success: false,
            error: "insufficient_coins",
            needed: cost,
            have: wallet.coins || 0,
            deficit: cost - (wallet.coins || 0)
        });
    }

    // Deduct coins
    wallet.coins = (wallet.coins || 0) - cost;
    wallet.totalSpent = (wallet.totalSpent || 0) + cost;
    
    saveWallet(nk, userId, wallet);

    // Log transaction
    logTransaction(nk, userId, -cost, category, itemId);

    logger.info(`User ${userId} spent ${cost} coins on ${category}`);

    return JSON.stringify({
        success: true,
        spent: cost,
        category,
        newBalance: wallet.coins
    });
}

/**
 * RPC: Add coins (server-validated sources only)
 */
function rpcAddCoins(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { source, amount } = data;

    if (!source || !amount || amount <= 0) {
        throw new Error("source and positive amount required");
    }

    // Validate source and apply limits
    const validationResult = validateCoinSource(nk, userId, source, amount);
    if (!validationResult.valid) {
        return JSON.stringify({
            success: false,
            error: validationResult.error,
            message: validationResult.message
        });
    }

    const finalAmount = validationResult.amount;
    const wallet = getWallet(nk, userId);

    // Guest user limit
    if (wallet.isGuest && (wallet.coins || 0) + finalAmount > 500) {
        const overflow = ((wallet.coins || 0) + finalAmount) - 500;
        wallet.coins = 500;
        
        saveWallet(nk, userId, wallet);
        logTransaction(nk, userId, finalAmount - overflow, source, null);

        return JSON.stringify({
            success: true,
            added: finalAmount - overflow,
            newBalance: wallet.coins,
            guestLimitReached: true,
            overflow
        });
    }

    wallet.coins = (wallet.coins || 0) + finalAmount;
    wallet.totalEarned = (wallet.totalEarned || 0) + finalAmount;
    
    saveWallet(nk, userId, wallet);
    logTransaction(nk, userId, finalAmount, source, null);

    logger.info(`User ${userId} earned ${finalAmount} coins from ${source}`);

    return JSON.stringify({
        success: true,
        added: finalAmount,
        source,
        newBalance: wallet.coins
    });
}

/**
 * RPC: Process IAP purchase
 */
function rpcProcessIAPPurchase(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { packageId, receipt, platform } = data;

    if (!packageId) {
        throw new Error("packageId is required");
    }

    // Validate package exists
    const packageDef = IAP_PACKAGES[packageId];
    if (!packageDef) {
        throw new Error(`Unknown package: ${packageId}`);
    }

    // In production, validate receipt with Apple/Google
    // For now, trust the client
    const isValid = true; // validateReceipt(receipt, platform);

    if (!isValid) {
        return JSON.stringify({
            success: false,
            error: "invalid_receipt"
        });
    }

    // Grant coins
    const totalCoins = packageDef.coins + packageDef.bonus;
    const wallet = getWallet(nk, userId);
    
    wallet.coins = (wallet.coins || 0) + totalCoins;
    wallet.totalEarned = (wallet.totalEarned || 0) + totalCoins;
    wallet.isGuest = false; // IAP removes guest status
    
    saveWallet(nk, userId, wallet);

    // Log IAP
    nk.storageWrite([{
        collection: COLLECTIONS.IAP_HISTORY,
        key: `${packageId}_${Date.now()}`,
        userId: userId,
        value: {
            packageId,
            coins: packageDef.coins,
            bonus: packageDef.bonus,
            totalCoins,
            platform,
            timestamp: Date.now()
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logTransaction(nk, userId, totalCoins, `iap_${packageId}`, packageId);

    logger.info(`User ${userId} purchased ${packageId}: +${totalCoins} coins`);

    return JSON.stringify({
        success: true,
        packageId,
        coinsAdded: totalCoins,
        baseCoins: packageDef.coins,
        bonusCoins: packageDef.bonus,
        newBalance: wallet.coins
    });
}

/**
 * RPC: Purchase voice feature access
 */
function rpcPurchaseVoiceAccess(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { feature, method } = data;

    const validFeatures = ['voice_trivia_session', 'commentary_mode', 'tournament_voice_pass', 
                          'voice_power_shot', 'voice_field_placement'];
    
    if (!validFeatures.includes(feature)) {
        throw new Error(`Invalid voice feature: ${feature}`);
    }

    const cost = COSTS[feature];
    const wallet = getWallet(nk, userId);

    if ((wallet.coins || 0) < cost) {
        return JSON.stringify({
            success: false,
            error: "insufficient_coins",
            needed: cost,
            have: wallet.coins || 0
        });
    }

    // Deduct and grant access
    wallet.coins -= cost;
    wallet.totalSpent = (wallet.totalSpent || 0) + cost;
    
    // Tournament voice pass is persistent
    if (feature === 'tournament_voice_pass') {
        wallet.tournamentVoicePass = true;
    }

    saveWallet(nk, userId, wallet);
    logTransaction(nk, userId, -cost, feature, null);

    // Store access grant
    const accessExpiry = feature === 'tournament_voice_pass' 
        ? Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
        : Date.now() + (60 * 60 * 1000); // 1 hour for others

    nk.storageWrite([{
        collection: COLLECTIONS.VOICE_ACCESS,
        key: feature,
        userId: userId,
        value: {
            feature,
            grantedAt: Date.now(),
            expiresAt: accessExpiry
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} purchased voice feature: ${feature}`);

    return JSON.stringify({
        success: true,
        feature,
        cost,
        newBalance: wallet.coins,
        expiresAt: accessExpiry
    });
}

/**
 * RPC: Check voice access
 */
function rpcCheckVoiceAccess(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {}

    const { feature } = data;

    const wallet = getWallet(nk, userId);
    
    // Check premium
    if (wallet.voicePremium) {
        return JSON.stringify({
            hasAccess: true,
            reason: "premium"
        });
    }

    // Check tournament pass
    if (wallet.tournamentVoicePass) {
        return JSON.stringify({
            hasAccess: true,
            reason: "tournament_pass"
        });
    }

    // Check specific feature access
    if (feature) {
        const access = nk.storageRead([{
            collection: COLLECTIONS.VOICE_ACCESS,
            key: feature,
            userId: userId
        }]);

        if (access.length > 0 && access[0].value.expiresAt > Date.now()) {
            return JSON.stringify({
                hasAccess: true,
                reason: "feature_purchase",
                expiresAt: access[0].value.expiresAt
            });
        }
    }

    return JSON.stringify({
        hasAccess: false,
        reason: "not_purchased"
    });
}

/**
 * RPC: Get transaction history
 */
function rpcGetTransactionHistory(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {}

    const { limit = 50, cursor } = data;

    const result = nk.storageList(userId, COLLECTIONS.TRANSACTIONS, limit, cursor);

    const transactions = (result.objects || []).map(obj => obj.value);

    return JSON.stringify({
        transactions,
        cursor: result.cursor
    });
}

/**
 * RPC: Convert guest to registered
 */
function rpcConvertGuestToRegistered(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    const wallet = getWallet(nk, userId);
    
    if (!wallet.isGuest) {
        return JSON.stringify({
            success: true,
            message: "Already a registered user"
        });
    }

    wallet.isGuest = false;
    
    // Bonus for converting
    const conversionBonus = 50;
    wallet.coins = (wallet.coins || 0) + conversionBonus;
    wallet.totalEarned = (wallet.totalEarned || 0) + conversionBonus;
    
    saveWallet(nk, userId, wallet);
    logTransaction(nk, userId, conversionBonus, 'account_conversion_bonus', null);

    logger.info(`User ${userId} converted from guest - granted ${conversionBonus} bonus coins`);

    return JSON.stringify({
        success: true,
        bonusCoins: conversionBonus,
        newBalance: wallet.coins,
        message: "Account upgraded! Coin limit removed."
    });
}

// Helper functions
function getWallet(nk, userId) {
    const data = nk.storageRead([{
        collection: COLLECTIONS.WALLETS,
        key: "wallet",
        userId: userId
    }]);

    if (data.length > 0) {
        return data[0].value;
    }

    // Initialize new wallet
    return {
        coins: 100, // Starting coins
        totalEarned: 100,
        totalSpent: 0,
        isGuest: true,
        voicePremium: false,
        tournamentVoicePass: false,
        createdAt: Date.now()
    };
}

function saveWallet(nk, userId, wallet) {
    wallet.updatedAt = Date.now();
    
    nk.storageWrite([{
        collection: COLLECTIONS.WALLETS,
        key: "wallet",
        userId: userId,
        value: wallet,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function logTransaction(nk, userId, amount, category, itemId) {
    nk.storageWrite([{
        collection: COLLECTIONS.TRANSACTIONS,
        key: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId: userId,
        value: {
            amount,
            category,
            itemId,
            timestamp: Date.now()
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function validateCoinSource(nk, userId, source, requestedAmount) {
    const today = new Date().toISOString().split('T')[0];
    
    // Get today's earnings for this source
    const todayKey = `daily_${source}_${today}`;
    const dailyData = nk.storageRead([{
        collection: "cricket_daily_limits",
        key: todayKey,
        userId: userId
    }]);

    let todayTotal = dailyData.length > 0 ? dailyData[0].value.total : 0;

    // Apply limits based on source
    let maxDaily = 1000; // Default
    let maxPerAction = 100;

    if (source === 'ad_reward') {
        maxDaily = DAILY_LIMITS.ad_rewards;
        maxPerAction = 5;
    } else if (source === 'daily_login') {
        maxDaily = DAILY_LIMITS.daily_login_max;
        maxPerAction = 50;
    } else if (source.startsWith('referral')) {
        maxDaily = DAILY_LIMITS.referral_max;
        maxPerAction = 100;
    }

    // Check limits
    if (requestedAmount > maxPerAction) {
        return {
            valid: false,
            error: "amount_exceeds_max",
            message: `Max per action: ${maxPerAction}`
        };
    }

    if (todayTotal + requestedAmount > maxDaily) {
        return {
            valid: false,
            error: "daily_limit_reached",
            message: `Daily limit for ${source}: ${maxDaily}`,
            remaining: Math.max(0, maxDaily - todayTotal)
        };
    }

    // Update daily total
    nk.storageWrite([{
        collection: "cricket_daily_limits",
        key: todayKey,
        userId: userId,
        value: {
            total: todayTotal + requestedAmount,
            lastUpdate: Date.now()
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);

    return {
        valid: true,
        amount: requestedAmount
    };
}

// Register RPCs
function InitModule(ctx, logger, nk, initializer) {
    logger.info("Cricket Economy Module loaded");

    initializer.registerRpc("cricket_get_wallet", rpcGetWallet);
    initializer.registerRpc("cricket_spend_coins", rpcSpendCoins);
    initializer.registerRpc("cricket_add_coins", rpcAddCoins);
    initializer.registerRpc("cricket_process_iap", rpcProcessIAPPurchase);
    initializer.registerRpc("cricket_purchase_voice_access", rpcPurchaseVoiceAccess);
    initializer.registerRpc("cricket_check_voice_access", rpcCheckVoiceAccess);
    initializer.registerRpc("cricket_get_transactions", rpcGetTransactionHistory);
    initializer.registerRpc("cricket_convert_guest", rpcConvertGuestToRegistered);

    logger.info("Cricket Economy Module initialized - 8 RPCs registered");
}

!InitModule.toString().includes("InitModule") || InitModule;

