"use strict";
function InitModule(ctx, logger, nk, initializer) {
    logger.info("========================================");
    logger.info("IntelliVerse-X Nakama Runtime v2.0");
    logger.info("Hiro + Satori Custom Build");
    logger.info("========================================");
    // ---- Legacy System Registration (backward-compatible RPCs) ----
    try {
        logger.info("[Legacy] Registering wallet RPCs...");
        LegacyWallet.register(initializer);
        logger.info("[Legacy] Registering leaderboard RPCs...");
        LegacyLeaderboards.register(initializer);
        logger.info("[Legacy] Registering game registry RPCs...");
        LegacyGameRegistry.register(initializer);
        logger.info("[Legacy] Registering daily rewards RPCs...");
        LegacyDailyRewards.register(initializer);
        logger.info("[Legacy] Registering quiz RPCs...");
        LegacyQuiz.register(initializer);
        logger.info("[Legacy] Registering game entry RPCs...");
        LegacyGameEntry.register(initializer);
        logger.info("[Legacy] Registering missions RPCs...");
        LegacyMissions.register(initializer);
        logger.info("[Legacy] Registering analytics RPCs...");
        LegacyAnalytics.register(initializer);
        logger.info("[Legacy] Registering friends RPCs...");
        LegacyFriends.register(initializer);
        logger.info("[Legacy] Registering groups RPCs...");
        LegacyGroups.register(initializer);
        logger.info("[Legacy] Registering push RPCs...");
        LegacyPush.register(initializer);
        logger.info("[Legacy] Registering player RPCs...");
        LegacyPlayer.register(initializer);
        logger.info("[Legacy] Registering chat RPCs...");
        LegacyChat.register(initializer);
        logger.info("[Legacy] Registering quests-economy bridge RPCs...");
        LegacyQuestsEconomyBridge.register(initializer);
        logger.info("[Legacy] Registering multi-game RPCs...");
        LegacyMultiGame.register(initializer);
        logger.info("[Legacy] Registering analytics retention RPCs...");
        LegacyAnalyticsRetention.register(initializer);
        logger.info("[Legacy] Registering gift cards RPCs...");
        LegacyGiftCards.register(initializer);
        logger.info("[Legacy] Registering coupons RPCs...");
        LegacyCoupons.register(initializer);
        logger.info("[Legacy] All legacy RPCs registered successfully");
    }
    catch (err) {
        logger.error("[Legacy] Failed to register legacy RPCs: " + (err.message || String(err)));
    }
    // ---- Hiro Systems Registration ----
    try {
        logger.info("[Hiro] Registering Economy RPCs...");
        HiroEconomy.register(initializer);
        logger.info("[Hiro] Registering Inventory RPCs...");
        HiroInventory.register(initializer);
        logger.info("[Hiro] Registering Achievements RPCs...");
        HiroAchievements.register(initializer);
        logger.info("[Hiro] Registering Progression RPCs...");
        HiroProgression.register(initializer);
        logger.info("[Hiro] Registering Energy RPCs...");
        HiroEnergy.register(initializer);
        logger.info("[Hiro] Registering Stats RPCs...");
        HiroStats.register(initializer);
        logger.info("[Hiro] Registering Event Leaderboards RPCs...");
        HiroEventLeaderboards.register(initializer);
        logger.info("[Hiro] Registering Streaks RPCs...");
        HiroStreaks.register(initializer);
        logger.info("[Hiro] Registering Store RPCs...");
        HiroStore.register(initializer);
        logger.info("[Hiro] Registering Challenges RPCs...");
        HiroChallenges.register(initializer);
        logger.info("[Hiro] Registering Teams RPCs...");
        HiroTeams.register(initializer);
        logger.info("[Hiro] Registering Tutorials RPCs...");
        HiroTutorials.register(initializer);
        logger.info("[Hiro] Registering Unlockables RPCs...");
        HiroUnlockables.register(initializer);
        logger.info("[Hiro] Registering Auctions RPCs...");
        HiroAuctions.register(initializer);
        logger.info("[Hiro] Registering Incentives RPCs...");
        HiroIncentives.register(initializer);
        logger.info("[Hiro] Registering Mailbox RPCs...");
        HiroMailbox.register(initializer);
        logger.info("[Hiro] Registering Reward Bucket RPCs...");
        HiroRewardBucket.register(initializer);
        logger.info("[Hiro] Registering Personalizers RPCs...");
        HiroPersonalizers.register(initializer);
        logger.info("[Hiro] Registering Base Module RPCs...");
        HiroBase.register(initializer);
        logger.info("[Hiro] Registering Leaderboards RPCs...");
        HiroLeaderboards.register(initializer);
        logger.info("[Hiro] All Hiro systems registered successfully");
    }
    catch (err) {
        logger.error("[Hiro] Failed to register Hiro systems: " + (err.message || String(err)));
    }
    // ---- Satori Systems Registration ----
    try {
        logger.info("[Satori] Registering Event Capture RPCs...");
        SatoriEventCapture.register(initializer);
        logger.info("[Satori] Registering Identities RPCs...");
        SatoriIdentities.register(initializer);
        logger.info("[Satori] Registering Audiences RPCs...");
        SatoriAudiences.register(initializer);
        logger.info("[Satori] Registering Feature Flags RPCs...");
        SatoriFeatureFlags.register(initializer);
        logger.info("[Satori] Registering Experiments RPCs...");
        SatoriExperiments.register(initializer);
        logger.info("[Satori] Registering Live Events RPCs...");
        SatoriLiveEvents.register(initializer);
        logger.info("[Satori] Registering Messages RPCs...");
        SatoriMessages.register(initializer);
        logger.info("[Satori] Registering Metrics RPCs...");
        SatoriMetrics.register(initializer);
        logger.info("[Satori] Registering Webhooks RPCs...");
        SatoriWebhooks.register(initializer);
        logger.info("[Satori] Registering Taxonomy RPCs...");
        SatoriTaxonomy.register(initializer);
        logger.info("[Satori] Registering Data Lake RPCs...");
        SatoriDataLake.register(initializer);
        logger.info("[Satori] All Satori systems registered successfully");
    }
    catch (err) {
        logger.error("[Satori] Failed to register Satori systems: " + (err.message || String(err)));
    }
    // ---- Admin Console RPCs ----
    try {
        logger.info("[Admin] Registering Admin Console RPCs...");
        AdminConsole.register(initializer);
        logger.info("[Admin] Admin Console registered successfully");
    }
    catch (err) {
        logger.error("[Admin] Failed to register Admin Console: " + (err.message || String(err)));
    }
    // ---- Event Bus Handlers ----
    try {
        HiroAchievements.registerEventHandlers();
        SatoriMetrics.registerEventHandlers();
        HiroRewardBucket.registerEventHandlers();
        SatoriWebhooks.registerEventHandlers();
        logger.info("[EventBus] Event handlers registered");
    }
    catch (err) {
        logger.error("[EventBus] Failed to register event handlers: " + (err.message || String(err)));
    }
    logger.info("========================================");
    logger.info("IntelliVerse-X Runtime initialized!");
    logger.info("========================================");
}
var HiroAchievements;
(function (HiroAchievements) {
    var DEFAULT_CONFIG = { achievements: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "achievements", DEFAULT_CONFIG);
    }
    HiroAchievements.getConfig = getConfig;
    function getUserAchievements(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_ACHIEVEMENTS_COLLECTION, Constants.gameKey(gameId, "progress"), userId);
        return data || { achievements: {} };
    }
    function saveUserAchievements(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_ACHIEVEMENTS_COLLECTION, Constants.gameKey(gameId, "progress"), userId, data);
    }
    function addProgress(nk, logger, ctx, userId, achievementId, amount, gameId) {
        var config = getConfig(nk);
        var def = config.achievements[achievementId];
        if (!def)
            return null;
        if (def.preconditionIds) {
            var ua = getUserAchievements(nk, userId, gameId);
            for (var i = 0; i < def.preconditionIds.length; i++) {
                var pre = ua.achievements[def.preconditionIds[i]];
                if (!pre || !pre.completedAt)
                    return null;
            }
        }
        var userAchievements = getUserAchievements(nk, userId, gameId);
        var progress = userAchievements.achievements[achievementId];
        var now = Math.floor(Date.now() / 1000);
        if (!progress) {
            progress = { id: achievementId, count: 0 };
        }
        if (progress.completedAt && !def.resetSchedule) {
            return progress;
        }
        if (def.resetSchedule && progress.resetAt) {
            // If reset time has passed, reset progress
            if (now >= progress.resetAt) {
                progress.count = 0;
                progress.completedAt = undefined;
                progress.claimedAt = undefined;
            }
        }
        progress.count = Math.min(progress.count + amount, def.maxCount || def.count);
        EventBus.emit(nk, logger, ctx, EventBus.Events.ACHIEVEMENT_PROGRESS, {
            userId: userId, achievementId: achievementId, count: progress.count, target: def.count
        });
        if (progress.count >= def.count && !progress.completedAt) {
            progress.completedAt = now;
            EventBus.emit(nk, logger, ctx, EventBus.Events.ACHIEVEMENT_COMPLETED, {
                userId: userId, achievementId: achievementId
            });
            if (def.autoClaimReward && def.reward) {
                var resolved = RewardEngine.resolveReward(nk, def.reward);
                RewardEngine.grantReward(nk, logger, ctx, userId, gameId || "default", resolved);
                progress.claimedAt = now;
                EventBus.emit(nk, logger, ctx, EventBus.Events.ACHIEVEMENT_CLAIMED, {
                    userId: userId, achievementId: achievementId, reward: resolved
                });
            }
            if (def.resetSchedule) {
                progress.resetAt = computeNextReset(now, def.resetSchedule);
            }
        }
        // Sub-achievements
        if (def.subAchievements) {
            if (!progress.subAchievements)
                progress.subAchievements = {};
            for (var sid in def.subAchievements) {
                var subDef = def.subAchievements[sid];
                var subProgress = progress.subAchievements[sid];
                if (!subProgress)
                    subProgress = { count: 0 };
                if (!subProgress.completedAt) {
                    subProgress.count = Math.min(subProgress.count + amount, subDef.count);
                    if (subProgress.count >= subDef.count) {
                        subProgress.completedAt = now;
                        if (subDef.reward) {
                            var subResolved = RewardEngine.resolveReward(nk, subDef.reward);
                            RewardEngine.grantReward(nk, logger, ctx, userId, gameId || "default", subResolved);
                        }
                    }
                }
                progress.subAchievements[sid] = subProgress;
            }
        }
        userAchievements.achievements[achievementId] = progress;
        saveUserAchievements(nk, userId, userAchievements, gameId);
        return progress;
    }
    HiroAchievements.addProgress = addProgress;
    function computeNextReset(now, schedule) {
        // Simplified: "daily" = 24h, "weekly" = 7d, "monthly" = 30d
        switch (schedule) {
            case "daily": return now + 86400;
            case "weekly": return now + 604800;
            case "monthly": return now + 2592000;
            default: return now + 86400;
        }
    }
    // ---- RPCs ----
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId;
        var config = getConfig(nk);
        var userAchievements = getUserAchievements(nk, userId, gameId);
        var result = [];
        for (var id in config.achievements) {
            var def = config.achievements[id];
            var progress = userAchievements.achievements[id] || { id: id, count: 0 };
            result.push({
                id: id,
                name: def.name,
                description: def.description,
                category: def.category,
                targetCount: def.count,
                currentCount: progress.count,
                completedAt: progress.completedAt,
                claimedAt: progress.claimedAt,
                autoClaimReward: def.autoClaimReward,
                hasReward: !!def.reward,
                subAchievements: def.subAchievements ? Object.keys(def.subAchievements).map(function (sid) {
                    var subDef = def.subAchievements[sid];
                    var subProgress = (progress.subAchievements && progress.subAchievements[sid]) || { count: 0 };
                    return { id: sid, name: subDef.name, targetCount: subDef.count, currentCount: subProgress.count, completedAt: subProgress.completedAt };
                }) : []
            });
        }
        return RpcHelpers.successResponse({ achievements: result });
    }
    function rpcProgress(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.achievementId)
            return RpcHelpers.errorResponse("achievementId required");
        var progress = addProgress(nk, logger, ctx, userId, data.achievementId, data.amount || 1, data.gameId);
        if (!progress)
            return RpcHelpers.errorResponse("Achievement not found or preconditions not met");
        return RpcHelpers.successResponse({ progress: progress });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.achievementId)
            return RpcHelpers.errorResponse("achievementId required");
        var config = getConfig(nk);
        var def = config.achievements[data.achievementId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown achievement");
        var ua = getUserAchievements(nk, userId, data.gameId);
        var progress = ua.achievements[data.achievementId];
        if (!progress || !progress.completedAt)
            return RpcHelpers.errorResponse("Achievement not completed");
        if (progress.claimedAt)
            return RpcHelpers.errorResponse("Already claimed");
        progress.claimedAt = Math.floor(Date.now() / 1000);
        var resolved = null;
        if (def.reward) {
            resolved = RewardEngine.resolveReward(nk, def.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
        }
        ua.achievements[data.achievementId] = progress;
        saveUserAchievements(nk, userId, ua, data.gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.ACHIEVEMENT_CLAIMED, {
            userId: userId, achievementId: data.achievementId, reward: resolved
        });
        return RpcHelpers.successResponse({ progress: progress, reward: resolved });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_achievements_list", rpcList);
        initializer.registerRpc("hiro_achievements_progress", rpcProgress);
        initializer.registerRpc("hiro_achievements_claim", rpcClaim);
    }
    HiroAchievements.register = register;
    function registerEventHandlers() {
        // Auto-track achievements from other system events
        EventBus.on(EventBus.Events.GAME_COMPLETED, function (nk, logger, ctx, data) {
            var config = getConfig(nk);
            for (var id in config.achievements) {
                var def = config.achievements[id];
                if (def.category === "games_played") {
                    addProgress(nk, logger, ctx, data.userId, id, 1, data.gameId);
                }
            }
        });
        EventBus.on(EventBus.Events.SCORE_SUBMITTED, function (nk, logger, ctx, data) {
            var config = getConfig(nk);
            for (var id in config.achievements) {
                var def = config.achievements[id];
                if (def.category === "score_threshold" && data.score >= def.count) {
                    addProgress(nk, logger, ctx, data.userId, id, def.count, data.gameId);
                }
            }
        });
    }
    HiroAchievements.registerEventHandlers = registerEventHandlers;
})(HiroAchievements || (HiroAchievements = {}));
var HiroAuctions;
(function (HiroAuctions) {
    var DEFAULT_CONFIG = { categories: [], listingFeePct: 5, durationSec: 86400, maxActiveListings: 5 };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "auctions", DEFAULT_CONFIG);
    }
    HiroAuctions.getConfig = getConfig;
    function getListing(nk, listingId) {
        return Storage.readSystemJson(nk, Constants.HIRO_AUCTIONS_COLLECTION, listingId);
    }
    function saveListing(nk, listing) {
        Storage.writeSystemJson(nk, Constants.HIRO_AUCTIONS_COLLECTION, listing.id, listing);
    }
    function rpcList(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        var result = Storage.listUserRecords(nk, Constants.HIRO_AUCTIONS_COLLECTION, Constants.SYSTEM_USER_ID, data.limit || 20, data.cursor);
        var now = Math.floor(Date.now() / 1000);
        var listings = result.records.filter(function (r) {
            var l = r.value;
            return !l.resolved && l.endsAt > now && (!data.category || l.category === data.category);
        }).map(function (r) { return r.value; });
        return RpcHelpers.successResponse({ listings: listings, cursor: result.cursor });
    }
    function rpcCreate(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.itemId || !data.startingBid || !data.currencyId) {
            return RpcHelpers.errorResponse("itemId, startingBid, and currencyId required");
        }
        var config = getConfig(nk);
        var count = data.itemCount || 1;
        if (!HiroInventory.consumeItem(nk, logger, ctx, userId, data.itemId, count, data.gameId)) {
            return RpcHelpers.errorResponse("Insufficient items");
        }
        var now = Math.floor(Date.now() / 1000);
        var listing = {
            id: nk.uuidv4(),
            sellerId: userId,
            itemId: data.itemId,
            itemCount: count,
            startingBid: data.startingBid,
            currentBid: data.startingBid,
            currencyId: data.currencyId,
            category: data.category || "general",
            createdAt: now,
            endsAt: now + config.durationSec,
            resolved: false
        };
        saveListing(nk, listing);
        return RpcHelpers.successResponse({ listing: listing });
    }
    function rpcBid(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.listingId || !data.amount)
            return RpcHelpers.errorResponse("listingId and amount required");
        var listing = getListing(nk, data.listingId);
        if (!listing || listing.resolved)
            return RpcHelpers.errorResponse("Listing not found or resolved");
        var now = Math.floor(Date.now() / 1000);
        if (now > listing.endsAt)
            return RpcHelpers.errorResponse("Auction ended");
        if (data.amount <= listing.currentBid)
            return RpcHelpers.errorResponse("Bid must exceed current bid of " + listing.currentBid);
        if (listing.highestBidderId) {
            WalletHelpers.addCurrency(nk, logger, ctx, listing.highestBidderId, data.gameId || "default", listing.currencyId, listing.currentBid);
        }
        WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", listing.currencyId, data.amount);
        listing.currentBid = data.amount;
        listing.highestBidderId = userId;
        saveListing(nk, listing);
        return RpcHelpers.successResponse({ listing: listing });
    }
    function rpcResolve(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.listingId)
            return RpcHelpers.errorResponse("listingId required");
        var listing = getListing(nk, data.listingId);
        if (!listing || listing.resolved)
            return RpcHelpers.errorResponse("Listing not found or already resolved");
        var config = getConfig(nk);
        listing.resolved = true;
        if (listing.highestBidderId) {
            HiroInventory.grantItem(nk, logger, ctx, listing.highestBidderId, listing.itemId, listing.itemCount, undefined, undefined, data.gameId);
            var fee = Math.floor(listing.currentBid * config.listingFeePct / 100);
            var sellerProceeds = listing.currentBid - fee;
            WalletHelpers.addCurrency(nk, logger, ctx, listing.sellerId, data.gameId || "default", listing.currencyId, sellerProceeds);
        }
        else {
            HiroInventory.grantItem(nk, logger, ctx, listing.sellerId, listing.itemId, listing.itemCount, undefined, undefined, data.gameId);
        }
        saveListing(nk, listing);
        return RpcHelpers.successResponse({ listing: listing });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_auctions_list", rpcList);
        initializer.registerRpc("hiro_auctions_create", rpcCreate);
        initializer.registerRpc("hiro_auctions_bid", rpcBid);
        initializer.registerRpc("hiro_auctions_resolve", rpcResolve);
    }
    HiroAuctions.register = register;
})(HiroAuctions || (HiroAuctions = {}));
var AdminConsole;
(function (AdminConsole) {
    // ---- Hiro Config CRUD ----
    function rpcConfigGet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.system)
            return RpcHelpers.errorResponse("system required (e.g. economy, inventory, achievements)");
        var config = Storage.readSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, data.system);
        return RpcHelpers.successResponse({ system: data.system, config: config || {} });
    }
    function rpcConfigSet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.system || !data.config)
            return RpcHelpers.errorResponse("system and config required");
        ConfigLoader.saveConfig(nk, data.system, data.config);
        return RpcHelpers.successResponse({ system: data.system, saved: true });
    }
    function rpcConfigDelete(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.system)
            return RpcHelpers.errorResponse("system required");
        Storage.deleteRecord(nk, Constants.HIRO_CONFIGS_COLLECTION, data.system, Constants.SYSTEM_USER_ID);
        ConfigLoader.invalidateCache(data.system);
        return RpcHelpers.successResponse({ system: data.system, deleted: true });
    }
    // ---- Satori Config CRUD ----
    function rpcSatoriConfigGet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.system)
            return RpcHelpers.errorResponse("system required (e.g. flags, experiments, audiences, live_events, messages, metrics)");
        var config = Storage.readSystemJson(nk, Constants.SATORI_CONFIGS_COLLECTION, data.system);
        return RpcHelpers.successResponse({ system: data.system, config: config || {} });
    }
    function rpcSatoriConfigSet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.system || !data.config)
            return RpcHelpers.errorResponse("system and config required");
        ConfigLoader.saveSatoriConfig(nk, data.system, data.config);
        return RpcHelpers.successResponse({ system: data.system, saved: true });
    }
    // ---- Bulk Import/Export ----
    function rpcBulkExport(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var hiroSystems = ["economy", "inventory", "achievements", "progression", "energy", "stats", "streaks", "store", "challenges", "tutorials", "unlockables", "auctions", "incentives"];
        var satoriSystems = ["audiences", "flags", "experiments", "live_events", "messages", "metrics", "webhooks", "taxonomy", "data_lake"];
        var exported = { hiro: {}, satori: {} };
        for (var i = 0; i < hiroSystems.length; i++) {
            var config = Storage.readSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, hiroSystems[i]);
            if (config)
                exported.hiro[hiroSystems[i]] = config;
        }
        for (var j = 0; j < satoriSystems.length; j++) {
            var sConfig = Storage.readSystemJson(nk, Constants.SATORI_CONFIGS_COLLECTION, satoriSystems[j]);
            if (sConfig)
                exported.satori[satoriSystems[j]] = sConfig;
        }
        return RpcHelpers.successResponse(exported);
    }
    function rpcBulkImport(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        var imported = { hiro: 0, satori: 0 };
        if (data.hiro) {
            for (var key in data.hiro) {
                ConfigLoader.saveConfig(nk, key, data.hiro[key]);
                imported.hiro++;
            }
        }
        if (data.satori) {
            for (var sKey in data.satori) {
                ConfigLoader.saveSatoriConfig(nk, sKey, data.satori[sKey]);
                imported.satori++;
            }
        }
        return RpcHelpers.successResponse({ imported: imported });
    }
    // ---- Cache Management ----
    function rpcCacheInvalidate(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        ConfigLoader.invalidateCache(data.system);
        return RpcHelpers.successResponse({ invalidated: data.system || "all" });
    }
    // ---- User Data Management ----
    function rpcUserDataGet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.collection)
            return RpcHelpers.errorResponse("userId and collection required");
        var key = data.key || "state";
        var result = Storage.readJson(nk, data.collection, key, data.userId);
        return RpcHelpers.successResponse({ collection: data.collection, key: key, data: result });
    }
    function rpcUserDataSet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.collection || !data.data)
            return RpcHelpers.errorResponse("userId, collection, and data required");
        var key = data.key || "state";
        Storage.writeJson(nk, data.collection, key, data.userId, data.data);
        return RpcHelpers.successResponse({ saved: true });
    }
    function rpcUserDataDelete(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.collection)
            return RpcHelpers.errorResponse("userId and collection required");
        var key = data.key || "state";
        Storage.deleteRecord(nk, data.collection, key, data.userId);
        return RpcHelpers.successResponse({ deleted: true });
    }
    // ---- Player Full Profile Inspector ----
    function rpcPlayerInspect(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId)
            return RpcHelpers.errorResponse("userId required");
        var profile = {};
        try {
            var accounts = nk.accountsGetId([data.userId]);
            if (accounts && accounts.length > 0) {
                var acct = accounts[0];
                profile.account = {
                    userId: acct.user.userId,
                    username: acct.user.username,
                    displayName: acct.user.displayName,
                    avatarUrl: acct.user.avatarUrl,
                    langTag: acct.user.langTag,
                    location: acct.user.location,
                    timezone: acct.user.timezone,
                    createTime: acct.user.createTime,
                    updateTime: acct.user.updateTime,
                    online: acct.user.online,
                    edgeCount: acct.user.edgeCount
                };
            }
        }
        catch (e) {
            profile.account = { error: e.message || String(e) };
        }
        var collections = [
            { name: "wallet", collection: Constants.WALLETS_COLLECTION, key: "wallet" },
            { name: "inventory", collection: Constants.HIRO_INVENTORY_COLLECTION, key: "items" },
            { name: "achievements", collection: Constants.HIRO_ACHIEVEMENTS_COLLECTION, key: "progress" },
            { name: "progression", collection: Constants.HIRO_PROGRESSION_COLLECTION, key: "state" },
            { name: "energy", collection: Constants.HIRO_ENERGY_COLLECTION, key: "state" },
            { name: "stats", collection: Constants.HIRO_STATS_COLLECTION, key: "values" },
            { name: "streaks", collection: Constants.HIRO_STREAKS_COLLECTION, key: "state" },
            { name: "tutorials", collection: Constants.HIRO_TUTORIALS_COLLECTION, key: "progress" },
            { name: "unlockables", collection: Constants.HIRO_UNLOCKABLES_COLLECTION, key: "state" },
            { name: "satoriIdentity", collection: Constants.SATORI_IDENTITY_COLLECTION, key: "props" },
            { name: "satoriAssignments", collection: Constants.SATORI_ASSIGNMENTS_COLLECTION, key: "assignments" },
            { name: "mailbox", collection: Constants.HIRO_MAILBOX_COLLECTION, key: "inbox" }
        ];
        var reads = [];
        for (var i = 0; i < collections.length; i++) {
            reads.push({ collection: collections[i].collection, key: collections[i].key, userId: data.userId });
        }
        try {
            var records = nk.storageRead(reads);
            for (var j = 0; j < collections.length; j++) {
                var found = false;
                for (var k = 0; k < records.length; k++) {
                    if (records[k].collection === collections[j].collection) {
                        profile[collections[j].name] = records[k].value;
                        found = true;
                        break;
                    }
                }
                if (!found)
                    profile[collections[j].name] = null;
            }
        }
        catch (e) {
            profile.storageError = e.message || String(e);
        }
        return RpcHelpers.successResponse(profile);
    }
    // ---- Wallet Direct Operations ----
    function rpcWalletView(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId)
            return RpcHelpers.errorResponse("userId required");
        var wallet = Storage.readJson(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId);
        return RpcHelpers.successResponse({ userId: data.userId, wallet: wallet || {} });
    }
    function rpcWalletGrant(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.currencies)
            return RpcHelpers.errorResponse("userId and currencies required (e.g. { userId: '...', currencies: { coins: 100, gems: 5 } })");
        var wallet = Storage.readJson(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId) || {};
        for (var currency in data.currencies) {
            wallet[currency] = (wallet[currency] || 0) + data.currencies[currency];
        }
        Storage.writeJson(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId, wallet);
        EventBus.emit(nk, logger, ctx, "wallet_updated", { userId: data.userId, wallet: wallet, granted: data.currencies });
        return RpcHelpers.successResponse({ userId: data.userId, wallet: wallet });
    }
    function rpcWalletReset(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId)
            return RpcHelpers.errorResponse("userId required");
        var defaults = data.defaults || {};
        Storage.writeJson(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId, defaults);
        return RpcHelpers.successResponse({ userId: data.userId, wallet: defaults, reset: true });
    }
    // ---- Storage Collections Browser ----
    function rpcStorageList(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.collection)
            return RpcHelpers.errorResponse("collection required");
        var userId = data.userId || Constants.SYSTEM_USER_ID;
        var limit = data.limit || 50;
        var result = Storage.listUserRecords(nk, data.collection, userId, limit, data.cursor);
        var items = [];
        for (var i = 0; i < result.records.length; i++) {
            var r = result.records[i];
            items.push({
                key: r.key,
                userId: r.userId,
                version: r.version,
                updateTime: r.updateTime,
                valueSummary: JSON.stringify(r.value).substring(0, 200)
            });
        }
        return RpcHelpers.successResponse({
            collection: data.collection,
            count: items.length,
            cursor: result.cursor,
            items: items
        });
    }
    // ---- Feature Flag Quick Toggle ----
    function rpcFlagToggle(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("name required (flag name to toggle)");
        var flagsConfig = ConfigLoader.loadSatoriConfig(nk, "flags", { flags: {} });
        if (!flagsConfig.flags)
            flagsConfig.flags = {};
        var existing = flagsConfig.flags[data.name];
        var now = Math.floor(Date.now() / 1000);
        if (existing) {
            existing.enabled = data.enabled !== undefined ? data.enabled : !existing.enabled;
            if (data.value !== undefined)
                existing.value = String(data.value);
            if (data.conditionsByAudience)
                existing.conditionsByAudience = data.conditionsByAudience;
            existing.updatedAt = now;
        }
        else if (data.value !== undefined) {
            flagsConfig.flags[data.name] = {
                name: data.name,
                value: String(data.value),
                description: data.description || "",
                conditionsByAudience: data.conditionsByAudience,
                enabled: data.enabled !== undefined ? data.enabled : true,
                createdAt: now,
                updatedAt: now
            };
        }
        else {
            return RpcHelpers.errorResponse("Flag '" + data.name + "' not found. Provide value to create.");
        }
        ConfigLoader.saveSatoriConfig(nk, "flags", flagsConfig);
        return RpcHelpers.successResponse({ flag: flagsConfig.flags[data.name], action: existing ? "toggled" : "created" });
    }
    // ---- Live Event Quick Schedule ----
    function rpcLiveEventSchedule(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id || !data.name)
            return RpcHelpers.errorResponse("id and name required");
        var eventsConfig = ConfigLoader.loadSatoriConfig(nk, "live_events", {});
        var now = Math.floor(Date.now() / 1000);
        var newEvent = {
            id: data.id,
            name: data.name,
            description: data.description || "",
            startAt: data.startTimeSec || data.startAt || now,
            endAt: data.endTimeSec || data.endAt || now + 86400,
            audienceId: (data.audiences && data.audiences[0]) || data.audienceId || undefined,
            reward: data.reward || undefined,
            config: data.config || {},
            recurrenceCron: data.recurrenceCron,
            recurrenceIntervalSec: data.recurrenceIntervalSec,
            sticky: data.sticky || false,
            requiresJoin: data.requiresJoin || false,
            category: data.category || "",
            flagOverrides: data.flagOverrides,
            onJoinMessageId: data.onJoinMessageId,
            createdAt: (eventsConfig[data.id] && eventsConfig[data.id].createdAt) || now,
            updatedAt: now
        };
        var action = eventsConfig[data.id] ? "updated" : "created";
        eventsConfig[data.id] = newEvent;
        ConfigLoader.saveSatoriConfig(nk, "live_events", eventsConfig);
        return RpcHelpers.successResponse({ event: newEvent, action: action });
    }
    // ---- Experiment Quick Setup ----
    function rpcExperimentSetup(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id || !data.name || !data.variants)
            return RpcHelpers.errorResponse("id, name, and variants[] required");
        var expConfig = ConfigLoader.loadSatoriConfig(nk, "experiments", {});
        var now = Math.floor(Date.now() / 1000);
        var newExp = {
            id: data.id,
            name: data.name,
            description: data.description || "",
            status: data.status || (data.enabled === false ? "draft" : "running"),
            audienceId: (data.audiences && data.audiences[0]) || data.audienceId || undefined,
            variants: data.variants,
            goalMetric: data.goalMetric,
            splitKey: data.splitKey,
            lockParticipation: data.lockParticipation || false,
            admissionDeadline: data.admissionDeadline,
            startAt: data.startAt,
            endAt: data.endAt,
            phases: data.phases,
            experimentType: data.experimentType || "custom",
            createdAt: (expConfig[data.id] && expConfig[data.id].createdAt) || now,
            updatedAt: now
        };
        var action = expConfig[data.id] ? "updated" : "created";
        expConfig[data.id] = newExp;
        ConfigLoader.saveSatoriConfig(nk, "experiments", expConfig);
        return RpcHelpers.successResponse({ experiment: newExp, action: action });
    }
    // ---- User Search ----
    function rpcUserSearch(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.username)
            return RpcHelpers.errorResponse("username required");
        try {
            var users = nk.usersGetUsername([data.username]);
            if (!users || users.length === 0)
                return RpcHelpers.successResponse({ found: false });
            var results = [];
            for (var i = 0; i < users.length; i++) {
                results.push({
                    userId: users[i].userId,
                    username: users[i].username,
                    displayName: users[i].displayName,
                    online: users[i].online,
                    createTime: users[i].createTime,
                    updateTime: users[i].updateTime
                });
            }
            return RpcHelpers.successResponse({ found: true, users: results });
        }
        catch (e) {
            return RpcHelpers.errorResponse("Search failed: " + (e.message || String(e)));
        }
    }
    // ---- Player Inventory Grant (admin shortcut) ----
    function rpcInventoryGrant(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.itemId)
            return RpcHelpers.errorResponse("userId and itemId required. Optional: quantity (default 1)");
        var inv = Storage.readJson(nk, Constants.HIRO_INVENTORY_COLLECTION, "state", data.userId) || { items: {} };
        var items = inv.items || {};
        var qty = data.quantity || 1;
        if (items[data.itemId]) {
            items[data.itemId].count = (items[data.itemId].count || 0) + qty;
        }
        else {
            items[data.itemId] = { id: data.itemId, count: qty, properties: data.properties || {} };
        }
        inv.items = items;
        Storage.writeJson(nk, Constants.HIRO_INVENTORY_COLLECTION, "state", data.userId, inv);
        return RpcHelpers.successResponse({ userId: data.userId, item: items[data.itemId] });
    }
    // ---- Send Admin Mailbox Message ----
    function rpcMailboxSend(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.subject)
            return RpcHelpers.errorResponse("userId and subject required. Optional: body, rewards, expiresInSec");
        var inbox = Storage.readJson(nk, Constants.HIRO_MAILBOX_COLLECTION, "inbox", data.userId) || { messages: [] };
        var messages = inbox.messages || [];
        var now = Math.floor(Date.now() / 1000);
        var msg = {
            id: nk.uuidv4(),
            subject: data.subject,
            body: data.body || "",
            rewards: data.rewards || [],
            createdAt: now,
            expiresAt: data.expiresInSec ? now + data.expiresInSec : 0,
            read: false,
            claimed: false,
            sender: "admin"
        };
        messages.push(msg);
        inbox.messages = messages;
        Storage.writeJson(nk, Constants.HIRO_MAILBOX_COLLECTION, "inbox", data.userId, inbox);
        return RpcHelpers.successResponse({ sent: true, messageId: msg.id, to: data.userId });
    }
    // ---- Satori Events Timeline (recent events for a user) ----
    function rpcEventsTimeline(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId)
            return RpcHelpers.errorResponse("userId required");
        var events = Storage.readJson(nk, Constants.SATORI_EVENTS_COLLECTION, "history", data.userId) || { events: [] };
        var list = events.events || [];
        var limit = data.limit || 50;
        var recent = list.slice(Math.max(0, list.length - limit));
        return RpcHelpers.successResponse({
            userId: data.userId,
            count: recent.length,
            totalEvents: list.length,
            events: recent
        });
    }
    // ---- System Health ----
    function rpcHealthCheck(ctx, logger, nk, payload) {
        return RpcHelpers.successResponse({
            status: "healthy",
            version: "2.0.0",
            systems: {
                hiro: ["economy", "inventory", "achievements", "progression", "energy", "stats",
                    "event_leaderboards", "streaks", "store", "challenges", "teams",
                    "tutorials", "unlockables", "auctions", "incentives", "mailbox"],
                satori: ["event_capture", "identities", "audiences", "feature_flags",
                    "experiments", "live_events", "messages", "metrics",
                    "webhooks", "taxonomy", "data_lake"]
            },
            collections: {
                hiro: [Constants.HIRO_CONFIGS_COLLECTION, Constants.HIRO_ACHIEVEMENTS_COLLECTION, Constants.HIRO_INVENTORY_COLLECTION,
                    Constants.HIRO_PROGRESSION_COLLECTION, Constants.HIRO_ENERGY_COLLECTION, Constants.HIRO_STATS_COLLECTION,
                    Constants.HIRO_STREAKS_COLLECTION, Constants.HIRO_TUTORIALS_COLLECTION, Constants.HIRO_UNLOCKABLES_COLLECTION,
                    Constants.HIRO_MAILBOX_COLLECTION, Constants.HIRO_CHALLENGES_COLLECTION, Constants.HIRO_AUCTIONS_COLLECTION],
                satori: [Constants.SATORI_CONFIGS_COLLECTION, Constants.SATORI_EVENTS_COLLECTION, Constants.SATORI_IDENTITY_COLLECTION,
                    Constants.SATORI_ASSIGNMENTS_COLLECTION, Constants.SATORI_MESSAGES_COLLECTION, Constants.SATORI_METRICS_COLLECTION],
                legacy: [Constants.WALLETS_COLLECTION, Constants.DAILY_REWARDS_COLLECTION, Constants.MISSIONS_COLLECTION,
                    Constants.QUIZ_RESULTS_COLLECTION, Constants.GAME_REGISTRY_COLLECTION, Constants.ANALYTICS_COLLECTION]
            },
            timestamp: new Date().toISOString()
        });
    }
    function register(initializer) {
        // Hiro config CRUD
        initializer.registerRpc("admin_config_get", rpcConfigGet);
        initializer.registerRpc("admin_config_set", rpcConfigSet);
        initializer.registerRpc("admin_config_delete", rpcConfigDelete);
        // Satori config CRUD
        initializer.registerRpc("admin_satori_config_get", rpcSatoriConfigGet);
        initializer.registerRpc("admin_satori_config_set", rpcSatoriConfigSet);
        // Bulk operations
        initializer.registerRpc("admin_bulk_export", rpcBulkExport);
        initializer.registerRpc("admin_bulk_import", rpcBulkImport);
        // Cache
        initializer.registerRpc("admin_cache_invalidate", rpcCacheInvalidate);
        // User data (generic)
        initializer.registerRpc("admin_user_data_get", rpcUserDataGet);
        initializer.registerRpc("admin_user_data_set", rpcUserDataSet);
        initializer.registerRpc("admin_user_data_delete", rpcUserDataDelete);
        // Player tools
        initializer.registerRpc("admin_player_inspect", rpcPlayerInspect);
        initializer.registerRpc("admin_user_search", rpcUserSearch);
        initializer.registerRpc("admin_wallet_view", rpcWalletView);
        initializer.registerRpc("admin_wallet_grant", rpcWalletGrant);
        initializer.registerRpc("admin_wallet_reset", rpcWalletReset);
        initializer.registerRpc("admin_inventory_grant", rpcInventoryGrant);
        initializer.registerRpc("admin_mailbox_send", rpcMailboxSend);
        // Satori quick-ops
        initializer.registerRpc("admin_flag_toggle", rpcFlagToggle);
        initializer.registerRpc("admin_live_event_schedule", rpcLiveEventSchedule);
        initializer.registerRpc("admin_experiment_setup", rpcExperimentSetup);
        initializer.registerRpc("admin_events_timeline", rpcEventsTimeline);
        // Storage browser
        initializer.registerRpc("admin_storage_list", rpcStorageList);
        // Health
        initializer.registerRpc("admin_health_check", rpcHealthCheck);
    }
    AdminConsole.register = register;
})(AdminConsole || (AdminConsole = {}));
var HiroBase;
(function (HiroBase) {
    // ---- IAP Validation ----
    var IAP_COLLECTION = "hiro_iap_purchases";
    var allowFakeReceipts = true;
    function validateReceipt(nk, logger, userId, request) {
        switch (request.storeType) {
            case "apple":
                return validateApple(nk, logger, userId, request);
            case "google":
                return validateGoogle(nk, logger, userId, request);
            case "facebook":
                return validateFacebook(nk, logger, userId, request);
            case "fake":
                if (!allowFakeReceipts) {
                    return { valid: false, productId: request.productId, storeType: request.storeType, error: "Fake receipts disabled" };
                }
                return { valid: true, productId: request.productId, storeType: request.storeType, transactionId: "fake_" + nk.uuidv4() };
            default:
                return { valid: false, productId: request.productId, storeType: request.storeType, error: "Unknown store type" };
        }
    }
    HiroBase.validateReceipt = validateReceipt;
    function validateApple(nk, logger, userId, request) {
        try {
            var validation = nk.purchaseValidateApple(userId, request.receipt);
            if (validation && validation.validatedPurchases && validation.validatedPurchases.length > 0) {
                var purchase = validation.validatedPurchases[0];
                recordPurchase(nk, userId, purchase.transactionId || nk.uuidv4(), request.productId, "apple", request.price);
                return { valid: true, productId: request.productId, storeType: "apple", transactionId: purchase.transactionId };
            }
            return { valid: false, productId: request.productId, storeType: "apple", error: "Validation failed" };
        }
        catch (e) {
            logger.warn("Apple IAP validation error: %s", e.message || String(e));
            return { valid: false, productId: request.productId, storeType: "apple", error: e.message || String(e) };
        }
    }
    function validateGoogle(nk, logger, userId, request) {
        try {
            var validation = nk.purchaseValidateGoogle(userId, request.receipt);
            if (validation && validation.validatedPurchases && validation.validatedPurchases.length > 0) {
                var purchase = validation.validatedPurchases[0];
                recordPurchase(nk, userId, purchase.transactionId || nk.uuidv4(), request.productId, "google", request.price);
                return { valid: true, productId: request.productId, storeType: "google", transactionId: purchase.transactionId };
            }
            return { valid: false, productId: request.productId, storeType: "google", error: "Validation failed" };
        }
        catch (e) {
            logger.warn("Google IAP validation error: %s", e.message || String(e));
            return { valid: false, productId: request.productId, storeType: "google", error: e.message || String(e) };
        }
    }
    function validateFacebook(nk, logger, userId, request) {
        try {
            var validation = nk.purchaseValidateFacebookInstant(userId, request.receipt);
            if (validation && validation.validatedPurchases && validation.validatedPurchases.length > 0) {
                var purchase = validation.validatedPurchases[0];
                recordPurchase(nk, userId, purchase.transactionId || nk.uuidv4(), request.productId, "facebook", request.price);
                return { valid: true, productId: request.productId, storeType: "facebook", transactionId: purchase.transactionId };
            }
            return { valid: false, productId: request.productId, storeType: "facebook", error: "Validation failed" };
        }
        catch (e) {
            logger.warn("Facebook IAP validation error: %s", e.message || String(e));
            return { valid: false, productId: request.productId, storeType: "facebook", error: e.message || String(e) };
        }
    }
    function recordPurchase(nk, userId, transactionId, productId, storeType, price) {
        var history = Storage.readJson(nk, IAP_COLLECTION, "history", userId);
        if (!history)
            history = { purchases: [] };
        history.purchases.push({
            transactionId: transactionId,
            productId: productId,
            storeType: storeType,
            validatedAt: Math.floor(Date.now() / 1000),
            price: price
        });
        Storage.writeJson(nk, IAP_COLLECTION, "history", userId, history);
    }
    // ---- Default Username Generation ----
    function generateDefaultUsername(nk) {
        var counter = Storage.readSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, "username_counter");
        var count = (counter && counter.count) || 0;
        count++;
        Storage.writeSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, "username_counter", { count: count });
        var padded = String(count);
        while (padded.length < 8)
            padded = "0" + padded;
        return "Player" + padded;
    }
    HiroBase.generateDefaultUsername = generateDefaultUsername;
    // ---- Store IAP Purchase ----
    function rpcIAPPurchase(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.receipt || !data.storeType || !data.productId) {
            return RpcHelpers.errorResponse("receipt, storeType, and productId required");
        }
        var result = validateReceipt(nk, logger, userId, {
            receipt: data.receipt,
            storeType: data.storeType,
            productId: data.productId,
            price: data.price,
            currency: data.currency
        });
        if (!result.valid) {
            return RpcHelpers.errorResponse("IAP validation failed: " + (result.error || "unknown"));
        }
        var storeConfig = HiroStore.getConfig(nk);
        var offer = null;
        for (var sectionId in storeConfig.sections) {
            for (var offerId in storeConfig.sections[sectionId].items) {
                var item = storeConfig.sections[sectionId].items[offerId];
                if (item.cost && item.cost.iapProductId === data.productId) {
                    offer = item;
                    break;
                }
            }
            if (offer)
                break;
        }
        if (!offer) {
            return RpcHelpers.errorResponse("No store item found for product ID: " + data.productId);
        }
        var resolved = RewardEngine.resolveReward(nk, offer.reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
        EventBus.emit(nk, logger, ctx, EventBus.Events.STORE_PURCHASE, {
            userId: userId, offerId: data.productId, reward: resolved, iap: true, price: data.price
        });
        return RpcHelpers.successResponse({ valid: true, reward: resolved, transactionId: result.transactionId });
    }
    function rpcGetPurchaseHistory(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var history = Storage.readJson(nk, IAP_COLLECTION, "history", userId);
        return RpcHelpers.successResponse({ purchases: (history && history.purchases) || [] });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_iap_validate", rpcIAPPurchase);
        initializer.registerRpc("hiro_iap_history", rpcGetPurchaseHistory);
    }
    HiroBase.register = register;
})(HiroBase || (HiroBase = {}));
var HiroChallenges;
(function (HiroChallenges) {
    var DEFAULT_CONFIG = { challenges: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "challenges", DEFAULT_CONFIG);
    }
    HiroChallenges.getConfig = getConfig;
    function getChallengeInstance(nk, instanceId) {
        return Storage.readSystemJson(nk, Constants.HIRO_CHALLENGES_COLLECTION, instanceId);
    }
    function saveChallengeInstance(nk, instance) {
        Storage.writeSystemJson(nk, Constants.HIRO_CHALLENGES_COLLECTION, instance.id, instance);
    }
    function rpcCreate(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.challengeId)
            return RpcHelpers.errorResponse("challengeId required");
        var config = getConfig(nk);
        var def = config.challenges[data.challengeId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown challenge");
        if (def.entryCost && def.entryCost.currencies) {
            for (var cid in def.entryCost.currencies) {
                WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, def.entryCost.currencies[cid]);
            }
        }
        var now = Math.floor(Date.now() / 1000);
        var instanceId = nk.uuidv4();
        var lbId = "challenge_" + instanceId;
        var sortOrder = def.sortOrder === "asc" ? "ascending" /* nkruntime.SortOrder.ASCENDING */ : "descending" /* nkruntime.SortOrder.DESCENDING */;
        var operatorMap = { best: "best" /* nkruntime.Operator.BEST */, set: "set" /* nkruntime.Operator.SET */, incr: "increment" /* nkruntime.Operator.INCREMENTAL */ };
        nk.leaderboardCreate(lbId, false, sortOrder, operatorMap[def.scoreOperator] || "best" /* nkruntime.Operator.BEST */);
        var instance = {
            id: instanceId,
            challengeId: data.challengeId,
            creatorId: userId,
            participants: {},
            leaderboardId: lbId,
            startAt: now,
            endAt: now + def.durationSec,
            claimedBy: []
        };
        instance.participants[userId] = { score: 0, joinedAt: now };
        saveChallengeInstance(nk, instance);
        return RpcHelpers.successResponse({ challenge: instance });
    }
    function rpcJoin(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.instanceId)
            return RpcHelpers.errorResponse("instanceId required");
        var instance = getChallengeInstance(nk, data.instanceId);
        if (!instance)
            return RpcHelpers.errorResponse("Challenge not found");
        var config = getConfig(nk);
        var def = config.challenges[instance.challengeId];
        if (!def)
            return RpcHelpers.errorResponse("Challenge config not found");
        var participantCount = Object.keys(instance.participants).length;
        if (participantCount >= def.maxParticipants)
            return RpcHelpers.errorResponse("Challenge full");
        var now = Math.floor(Date.now() / 1000);
        if (now > instance.endAt)
            return RpcHelpers.errorResponse("Challenge ended");
        if (def.entryCost && def.entryCost.currencies) {
            for (var cid in def.entryCost.currencies) {
                WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, def.entryCost.currencies[cid]);
            }
        }
        instance.participants[userId] = { score: 0, joinedAt: now };
        saveChallengeInstance(nk, instance);
        return RpcHelpers.successResponse({ challenge: instance });
    }
    function rpcSubmit(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.instanceId || data.score === undefined)
            return RpcHelpers.errorResponse("instanceId and score required");
        var instance = getChallengeInstance(nk, data.instanceId);
        if (!instance)
            return RpcHelpers.errorResponse("Challenge not found");
        if (!instance.participants[userId])
            return RpcHelpers.errorResponse("Not a participant");
        var now = Math.floor(Date.now() / 1000);
        if (now > instance.endAt)
            return RpcHelpers.errorResponse("Challenge ended");
        nk.leaderboardRecordWrite(instance.leaderboardId, userId, ctx.username || "", data.score, 0, {}, "best" /* nkruntime.OverrideOperator.BEST */);
        instance.participants[userId].score = data.score;
        saveChallengeInstance(nk, instance);
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.instanceId)
            return RpcHelpers.errorResponse("instanceId required");
        var instance = getChallengeInstance(nk, data.instanceId);
        if (!instance)
            return RpcHelpers.errorResponse("Challenge not found");
        if (instance.claimedBy.indexOf(userId) >= 0)
            return RpcHelpers.errorResponse("Already claimed");
        var config = getConfig(nk);
        var def = config.challenges[instance.challengeId];
        if (!def)
            return RpcHelpers.errorResponse("Challenge config not found");
        var records = nk.leaderboardRecordsList(instance.leaderboardId, [userId], 1, undefined, 0);
        var rank = 0;
        if (records.records && records.records.length > 0) {
            rank = records.records[0].rank;
        }
        if (rank === 1 && def.reward) {
            var resolved = RewardEngine.resolveReward(nk, def.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
            instance.claimedBy.push(userId);
            saveChallengeInstance(nk, instance);
            EventBus.emit(nk, logger, ctx, EventBus.Events.CHALLENGE_COMPLETED, {
                userId: userId, challengeId: instance.challengeId, rank: rank
            });
            return RpcHelpers.successResponse({ rank: rank, reward: resolved });
        }
        instance.claimedBy.push(userId);
        saveChallengeInstance(nk, instance);
        return RpcHelpers.successResponse({ rank: rank, reward: null });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_challenges_create", rpcCreate);
        initializer.registerRpc("hiro_challenges_join", rpcJoin);
        initializer.registerRpc("hiro_challenges_submit", rpcSubmit);
        initializer.registerRpc("hiro_challenges_claim", rpcClaim);
    }
    HiroChallenges.register = register;
})(HiroChallenges || (HiroChallenges = {}));
var HiroEconomy;
(function (HiroEconomy) {
    var DEFAULT_CONFIG = {
        currencies: {
            game: { name: "Game Coins", initialAmount: 0 },
            tokens: { name: "Tokens", initialAmount: 0 },
            xp: { name: "Experience Points", initialAmount: 0 }
        },
        donations: {},
        storeItems: {}
    };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "economy", DEFAULT_CONFIG);
    }
    HiroEconomy.getConfig = getConfig;
    function getUserDonations(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "donations_" + userId), userId);
        return data || { outgoing: [], incoming: {} };
    }
    function saveUserDonations(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "donations_" + userId), userId, data);
    }
    function getRewardedVideoState(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "rewarded_video_" + userId), userId);
        return data || { viewsToday: 0, lastViewDate: "", totalViews: 0 };
    }
    // ---- RPCs ----
    function rpcDonationRequest(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var donationId = data.donationId;
        if (!donationId)
            return RpcHelpers.errorResponse("donationId is required");
        var config = getConfig(nk);
        var donationDef = config.donations[donationId];
        if (!donationDef)
            return RpcHelpers.errorResponse("Unknown donation: " + donationId);
        var donations = getUserDonations(nk, userId, data.gameId);
        var now = Math.floor(Date.now() / 1000);
        var newDonation = {
            id: nk.uuidv4(),
            donationId: donationId,
            requesterId: userId,
            contributions: {},
            totalContributed: 0,
            createdAt: now,
            expiresAt: now + donationDef.durationSec
        };
        donations.outgoing.push(newDonation);
        saveUserDonations(nk, userId, donations, data.gameId);
        return RpcHelpers.successResponse(newDonation);
    }
    HiroEconomy.rpcDonationRequest = rpcDonationRequest;
    function rpcDonationGive(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var targetUserId = data.userId;
        var donationId = data.donationId;
        if (!targetUserId || !donationId)
            return RpcHelpers.errorResponse("userId and donationId required");
        var config = getConfig(nk);
        var donationDef = config.donations[donationId];
        if (!donationDef)
            return RpcHelpers.errorResponse("Unknown donation: " + donationId);
        if (donationDef.cost && donationDef.cost.currencies) {
            for (var cid in donationDef.cost.currencies) {
                WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, donationDef.cost.currencies[cid]);
            }
        }
        var targetDonations = getUserDonations(nk, targetUserId, data.gameId);
        var now = Math.floor(Date.now() / 1000);
        for (var i = 0; i < targetDonations.outgoing.length; i++) {
            var d = targetDonations.outgoing[i];
            if (d.donationId === donationId && !d.claimedAt && d.expiresAt > now) {
                var userContrib = d.contributions[userId] || 0;
                if (donationDef.userContributionMaxCount && userContrib >= donationDef.userContributionMaxCount) {
                    return RpcHelpers.errorResponse("Max contributions reached");
                }
                if (d.totalContributed >= donationDef.maxCount) {
                    return RpcHelpers.errorResponse("Donation is full");
                }
                d.contributions[userId] = userContrib + 1;
                d.totalContributed++;
                break;
            }
        }
        saveUserDonations(nk, targetUserId, targetDonations, data.gameId);
        if (donationDef.senderReward) {
            var senderResolved = RewardEngine.resolveReward(nk, donationDef.senderReward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", senderResolved);
        }
        return RpcHelpers.successResponse({ success: true });
    }
    HiroEconomy.rpcDonationGive = rpcDonationGive;
    function rpcDonationClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var donationIds = data.donationIds;
        if (!donationIds || donationIds.length === 0)
            return RpcHelpers.errorResponse("donationIds required");
        var config = getConfig(nk);
        var donations = getUserDonations(nk, userId, data.gameId);
        var now = Math.floor(Date.now() / 1000);
        var claimed = [];
        for (var i = 0; i < donations.outgoing.length; i++) {
            var d = donations.outgoing[i];
            if (donationIds.indexOf(d.donationId) >= 0 && !d.claimedAt && d.totalContributed > 0) {
                d.claimedAt = now;
                var donationDef = config.donations[d.donationId];
                if (donationDef && donationDef.reward) {
                    var resolved = RewardEngine.resolveReward(nk, donationDef.reward);
                    RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
                }
                claimed.push(d.donationId);
            }
        }
        saveUserDonations(nk, userId, donations, data.gameId);
        return RpcHelpers.successResponse({ claimed: claimed });
    }
    HiroEconomy.rpcDonationClaim = rpcDonationClaim;
    function rpcRewardedVideoComplete(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var state = getRewardedVideoState(nk, userId, data.gameId);
        var today = new Date().toISOString().slice(0, 10);
        if (state.lastViewDate !== today) {
            state.viewsToday = 0;
            state.lastViewDate = today;
        }
        state.viewsToday++;
        state.totalViews++;
        Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(data.gameId, "rewarded_video_" + userId), userId, state);
        if (data.reward) {
            var resolved = RewardEngine.resolveReward(nk, data.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
            return RpcHelpers.successResponse({ reward: resolved, state: state });
        }
        return RpcHelpers.successResponse({ state: state });
    }
    HiroEconomy.rpcRewardedVideoComplete = rpcRewardedVideoComplete;
    function register(initializer) {
        initializer.registerRpc("hiro_economy_donation_request", rpcDonationRequest);
        initializer.registerRpc("hiro_economy_donation_give", rpcDonationGive);
        initializer.registerRpc("hiro_economy_donation_claim", rpcDonationClaim);
        initializer.registerRpc("hiro_economy_rewarded_video", rpcRewardedVideoComplete);
    }
    HiroEconomy.register = register;
})(HiroEconomy || (HiroEconomy = {}));
var HiroEnergy;
(function (HiroEnergy) {
    var DEFAULT_CONFIG = {
        energies: {
            lives: { name: "Lives", maxEnergy: 5, startCount: 5, regenTimeSec: 1800 }
        }
    };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "energy", DEFAULT_CONFIG);
    }
    HiroEnergy.getConfig = getConfig;
    function getUserEnergy(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_ENERGY_COLLECTION, Constants.gameKey(gameId, "state"), userId);
        if (data)
            return data;
        var config = getConfig(nk);
        var energies = {};
        var now = Math.floor(Date.now() / 1000);
        for (var id in config.energies) {
            var def = config.energies[id];
            energies[id] = {
                current: def.startCount,
                maxEnergy: def.maxEnergy,
                regenTimeSec: def.regenTimeSec,
                lastRegenAt: now
            };
        }
        return { energies: energies };
    }
    function saveUserEnergy(nk, userId, state, gameId) {
        Storage.writeJson(nk, Constants.HIRO_ENERGY_COLLECTION, Constants.gameKey(gameId, "state"), userId, state);
    }
    function applyRegen(state) {
        var now = Math.floor(Date.now() / 1000);
        if (state.current >= state.maxEnergy) {
            state.lastRegenAt = now;
            return state;
        }
        if (state.regenTimeSec <= 0)
            return state;
        var elapsed = now - state.lastRegenAt;
        var regenUnits = Math.floor(elapsed / state.regenTimeSec);
        // Purge expired modifiers
        if (state.modifiers) {
            state.modifiers = state.modifiers.filter(function (m) { return !m.expiresAt || m.expiresAt > now; });
            for (var mi = 0; mi < state.modifiers.length; mi++) {
                var mod = state.modifiers[mi];
                if (mod.id === "max_energy") {
                    if (mod.operator === "add")
                        state.maxEnergy += mod.value;
                    else if (mod.operator === "multiply")
                        state.maxEnergy = Math.floor(state.maxEnergy * mod.value);
                }
                if (mod.id === "regen_rate") {
                    if (mod.operator === "add")
                        state.regenTimeSec = Math.max(1, state.regenTimeSec - mod.value);
                    else if (mod.operator === "multiply")
                        state.regenTimeSec = Math.max(1, Math.floor(state.regenTimeSec / mod.value));
                }
            }
        }
        if (regenUnits > 0) {
            state.current = Math.min(state.current + regenUnits, state.maxEnergy);
            state.lastRegenAt = state.lastRegenAt + (regenUnits * state.regenTimeSec);
        }
        return state;
    }
    function addEnergy(nk, logger, ctx, userId, energyId, amount, gameId) {
        var state = getUserEnergy(nk, userId, gameId);
        var e = state.energies[energyId];
        if (!e) {
            var config = getConfig(nk);
            var def = config.energies[energyId];
            if (!def)
                return;
            e = {
                current: def.startCount,
                maxEnergy: def.maxEnergy,
                regenTimeSec: def.regenTimeSec,
                lastRegenAt: Math.floor(Date.now() / 1000)
            };
        }
        e = applyRegen(e);
        var maxOverfill = e.maxOverfill || e.maxEnergy;
        e.current = Math.min(e.current + amount, maxOverfill);
        state.energies[energyId] = e;
        saveUserEnergy(nk, userId, state, gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.ENERGY_REFILLED, {
            userId: userId, energyId: energyId, amount: amount, current: e.current
        });
    }
    HiroEnergy.addEnergy = addEnergy;
    function spendEnergy(nk, logger, ctx, userId, energyId, amount, gameId) {
        var state = getUserEnergy(nk, userId, gameId);
        var e = state.energies[energyId];
        if (!e)
            return false;
        e = applyRegen(e);
        if (e.current < amount)
            return false;
        e.current -= amount;
        state.energies[energyId] = e;
        saveUserEnergy(nk, userId, state, gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.ENERGY_SPENT, {
            userId: userId, energyId: energyId, amount: amount, current: e.current
        });
        return true;
    }
    HiroEnergy.spendEnergy = spendEnergy;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId;
        var state = getUserEnergy(nk, userId, gameId);
        var now = Math.floor(Date.now() / 1000);
        var result = {};
        for (var id in state.energies) {
            var e = applyRegen(state.energies[id]);
            var secsToNext = e.current >= e.maxEnergy ? 0 : e.regenTimeSec - (now - e.lastRegenAt);
            result[id] = {
                current: e.current,
                max: e.maxEnergy,
                regenTimeSec: e.regenTimeSec,
                secsToNextRegen: Math.max(0, secsToNext)
            };
        }
        saveUserEnergy(nk, userId, state, gameId);
        return RpcHelpers.successResponse({ energies: result });
    }
    function rpcSpend(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.energyId || !data.amount)
            return RpcHelpers.errorResponse("energyId and amount required");
        if (!spendEnergy(nk, logger, ctx, userId, data.energyId, data.amount, data.gameId)) {
            return RpcHelpers.errorResponse("Insufficient energy");
        }
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcRefill(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.energyId)
            return RpcHelpers.errorResponse("energyId required");
        var config = getConfig(nk);
        var def = config.energies[data.energyId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown energy type");
        addEnergy(nk, logger, ctx, userId, data.energyId, def.maxEnergy, data.gameId);
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcAddModifier(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.energyId || !data.modifierId || !data.durationSec) {
            return RpcHelpers.errorResponse("energyId, modifierId, and durationSec required");
        }
        var state = getUserEnergy(nk, userId, data.gameId);
        var e = state.energies[data.energyId];
        if (!e)
            return RpcHelpers.errorResponse("Unknown energy type");
        if (!e.modifiers)
            e.modifiers = [];
        var now = Math.floor(Date.now() / 1000);
        e.modifiers.push({
            id: data.modifierId,
            operator: data.operator || "add",
            value: data.value || 0,
            durationSec: data.durationSec,
            expiresAt: now + data.durationSec
        });
        state.energies[data.energyId] = e;
        saveUserEnergy(nk, userId, state, data.gameId);
        return RpcHelpers.successResponse({ success: true, modifiers: e.modifiers });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_energy_get", rpcGet);
        initializer.registerRpc("hiro_energy_spend", rpcSpend);
        initializer.registerRpc("hiro_energy_refill", rpcRefill);
        initializer.registerRpc("hiro_energy_add_modifier", rpcAddModifier);
    }
    HiroEnergy.register = register;
})(HiroEnergy || (HiroEnergy = {}));
var HiroEventLeaderboards;
(function (HiroEventLeaderboards) {
    var DEFAULT_CONFIG = { events: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "event_leaderboards", DEFAULT_CONFIG);
    }
    HiroEventLeaderboards.getConfig = getConfig;
    function getUserEventState(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "event_lb_state_" + userId), userId);
        return data || { events: {} };
    }
    function saveUserEventState(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "event_lb_state_" + userId), userId, data);
    }
    function getActiveEvents(nk) {
        var data = Storage.readSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, "active_event_lbs");
        return (data && data.events) || [];
    }
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        var activeEvents = getActiveEvents(nk);
        var userState = getUserEventState(nk, userId, data.gameId);
        var now = Math.floor(Date.now() / 1000);
        var result = [];
        for (var i = 0; i < activeEvents.length; i++) {
            var ae = activeEvents[i];
            var def = config.events[ae.eventId];
            if (!def)
                continue;
            var status = now < ae.startAt ? "upcoming" : now > ae.endAt ? "ended" : "active";
            var us = userState.events[ae.eventId];
            result.push({
                eventId: ae.eventId,
                name: def.name,
                description: def.description,
                leaderboardId: ae.leaderboardId,
                startAt: ae.startAt,
                endAt: ae.endAt,
                status: status,
                joined: us ? us.joined : false,
                claimed: us ? !!us.claimedAt : false,
                tiers: def.tiers
            });
        }
        return RpcHelpers.successResponse({ events: result });
    }
    function rpcSubmit(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId || data.score === undefined)
            return RpcHelpers.errorResponse("eventId and score required");
        var config = getConfig(nk);
        var def = config.events[data.eventId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown event");
        var activeEvents = getActiveEvents(nk);
        var ae = activeEvents.find(function (e) { return e.eventId === data.eventId; });
        if (!ae)
            return RpcHelpers.errorResponse("Event not active");
        var now = Math.floor(Date.now() / 1000);
        if (now < ae.startAt || now > ae.endAt)
            return RpcHelpers.errorResponse("Event not in active window");
        var userState = getUserEventState(nk, userId, data.gameId);
        if (!userState.events[data.eventId]) {
            userState.events[data.eventId] = { joined: true, cohortId: ae.cohortId || "default" };
        }
        userState.events[data.eventId].joined = true;
        saveUserEventState(nk, userId, userState, data.gameId);
        var operatorMap = { best: "best" /* nkruntime.OverrideOperator.BEST */, set: "set" /* nkruntime.OverrideOperator.SET */, incr: "increment" /* nkruntime.OverrideOperator.INCREMENTAL */, decr: "decrement" /* nkruntime.OverrideOperator.DECREMENTAL */ };
        var op = operatorMap[def.operator] || "best" /* nkruntime.OverrideOperator.BEST */;
        nk.leaderboardRecordWrite(ae.leaderboardId, userId, ctx.username || "", data.score, data.subscore || 0, data.metadata || {}, op);
        EventBus.emit(nk, logger, ctx, EventBus.Events.SCORE_SUBMITTED, {
            userId: userId, eventId: data.eventId, score: data.score
        });
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var config = getConfig(nk);
        var def = config.events[data.eventId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown event");
        var userState = getUserEventState(nk, userId, data.gameId);
        var us = userState.events[data.eventId];
        if (!us || !us.joined)
            return RpcHelpers.errorResponse("Not joined");
        if (us.claimedAt)
            return RpcHelpers.errorResponse("Already claimed");
        var activeEvents = getActiveEvents(nk);
        var ae = activeEvents.find(function (e) { return e.eventId === data.eventId; });
        if (!ae)
            return RpcHelpers.errorResponse("Event not found");
        var records = nk.leaderboardRecordsList(ae.leaderboardId, [userId], 1, undefined, 0);
        var rank = 0;
        if (records.records && records.records.length > 0) {
            rank = records.records[0].rank;
        }
        var reward = null;
        for (var i = 0; i < def.tiers.length; i++) {
            var tier = def.tiers[i];
            if (rank >= tier.rankMin && rank <= tier.rankMax) {
                reward = RewardEngine.resolveReward(nk, tier.reward);
                RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
                break;
            }
        }
        us.claimedAt = Math.floor(Date.now() / 1000);
        saveUserEventState(nk, userId, userState, data.gameId);
        return RpcHelpers.successResponse({ rank: rank, reward: reward });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_event_lb_list", rpcList);
        initializer.registerRpc("hiro_event_lb_submit", rpcSubmit);
        initializer.registerRpc("hiro_event_lb_claim", rpcClaim);
    }
    HiroEventLeaderboards.register = register;
})(HiroEventLeaderboards || (HiroEventLeaderboards = {}));
var HiroIncentives;
(function (HiroIncentives) {
    var DEFAULT_CONFIG = {};
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "incentives", DEFAULT_CONFIG);
    }
    HiroIncentives.getConfig = getConfig;
    function getUserState(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "incentives_" + userId), userId);
        return data || { referralsClaimed: [], lastSeenAt: 0, returnBonusClaimed: false };
    }
    function saveUserState(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "incentives_" + userId), userId, data);
    }
    function rpcGetReferralCode(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var state = getUserState(nk, userId, data.gameId);
        if (!state.referralCode) {
            state.referralCode = userId.substring(0, 8).toUpperCase();
            saveUserState(nk, userId, state, data.gameId);
        }
        return RpcHelpers.successResponse({ referralCode: state.referralCode });
    }
    function rpcApplyReferral(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.referralCode)
            return RpcHelpers.errorResponse("referralCode required");
        var state = getUserState(nk, userId, data.gameId);
        if (state.referredBy)
            return RpcHelpers.errorResponse("Already referred");
        var config = getConfig(nk);
        state.referredBy = data.referralCode;
        saveUserState(nk, userId, state, data.gameId);
        if (config.referralReward) {
            var resolved = RewardEngine.resolveReward(nk, config.referralReward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
        }
        if (config.referrerReward) {
            RewardEngine.grantToMailbox(nk, data.referralCode, "Referral Reward", config.referrerReward);
        }
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcCheckReturnBonus(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        var state = getUserState(nk, userId, data.gameId);
        var now = Math.floor(Date.now() / 1000);
        var eligible = false;
        if (!state.returnBonusClaimed && state.lastSeenAt > 0 && config.returnBonusDays) {
            var daysSinceLastSeen = (now - state.lastSeenAt) / 86400;
            eligible = daysSinceLastSeen >= config.returnBonusDays;
        }
        state.lastSeenAt = now;
        saveUserState(nk, userId, state, data.gameId);
        if (eligible && config.returnBonus) {
            var resolved = RewardEngine.resolveReward(nk, config.returnBonus);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
            state.returnBonusClaimed = true;
            saveUserState(nk, userId, state, data.gameId);
            return RpcHelpers.successResponse({ eligible: true, reward: resolved });
        }
        return RpcHelpers.successResponse({ eligible: eligible });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_incentives_referral_code", rpcGetReferralCode);
        initializer.registerRpc("hiro_incentives_apply_referral", rpcApplyReferral);
        initializer.registerRpc("hiro_incentives_return_bonus", rpcCheckReturnBonus);
    }
    HiroIncentives.register = register;
})(HiroIncentives || (HiroIncentives = {}));
var HiroInventory;
(function (HiroInventory) {
    var DEFAULT_CONFIG = { items: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "inventory", DEFAULT_CONFIG);
    }
    HiroInventory.getConfig = getConfig;
    function getUserInventory(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_INVENTORY_COLLECTION, Constants.gameKey(gameId, "items"), userId);
        return data || { items: {} };
    }
    function saveUserInventory(nk, userId, inv, gameId) {
        Storage.writeJson(nk, Constants.HIRO_INVENTORY_COLLECTION, Constants.gameKey(gameId, "items"), userId, inv);
    }
    function grantItem(nk, logger, ctx, userId, itemId, count, stringProps, numericProps, gameId) {
        var config = getConfig(nk);
        var itemDef = config.items[itemId];
        var inv = getUserInventory(nk, userId, gameId);
        var now = Math.floor(Date.now() / 1000);
        var existing = inv.items[itemId];
        if (existing && itemDef && itemDef.stackable) {
            existing.count += count;
            if (itemDef.maxCount && existing.count > itemDef.maxCount) {
                existing.count = itemDef.maxCount;
            }
        }
        else {
            inv.items[itemId] = {
                id: itemId,
                count: count,
                acquiredAt: now,
                expiresAt: (itemDef && itemDef.durableSec) ? now + itemDef.durableSec : undefined,
                stringProperties: stringProps || {},
                numericProperties: numericProps || {}
            };
        }
        saveUserInventory(nk, userId, inv, gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.ITEM_GRANTED, {
            userId: userId, itemId: itemId, count: count
        });
        return inv.items[itemId];
    }
    HiroInventory.grantItem = grantItem;
    function consumeItem(nk, logger, ctx, userId, itemId, count, gameId) {
        var inv = getUserInventory(nk, userId, gameId);
        var item = inv.items[itemId];
        if (!item || item.count < count) {
            return false;
        }
        item.count -= count;
        if (item.count <= 0) {
            delete inv.items[itemId];
        }
        saveUserInventory(nk, userId, inv, gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.ITEM_CONSUMED, {
            userId: userId, itemId: itemId, count: count
        });
        return true;
    }
    HiroInventory.consumeItem = consumeItem;
    function hasItem(nk, userId, itemId, count, gameId) {
        var inv = getUserInventory(nk, userId, gameId);
        var item = inv.items[itemId];
        return !!item && item.count >= count;
    }
    HiroInventory.hasItem = hasItem;
    function purgeExpired(inv) {
        var now = Math.floor(Date.now() / 1000);
        for (var id in inv.items) {
            if (inv.items[id].expiresAt && inv.items[id].expiresAt <= now) {
                delete inv.items[id];
            }
        }
        return inv;
    }
    // ---- RPCs ----
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId;
        var inv = getUserInventory(nk, userId, gameId);
        inv = purgeExpired(inv);
        saveUserInventory(nk, userId, inv, gameId);
        if (data.category) {
            var config = getConfig(nk);
            var filtered = {};
            for (var id in inv.items) {
                var def = config.items[id];
                if (def && def.category === data.category) {
                    filtered[id] = inv.items[id];
                }
            }
            return RpcHelpers.successResponse({ items: filtered });
        }
        return RpcHelpers.successResponse({ items: inv.items });
    }
    function rpcGrant(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.itemId || !data.count)
            return RpcHelpers.errorResponse("itemId and count required");
        var item = grantItem(nk, logger, ctx, userId, data.itemId, data.count, data.stringProperties, data.numericProperties, data.gameId);
        return RpcHelpers.successResponse({ item: item });
    }
    function rpcConsume(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.itemId || !data.count)
            return RpcHelpers.errorResponse("itemId and count required");
        var ok = consumeItem(nk, logger, ctx, userId, data.itemId, data.count, data.gameId);
        if (!ok)
            return RpcHelpers.errorResponse("Insufficient items");
        return RpcHelpers.successResponse({ success: true });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_inventory_list", rpcList);
        initializer.registerRpc("hiro_inventory_grant", rpcGrant);
        initializer.registerRpc("hiro_inventory_consume", rpcConsume);
    }
    HiroInventory.register = register;
})(HiroInventory || (HiroInventory = {}));
var HiroLeaderboards;
(function (HiroLeaderboards) {
    var DEFAULT_CONFIG = { leaderboards: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "leaderboards", DEFAULT_CONFIG);
    }
    function rpcList(ctx, logger, nk, payload) {
        var config = getConfig(nk);
        var result = [];
        for (var id in config.leaderboards) {
            result.push({ id: id, name: config.leaderboards[id].name, enableGeo: config.leaderboards[id].enableGeo });
        }
        return RpcHelpers.successResponse({ leaderboards: result });
    }
    function rpcSubmit(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.leaderboardId || data.score === undefined)
            return RpcHelpers.errorResponse("leaderboardId and score required");
        var config = getConfig(nk);
        var def = config.leaderboards[data.leaderboardId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown leaderboard");
        var operator = "best" /* nkruntime.Operator.BEST */;
        switch (def.operator) {
            case "best":
                operator = "best" /* nkruntime.Operator.BEST */;
                break;
            case "set":
                operator = "set" /* nkruntime.Operator.SET */;
                break;
            case "incr":
            case "decr":
                operator = "increment" /* nkruntime.Operator.INCREMENTAL */;
                break;
        }
        var metadata = data.metadata || {};
        if (def.enableGeo && data.location) {
            metadata.country = data.location.country || "";
            metadata.region = data.location.region || "";
            metadata.city = data.location.city || "";
        }
        try {
            nk.leaderboardRecordWrite(data.leaderboardId, userId, ctx.username, data.score, data.subscore || 0, metadata, undefined);
        }
        catch (e) {
            try {
                var sort = def.sortOrder === "asc" ? "ascending" /* nkruntime.SortOrder.ASCENDING */ : "descending" /* nkruntime.SortOrder.DESCENDING */;
                nk.leaderboardCreate(data.leaderboardId, false, sort, operator);
                nk.leaderboardRecordWrite(data.leaderboardId, userId, ctx.username, data.score, data.subscore || 0, metadata, undefined);
            }
            catch (e2) {
                return RpcHelpers.errorResponse("Failed to submit score: " + (e2.message || String(e2)));
            }
        }
        EventBus.emit(nk, logger, ctx, EventBus.Events.SCORE_SUBMITTED, {
            userId: userId, leaderboardId: data.leaderboardId, score: data.score
        });
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcGetRecords(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.leaderboardId)
            return RpcHelpers.errorResponse("leaderboardId required");
        var limit = data.limit || 20;
        var cursor = data.cursor || "";
        try {
            var result = nk.leaderboardRecordsList(data.leaderboardId, [], limit, cursor, undefined);
            var records = [];
            if (result.records) {
                for (var i = 0; i < result.records.length; i++) {
                    var r = result.records[i];
                    records.push({
                        userId: r.ownerId,
                        username: r.username || "",
                        score: r.score,
                        subscore: r.subscore,
                        rank: r.rank,
                        metadata: r.metadata,
                        updateTime: r.updateTime
                    });
                }
            }
            if (data.geoFilter) {
                records = records.filter(function (rec) {
                    if (!rec.metadata)
                        return false;
                    var meta = typeof rec.metadata === "string" ? JSON.parse(rec.metadata) : rec.metadata;
                    if (data.geoFilter.country && meta.country !== data.geoFilter.country)
                        return false;
                    if (data.geoFilter.region && meta.region !== data.geoFilter.region)
                        return false;
                    return true;
                });
            }
            return RpcHelpers.successResponse({ records: records, nextCursor: result.nextCursor || "" });
        }
        catch (e) {
            return RpcHelpers.errorResponse("Failed: " + (e.message || String(e)));
        }
    }
    function register(initializer) {
        initializer.registerRpc("hiro_leaderboards_list", rpcList);
        initializer.registerRpc("hiro_leaderboards_submit", rpcSubmit);
        initializer.registerRpc("hiro_leaderboards_records", rpcGetRecords);
    }
    HiroLeaderboards.register = register;
})(HiroLeaderboards || (HiroLeaderboards = {}));
var HiroMailbox;
(function (HiroMailbox) {
    function getUserMailbox(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_MAILBOX_COLLECTION, Constants.gameKey(gameId, "inbox"), userId);
        return data || { messages: [] };
    }
    function saveUserMailbox(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_MAILBOX_COLLECTION, Constants.gameKey(gameId, "inbox"), userId, data);
    }
    function purgeExpired(mailbox) {
        var now = Math.floor(Date.now() / 1000);
        mailbox.messages = mailbox.messages.filter(function (m) {
            return !m.expiresAt || m.expiresAt > now;
        });
        return mailbox;
    }
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var mailbox = getUserMailbox(nk, userId, data.gameId);
        mailbox = purgeExpired(mailbox);
        saveUserMailbox(nk, userId, mailbox, data.gameId);
        return RpcHelpers.successResponse({ messages: mailbox.messages });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.messageId)
            return RpcHelpers.errorResponse("messageId required");
        var mailbox = getUserMailbox(nk, userId, data.gameId);
        mailbox = purgeExpired(mailbox);
        var msg = mailbox.messages.find(function (m) { return m.id === data.messageId; });
        if (!msg)
            return RpcHelpers.errorResponse("Message not found");
        if (msg.claimedAt)
            return RpcHelpers.errorResponse("Already claimed");
        var reward = null;
        if (msg.reward) {
            reward = RewardEngine.resolveReward(nk, msg.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
        }
        msg.claimedAt = Math.floor(Date.now() / 1000);
        msg.readAt = msg.readAt || msg.claimedAt;
        saveUserMailbox(nk, userId, mailbox, data.gameId);
        return RpcHelpers.successResponse({ reward: reward });
    }
    function rpcDelete(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.messageId)
            return RpcHelpers.errorResponse("messageId required");
        var mailbox = getUserMailbox(nk, userId, data.gameId);
        mailbox.messages = mailbox.messages.filter(function (m) { return m.id !== data.messageId; });
        saveUserMailbox(nk, userId, mailbox, data.gameId);
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcClaimAll(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var mailbox = getUserMailbox(nk, userId, data.gameId);
        mailbox = purgeExpired(mailbox);
        var now = Math.floor(Date.now() / 1000);
        var claimed = 0;
        for (var i = 0; i < mailbox.messages.length; i++) {
            var msg = mailbox.messages[i];
            if (!msg.claimedAt && msg.reward) {
                var reward = RewardEngine.resolveReward(nk, msg.reward);
                RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
                msg.claimedAt = now;
                msg.readAt = msg.readAt || now;
                claimed++;
            }
        }
        saveUserMailbox(nk, userId, mailbox, data.gameId);
        return RpcHelpers.successResponse({ claimed: claimed });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_mailbox_list", rpcList);
        initializer.registerRpc("hiro_mailbox_claim", rpcClaim);
        initializer.registerRpc("hiro_mailbox_claim_all", rpcClaimAll);
        initializer.registerRpc("hiro_mailbox_delete", rpcDelete);
    }
    HiroMailbox.register = register;
})(HiroMailbox || (HiroMailbox = {}));
var HiroPersonalizers;
(function (HiroPersonalizers) {
    var OVERRIDES_COLLECTION = "hiro_personalizer_overrides";
    function deepClone(obj) {
        if (obj === null || typeof obj !== "object")
            return obj;
        if (Array.isArray(obj)) {
            var arr = [];
            for (var i = 0; i < obj.length; i++)
                arr.push(deepClone(obj[i]));
            return arr;
        }
        var clone = {};
        for (var key in obj) {
            if (obj.hasOwnProperty(key))
                clone[key] = deepClone(obj[key]);
        }
        return clone;
    }
    function setNestedValue(obj, path, value) {
        var parts = path.split(".");
        var current = obj;
        for (var i = 0; i < parts.length - 1; i++) {
            if (current[parts[i]] === undefined || current[parts[i]] === null) {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
    }
    function mergeDeep(target, source) {
        if (!source || typeof source !== "object")
            return target;
        for (var key in source) {
            if (!source.hasOwnProperty(key))
                continue;
            if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key]) &&
                target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
                mergeDeep(target[key], source[key]);
            }
            else {
                target[key] = deepClone(source[key]);
            }
        }
        return target;
    }
    // ---- Storage Personalizer ----
    function applyStorageOverrides(nk, userId, system, config, gameId) {
        var data = Storage.readJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(gameId, "overrides"), userId);
        if (!data || !data.overrides || !data.overrides[system])
            return config;
        var overrides = data.overrides[system];
        for (var i = 0; i < overrides.length; i++) {
            setNestedValue(config, overrides[i].path, overrides[i].value);
        }
        return config;
    }
    // ---- Satori Personalizer (feature flags + experiments) ----
    function applySatoriOverrides(nk, userId, system, config) {
        // Check feature flags for config overrides
        var flagName = "hiro_" + system + "_override";
        var flag = SatoriFeatureFlags.getFlag(nk, userId, flagName);
        if (flag && flag.value) {
            try {
                var flagOverrides = JSON.parse(flag.value);
                config = mergeDeep(config, flagOverrides);
            }
            catch (_) { }
        }
        // Check experiment variants for config overrides
        var experiments = ConfigLoader.loadSatoriConfig(nk, "experiments", {});
        for (var expId in experiments) {
            var exp = experiments[expId];
            if (exp.status !== "running")
                continue;
            if (!exp.configSystem || exp.configSystem !== system)
                continue;
            var variant = SatoriExperiments.getVariant(nk, userId, expId);
            if (variant && variant.config) {
                try {
                    var variantOverrides = {};
                    for (var key in variant.config) {
                        try {
                            variantOverrides[key] = JSON.parse(variant.config[key]);
                        }
                        catch (_) {
                            variantOverrides[key] = variant.config[key];
                        }
                    }
                    config = mergeDeep(config, variantOverrides);
                }
                catch (_) { }
            }
        }
        return config;
    }
    // ---- Public API ----
    function personalize(nk, userId, system, baseConfig, gameId) {
        var config = deepClone(baseConfig);
        config = applyStorageOverrides(nk, userId, system, config, gameId);
        config = applySatoriOverrides(nk, userId, system, config);
        return config;
    }
    HiroPersonalizers.personalize = personalize;
    function personalizeConfig(nk, userId, system, loader, gameId) {
        var base = loader();
        return personalize(nk, userId, system, base, gameId);
    }
    HiroPersonalizers.personalizeConfig = personalizeConfig;
    // ---- Admin RPCs ----
    function rpcSetOverride(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.system || !data.path) {
            return RpcHelpers.errorResponse("userId, system, and path required");
        }
        var userOverrides = Storage.readJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId);
        if (!userOverrides)
            userOverrides = { overrides: {}, updatedAt: 0 };
        if (!userOverrides.overrides[data.system])
            userOverrides.overrides[data.system] = [];
        var existing = false;
        for (var i = 0; i < userOverrides.overrides[data.system].length; i++) {
            if (userOverrides.overrides[data.system][i].path === data.path) {
                userOverrides.overrides[data.system][i].value = data.value;
                existing = true;
                break;
            }
        }
        if (!existing) {
            userOverrides.overrides[data.system].push({ path: data.path, value: data.value });
        }
        userOverrides.updatedAt = Math.floor(Date.now() / 1000);
        Storage.writeJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId, userOverrides);
        return RpcHelpers.successResponse({ saved: true, system: data.system, path: data.path });
    }
    function rpcRemoveOverride(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.system || !data.path) {
            return RpcHelpers.errorResponse("userId, system, and path required");
        }
        var userOverrides = Storage.readJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId);
        if (!userOverrides || !userOverrides.overrides[data.system]) {
            return RpcHelpers.successResponse({ removed: false });
        }
        userOverrides.overrides[data.system] = userOverrides.overrides[data.system].filter(function (o) {
            return o.path !== data.path;
        });
        userOverrides.updatedAt = Math.floor(Date.now() / 1000);
        Storage.writeJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId, userOverrides);
        return RpcHelpers.successResponse({ removed: true });
    }
    function rpcGetOverrides(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId)
            return RpcHelpers.errorResponse("userId required");
        var userOverrides = Storage.readJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId);
        return RpcHelpers.successResponse({ overrides: userOverrides || { overrides: {} } });
    }
    function rpcPreviewConfig(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.system)
            return RpcHelpers.errorResponse("userId and system required");
        var base = ConfigLoader.loadConfig(nk, data.system, {});
        var personalized = personalize(nk, data.userId, data.system, base, data.gameId);
        return RpcHelpers.successResponse({ system: data.system, userId: data.userId, baseConfig: base, personalizedConfig: personalized });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_personalizer_set_override", rpcSetOverride);
        initializer.registerRpc("hiro_personalizer_remove_override", rpcRemoveOverride);
        initializer.registerRpc("hiro_personalizer_get_overrides", rpcGetOverrides);
        initializer.registerRpc("hiro_personalizer_preview", rpcPreviewConfig);
    }
    HiroPersonalizers.register = register;
})(HiroPersonalizers || (HiroPersonalizers = {}));
var HiroProgression;
(function (HiroProgression) {
    var DEFAULT_CONFIG = {
        levels: [
            { level: 1, xpRequired: 0 },
            { level: 2, xpRequired: 100 },
            { level: 3, xpRequired: 300 },
            { level: 4, xpRequired: 600 },
            { level: 5, xpRequired: 1000 }
        ],
        maxLevel: 100
    };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "progression", DEFAULT_CONFIG);
    }
    HiroProgression.getConfig = getConfig;
    function getUserProgression(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_PROGRESSION_COLLECTION, Constants.gameKey(gameId, "state"), userId);
        return data || { xp: 0, level: 1, totalXpEarned: 0 };
    }
    HiroProgression.getUserProgression = getUserProgression;
    function saveUserProgression(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_PROGRESSION_COLLECTION, Constants.gameKey(gameId, "state"), userId, data);
    }
    function getLevelForXp(config, xp) {
        var level = 1;
        for (var i = 0; i < config.levels.length; i++) {
            if (xp >= config.levels[i].xpRequired) {
                level = config.levels[i].level;
            }
            else {
                break;
            }
        }
        return Math.min(level, config.maxLevel);
    }
    function addXp(nk, logger, ctx, userId, amount, gameId) {
        var config = getConfig(nk);
        var state = getUserProgression(nk, userId, gameId);
        var oldLevel = state.level;
        state.xp += amount;
        state.totalXpEarned += amount;
        state.level = getLevelForXp(config, state.xp);
        EventBus.emit(nk, logger, ctx, EventBus.Events.XP_EARNED, {
            userId: userId, amount: amount, totalXp: state.xp, level: state.level
        });
        // Grant level-up rewards
        if (state.level > oldLevel) {
            for (var l = oldLevel + 1; l <= state.level; l++) {
                var levelConfig = config.levels.find(function (lc) { return lc.level === l; });
                if (levelConfig && levelConfig.reward) {
                    var resolved = RewardEngine.resolveReward(nk, levelConfig.reward);
                    RewardEngine.grantReward(nk, logger, ctx, userId, gameId || "default", resolved);
                }
                EventBus.emit(nk, logger, ctx, EventBus.Events.LEVEL_UP, {
                    userId: userId, newLevel: l, previousLevel: l - 1
                });
            }
        }
        saveUserProgression(nk, userId, state, gameId);
        return state;
    }
    HiroProgression.addXp = addXp;
    function getXpToNextLevel(nk, userId, gameId) {
        var config = getConfig(nk);
        var state = getUserProgression(nk, userId, gameId);
        var nextLevel = config.levels.find(function (lc) { return lc.level === state.level + 1; });
        var required = nextLevel ? nextLevel.xpRequired : state.xp;
        return {
            current: state.xp,
            required: required,
            remaining: Math.max(0, required - state.xp)
        };
    }
    HiroProgression.getXpToNextLevel = getXpToNextLevel;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId;
        var state = getUserProgression(nk, userId, gameId);
        var xpInfo = getXpToNextLevel(nk, userId, gameId);
        return RpcHelpers.successResponse({ progression: state, nextLevel: xpInfo });
    }
    function rpcAddXp(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.amount || data.amount <= 0)
            return RpcHelpers.errorResponse("Positive amount required");
        var state = addXp(nk, logger, ctx, userId, data.amount, data.gameId);
        var xpInfo = getXpToNextLevel(nk, userId, data.gameId);
        return RpcHelpers.successResponse({ progression: state, nextLevel: xpInfo });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_progression_get", rpcGet);
        initializer.registerRpc("hiro_progression_add_xp", rpcAddXp);
    }
    HiroProgression.register = register;
})(HiroProgression || (HiroProgression = {}));
var HiroRewardBucket;
(function (HiroRewardBucket) {
    var BUCKET_COLLECTION = "hiro_reward_buckets";
    var DEFAULT_CONFIG = { buckets: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "reward_buckets", DEFAULT_CONFIG);
    }
    function getUserBuckets(nk, userId, gameId) {
        var data = Storage.readJson(nk, BUCKET_COLLECTION, Constants.gameKey(gameId, "state"), userId);
        return data || { buckets: {} };
    }
    function saveUserBuckets(nk, userId, data, gameId) {
        Storage.writeJson(nk, BUCKET_COLLECTION, Constants.gameKey(gameId, "state"), userId, data);
    }
    function addProgress(nk, logger, ctx, userId, bucketId, amount, gameId) {
        var config = getConfig(nk);
        var def = config.buckets[bucketId];
        if (!def)
            return;
        var userBuckets = getUserBuckets(nk, userId, gameId);
        if (!userBuckets.buckets[bucketId]) {
            userBuckets.buckets[bucketId] = { progress: 0, unlockedTiers: [], totalUnlocks: 0 };
        }
        var state = userBuckets.buckets[bucketId];
        state.progress = Math.min(state.progress + amount, def.maxProgress);
        saveUserBuckets(nk, userId, userBuckets, gameId);
    }
    HiroRewardBucket.addProgress = addProgress;
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        var userBuckets = getUserBuckets(nk, userId, data.gameId);
        var result = [];
        for (var id in config.buckets) {
            var def = config.buckets[id];
            var state = userBuckets.buckets[id] || { progress: 0, unlockedTiers: [], totalUnlocks: 0 };
            var tiers = [];
            for (var i = 0; i < def.tiers.length; i++) {
                tiers.push({
                    index: i,
                    progressRequired: def.tiers[i].progressRequired,
                    unlocked: state.unlockedTiers.indexOf(i) >= 0,
                    reachable: state.progress >= def.tiers[i].progressRequired
                });
            }
            result.push({
                id: id,
                name: def.name,
                description: def.description,
                progress: state.progress,
                maxProgress: def.maxProgress,
                tiers: tiers,
                unlockCost: def.unlockCost,
                totalUnlocks: state.totalUnlocks,
                additionalProperties: def.additionalProperties
            });
        }
        return RpcHelpers.successResponse({ buckets: result });
    }
    function rpcProgress(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.bucketId || !data.amount)
            return RpcHelpers.errorResponse("bucketId and amount required");
        addProgress(nk, logger, ctx, userId, data.bucketId, data.amount, data.gameId);
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcUnlock(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.bucketId)
            return RpcHelpers.errorResponse("bucketId required");
        var tierIndex = data.tierIndex !== undefined ? data.tierIndex : -1;
        var config = getConfig(nk);
        var def = config.buckets[data.bucketId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown bucket");
        var userBuckets = getUserBuckets(nk, userId, data.gameId);
        var state = userBuckets.buckets[data.bucketId];
        if (!state)
            return RpcHelpers.errorResponse("No progress in this bucket");
        if (tierIndex < 0 || tierIndex >= def.tiers.length)
            return RpcHelpers.errorResponse("Invalid tier index");
        if (state.unlockedTiers.indexOf(tierIndex) >= 0)
            return RpcHelpers.errorResponse("Tier already unlocked");
        if (state.progress < def.tiers[tierIndex].progressRequired)
            return RpcHelpers.errorResponse("Insufficient progress");
        if (def.unlockCost) {
            for (var cid in def.unlockCost) {
                WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, def.unlockCost[cid]);
            }
        }
        var resolved = RewardEngine.resolveReward(nk, def.tiers[tierIndex].reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
        state.unlockedTiers.push(tierIndex);
        state.lastUnlockedAt = Math.floor(Date.now() / 1000);
        state.totalUnlocks++;
        if (def.resetOnUnlock && state.unlockedTiers.length >= def.tiers.length) {
            state.progress = 0;
            state.unlockedTiers = [];
        }
        saveUserBuckets(nk, userId, userBuckets, data.gameId);
        return RpcHelpers.successResponse({ reward: resolved, state: state });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_reward_bucket_get", rpcGet);
        initializer.registerRpc("hiro_reward_bucket_progress", rpcProgress);
        initializer.registerRpc("hiro_reward_bucket_unlock", rpcUnlock);
    }
    HiroRewardBucket.register = register;
    function registerEventHandlers() {
        EventBus.on(EventBus.Events.GAME_COMPLETED, function (nk, logger, ctx, data) {
            var config = getConfig(nk);
            for (var id in config.buckets) {
                addProgress(nk, logger, ctx, data.userId, id, 1);
            }
        });
        EventBus.on(EventBus.Events.STORE_PURCHASE, function (nk, logger, ctx, data) {
            var config = getConfig(nk);
            for (var id in config.buckets) {
                addProgress(nk, logger, ctx, data.userId, id, 5);
            }
        });
    }
    HiroRewardBucket.registerEventHandlers = registerEventHandlers;
})(HiroRewardBucket || (HiroRewardBucket = {}));
var HiroStats;
(function (HiroStats) {
    var DEFAULT_CONFIG = { stats: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "stats", DEFAULT_CONFIG);
    }
    HiroStats.getConfig = getConfig;
    function getUserStats(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_STATS_COLLECTION, Constants.gameKey(gameId, "values"), userId);
        if (data)
            return data;
        var config = getConfig(nk);
        var stats = {};
        for (var id in config.stats) {
            stats[id] = config.stats[id].defaultValue || 0;
        }
        return { stats: stats };
    }
    function saveUserStats(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_STATS_COLLECTION, Constants.gameKey(gameId, "values"), userId, data);
    }
    function updateStat(nk, logger, ctx, userId, statId, value, gameId) {
        var config = getConfig(nk);
        var def = config.stats[statId];
        var userStats = getUserStats(nk, userId, gameId);
        var current = userStats.stats[statId] || 0;
        var aggregation = (def && def.aggregation) || "sum";
        switch (aggregation) {
            case "sum":
                current += value;
                break;
            case "max":
                current = Math.max(current, value);
                break;
            case "min":
                current = Math.min(current, value);
                break;
            case "latest":
                current = value;
                break;
        }
        if (def && def.maxValue !== undefined) {
            current = Math.min(current, def.maxValue);
        }
        userStats.stats[statId] = current;
        saveUserStats(nk, userId, userStats, gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.STAT_UPDATED, {
            userId: userId, statId: statId, value: current, delta: value
        });
        return current;
    }
    HiroStats.updateStat = updateStat;
    function getStat(nk, userId, statId, gameId) {
        var userStats = getUserStats(nk, userId, gameId);
        return userStats.stats[statId] || 0;
    }
    HiroStats.getStat = getStat;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId;
        var userStats = getUserStats(nk, userId, gameId);
        var config = getConfig(nk);
        if (data.publicOnly) {
            var publicStats = {};
            for (var id in userStats.stats) {
                if (config.stats[id] && config.stats[id].isPublic) {
                    publicStats[id] = userStats.stats[id];
                }
            }
            return RpcHelpers.successResponse({ stats: publicStats });
        }
        return RpcHelpers.successResponse({ stats: userStats.stats });
    }
    function rpcUpdate(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.statId)
            return RpcHelpers.errorResponse("statId required");
        var newVal = updateStat(nk, logger, ctx, userId, data.statId, data.value || 1, data.gameId);
        return RpcHelpers.successResponse({ statId: data.statId, value: newVal });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_stats_get", rpcGet);
        initializer.registerRpc("hiro_stats_update", rpcUpdate);
    }
    HiroStats.register = register;
})(HiroStats || (HiroStats = {}));
var HiroStore;
(function (HiroStore) {
    var DEFAULT_CONFIG = { sections: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "store", DEFAULT_CONFIG);
    }
    HiroStore.getConfig = getConfig;
    function getUserPurchases(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "store_purchases_" + userId), userId);
        return data || { purchases: {} };
    }
    function saveUserPurchases(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "store_purchases_" + userId), userId, data);
    }
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        var purchases = getUserPurchases(nk, userId, data.gameId);
        var now = Math.floor(Date.now() / 1000);
        var result = {};
        for (var sectionId in config.sections) {
            var section = config.sections[sectionId];
            var items = [];
            for (var offerId in section.items) {
                var offer = section.items[offerId];
                if (offer.availableAt && now < offer.availableAt)
                    continue;
                if (offer.expiresAt && now > offer.expiresAt)
                    continue;
                var purchaseCount = purchases.purchases[offerId] ? purchases.purchases[offerId].count : 0;
                var available = !offer.maxPurchases || purchaseCount < offer.maxPurchases;
                items.push({
                    id: offerId,
                    name: offer.name,
                    description: offer.description,
                    cost: offer.cost,
                    available: available,
                    purchaseCount: purchaseCount,
                    maxPurchases: offer.maxPurchases,
                    expiresAt: offer.expiresAt,
                    additionalProperties: offer.additionalProperties
                });
            }
            result[sectionId] = { name: section.name, items: items };
        }
        return RpcHelpers.successResponse({ sections: result });
    }
    function rpcPurchase(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.offerId)
            return RpcHelpers.errorResponse("offerId required");
        var config = getConfig(nk);
        var offer = null;
        for (var sectionId in config.sections) {
            if (config.sections[sectionId].items[data.offerId]) {
                offer = config.sections[sectionId].items[data.offerId];
                break;
            }
        }
        if (!offer)
            return RpcHelpers.errorResponse("Unknown offer");
        var now = Math.floor(Date.now() / 1000);
        if (offer.availableAt && now < offer.availableAt)
            return RpcHelpers.errorResponse("Offer not yet available");
        if (offer.expiresAt && now > offer.expiresAt)
            return RpcHelpers.errorResponse("Offer expired");
        var purchases = getUserPurchases(nk, userId, data.gameId);
        var purchaseCount = purchases.purchases[data.offerId] ? purchases.purchases[data.offerId].count : 0;
        if (offer.maxPurchases && purchaseCount >= offer.maxPurchases)
            return RpcHelpers.errorResponse("Max purchases reached");
        if (offer.cost && offer.cost.currencies) {
            for (var cid in offer.cost.currencies) {
                WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, offer.cost.currencies[cid]);
            }
        }
        var resolved = RewardEngine.resolveReward(nk, offer.reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
        if (!purchases.purchases[data.offerId]) {
            purchases.purchases[data.offerId] = { count: 0, lastPurchaseAt: 0 };
        }
        purchases.purchases[data.offerId].count++;
        purchases.purchases[data.offerId].lastPurchaseAt = now;
        saveUserPurchases(nk, userId, purchases, data.gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.STORE_PURCHASE, {
            userId: userId, offerId: data.offerId, reward: resolved
        });
        return RpcHelpers.successResponse({ reward: resolved });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_store_list", rpcList);
        initializer.registerRpc("hiro_store_purchase", rpcPurchase);
    }
    HiroStore.register = register;
})(HiroStore || (HiroStore = {}));
var HiroStreaks;
(function (HiroStreaks) {
    var DEFAULT_CONFIG = { streaks: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "streaks", DEFAULT_CONFIG);
    }
    HiroStreaks.getConfig = getConfig;
    function getUserStreaks(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_STREAKS_COLLECTION, Constants.gameKey(gameId, "state"), userId);
        return data || { streaks: {} };
    }
    function saveUserStreaks(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_STREAKS_COLLECTION, Constants.gameKey(gameId, "state"), userId, data);
    }
    function updateStreak(nk, logger, ctx, userId, streakId, gameId) {
        var config = getConfig(nk);
        var def = config.streaks[streakId];
        if (!def)
            throw new Error("Unknown streak: " + streakId);
        var streaks = getUserStreaks(nk, userId, gameId);
        var state = streaks.streaks[streakId];
        var now = Math.floor(Date.now() / 1000);
        if (!state) {
            state = { count: 0, lastUpdateAt: 0, claimedMilestones: [] };
        }
        var elapsed = now - state.lastUpdateAt;
        var gracePeriod = def.gracePeriodSec || 0;
        if (state.lastUpdateAt > 0 && elapsed > def.resetIntervalSec + gracePeriod) {
            EventBus.emit(nk, logger, ctx, EventBus.Events.STREAK_BROKEN, {
                userId: userId, streakId: streakId, count: state.count
            });
            state.count = 0;
            state.claimedMilestones = [];
        }
        if (elapsed >= def.resetIntervalSec || state.lastUpdateAt === 0) {
            state.count++;
            state.lastUpdateAt = now;
            EventBus.emit(nk, logger, ctx, EventBus.Events.STREAK_UPDATED, {
                userId: userId, streakId: streakId, count: state.count
            });
        }
        streaks.streaks[streakId] = state;
        saveUserStreaks(nk, userId, streaks, gameId);
        return state;
    }
    HiroStreaks.updateStreak = updateStreak;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId;
        var config = getConfig(nk);
        var streaks = getUserStreaks(nk, userId, gameId);
        var result = {};
        for (var id in config.streaks) {
            var def = config.streaks[id];
            var state = streaks.streaks[id] || { count: 0, lastUpdateAt: 0, claimedMilestones: [] };
            var milestones = [];
            for (var count in def.milestones) {
                milestones.push({
                    count: parseInt(count),
                    claimed: state.claimedMilestones.indexOf(count) >= 0,
                    reachable: state.count >= parseInt(count)
                });
            }
            result[id] = { name: def.name, count: state.count, lastUpdateAt: state.lastUpdateAt, milestones: milestones };
        }
        return RpcHelpers.successResponse({ streaks: result });
    }
    function rpcUpdate(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.streakId)
            return RpcHelpers.errorResponse("streakId required");
        var state = updateStreak(nk, logger, ctx, userId, data.streakId, data.gameId);
        return RpcHelpers.successResponse({ streak: state });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.streakId || !data.milestone)
            return RpcHelpers.errorResponse("streakId and milestone required");
        var config = getConfig(nk);
        var def = config.streaks[data.streakId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown streak");
        var milestone = String(data.milestone);
        var reward = def.milestones[milestone];
        if (!reward)
            return RpcHelpers.errorResponse("Unknown milestone");
        var streaks = getUserStreaks(nk, userId, data.gameId);
        var state = streaks.streaks[data.streakId];
        if (!state || state.count < parseInt(milestone))
            return RpcHelpers.errorResponse("Milestone not reached");
        if (state.claimedMilestones.indexOf(milestone) >= 0)
            return RpcHelpers.errorResponse("Already claimed");
        var resolved = RewardEngine.resolveReward(nk, reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
        state.claimedMilestones.push(milestone);
        streaks.streaks[data.streakId] = state;
        saveUserStreaks(nk, userId, streaks, data.gameId);
        return RpcHelpers.successResponse({ reward: resolved });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_streaks_get", rpcGet);
        initializer.registerRpc("hiro_streaks_update", rpcUpdate);
        initializer.registerRpc("hiro_streaks_claim", rpcClaim);
    }
    HiroStreaks.register = register;
})(HiroStreaks || (HiroStreaks = {}));
var HiroTeams;
(function (HiroTeams) {
    function getTeamData(nk, groupId) {
        var data = Storage.readSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, "team_" + groupId);
        return data || { groupId: groupId, stats: {}, wallet: {}, achievements: {} };
    }
    function saveTeamData(nk, data) {
        Storage.writeSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, "team_" + data.groupId, data);
    }
    function rpcGet(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.groupId)
            return RpcHelpers.errorResponse("groupId required");
        var teamData = getTeamData(nk, data.groupId);
        return RpcHelpers.successResponse({ team: teamData });
    }
    function rpcUpdateStats(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.groupId || !data.statId)
            return RpcHelpers.errorResponse("groupId and statId required");
        var teamData = getTeamData(nk, data.groupId);
        var current = teamData.stats[data.statId] || 0;
        teamData.stats[data.statId] = current + (data.value || 1);
        saveTeamData(nk, teamData);
        return RpcHelpers.successResponse({ statId: data.statId, value: teamData.stats[data.statId] });
    }
    function rpcGetWallet(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.groupId)
            return RpcHelpers.errorResponse("groupId required");
        var teamData = getTeamData(nk, data.groupId);
        return RpcHelpers.successResponse({ wallet: teamData.wallet });
    }
    function rpcUpdateWallet(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.groupId || !data.currencyId || data.amount === undefined) {
            return RpcHelpers.errorResponse("groupId, currencyId, and amount required");
        }
        var teamData = getTeamData(nk, data.groupId);
        var current = teamData.wallet[data.currencyId] || 0;
        var newBalance = current + data.amount;
        if (newBalance < 0)
            return RpcHelpers.errorResponse("Insufficient team funds");
        teamData.wallet[data.currencyId] = newBalance;
        saveTeamData(nk, teamData);
        return RpcHelpers.successResponse({ currencyId: data.currencyId, balance: newBalance });
    }
    function rpcAchievements(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.groupId)
            return RpcHelpers.errorResponse("groupId required");
        var teamData = getTeamData(nk, data.groupId);
        return RpcHelpers.successResponse({ achievements: teamData.achievements });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_teams_get", rpcGet);
        initializer.registerRpc("hiro_teams_stats", rpcUpdateStats);
        initializer.registerRpc("hiro_teams_wallet_get", rpcGetWallet);
        initializer.registerRpc("hiro_teams_wallet_update", rpcUpdateWallet);
        initializer.registerRpc("hiro_teams_achievements", rpcAchievements);
    }
    HiroTeams.register = register;
})(HiroTeams || (HiroTeams = {}));
var HiroTutorials;
(function (HiroTutorials) {
    var DEFAULT_CONFIG = { tutorials: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "tutorials", DEFAULT_CONFIG);
    }
    HiroTutorials.getConfig = getConfig;
    function getUserTutorials(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_TUTORIALS_COLLECTION, Constants.gameKey(gameId, "progress"), userId);
        return data || { tutorials: {} };
    }
    function saveUserTutorials(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_TUTORIALS_COLLECTION, Constants.gameKey(gameId, "progress"), userId, data);
    }
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        var progress = getUserTutorials(nk, userId, data.gameId);
        var result = {};
        for (var id in config.tutorials) {
            var def = config.tutorials[id];
            var state = progress.tutorials[id] || { step: 0 };
            result[id] = {
                name: def.name,
                totalSteps: def.steps.length,
                currentStep: state.step,
                completed: !!state.completedAt,
                steps: def.steps.map(function (s, i) {
                    return { id: s.id, name: s.name, completed: i < state.step };
                })
            };
        }
        return RpcHelpers.successResponse({ tutorials: result });
    }
    function rpcAdvance(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.tutorialId)
            return RpcHelpers.errorResponse("tutorialId required");
        var config = getConfig(nk);
        var def = config.tutorials[data.tutorialId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown tutorial");
        var progress = getUserTutorials(nk, userId, data.gameId);
        var state = progress.tutorials[data.tutorialId] || { step: 0 };
        if (state.completedAt)
            return RpcHelpers.errorResponse("Tutorial already completed");
        if (state.step < def.steps.length) {
            var stepDef = def.steps[state.step];
            if (stepDef.reward) {
                var resolved = RewardEngine.resolveReward(nk, stepDef.reward);
                RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
            }
            state.step++;
        }
        if (state.step >= def.steps.length) {
            state.completedAt = Math.floor(Date.now() / 1000);
            if (def.reward) {
                var finalResolved = RewardEngine.resolveReward(nk, def.reward);
                RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", finalResolved);
            }
        }
        progress.tutorials[data.tutorialId] = state;
        saveUserTutorials(nk, userId, progress, data.gameId);
        return RpcHelpers.successResponse({ tutorial: state });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_tutorials_get", rpcGet);
        initializer.registerRpc("hiro_tutorials_advance", rpcAdvance);
    }
    HiroTutorials.register = register;
})(HiroTutorials || (HiroTutorials = {}));
var HiroUnlockables;
(function (HiroUnlockables) {
    var DEFAULT_CONFIG = { unlockables: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "unlockables", DEFAULT_CONFIG);
    }
    HiroUnlockables.getConfig = getConfig;
    function getUserState(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_UNLOCKABLES_COLLECTION, Constants.gameKey(gameId, "state"), userId);
        return data || { activeSlots: {}, totalSlots: 1 };
    }
    function saveUserState(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_UNLOCKABLES_COLLECTION, Constants.gameKey(gameId, "state"), userId, data);
    }
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var state = getUserState(nk, userId, data.gameId);
        var config = getConfig(nk);
        var now = Math.floor(Date.now() / 1000);
        var slots = [];
        for (var slotId in state.activeSlots) {
            var slot = state.activeSlots[slotId];
            slots.push({
                slotId: slotId,
                unlockableId: slot.unlockableId,
                startedAt: slot.startedAt,
                completesAt: slot.completesAt,
                ready: now >= slot.completesAt,
                claimed: !!slot.claimedAt
            });
        }
        return RpcHelpers.successResponse({ slots: slots, totalSlots: state.totalSlots, availableUnlockables: Object.keys(config.unlockables) });
    }
    function rpcStart(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.unlockableId)
            return RpcHelpers.errorResponse("unlockableId required");
        var config = getConfig(nk);
        var def = config.unlockables[data.unlockableId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown unlockable");
        var state = getUserState(nk, userId, data.gameId);
        var activeCount = Object.keys(state.activeSlots).length;
        if (activeCount >= state.totalSlots)
            return RpcHelpers.errorResponse("No free slots");
        var now = Math.floor(Date.now() / 1000);
        var slotId = nk.uuidv4();
        state.activeSlots[slotId] = {
            unlockableId: data.unlockableId,
            startedAt: now,
            completesAt: now + def.waitTimeSec
        };
        saveUserState(nk, userId, state, data.gameId);
        return RpcHelpers.successResponse({ slotId: slotId });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.slotId)
            return RpcHelpers.errorResponse("slotId required");
        var state = getUserState(nk, userId, data.gameId);
        var slot = state.activeSlots[data.slotId];
        if (!slot)
            return RpcHelpers.errorResponse("Slot not found");
        if (slot.claimedAt)
            return RpcHelpers.errorResponse("Already claimed");
        var now = Math.floor(Date.now() / 1000);
        if (now < slot.completesAt)
            return RpcHelpers.errorResponse("Not ready yet");
        var config = getConfig(nk);
        var def = config.unlockables[slot.unlockableId];
        var reward = null;
        if (def && def.reward) {
            reward = RewardEngine.resolveReward(nk, def.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
        }
        slot.claimedAt = now;
        delete state.activeSlots[data.slotId];
        saveUserState(nk, userId, state, data.gameId);
        return RpcHelpers.successResponse({ reward: reward });
    }
    function rpcBuySlot(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.unlockableId)
            return RpcHelpers.errorResponse("unlockableId required");
        var config = getConfig(nk);
        var def = config.unlockables[data.unlockableId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown unlockable");
        var state = getUserState(nk, userId, data.gameId);
        if (state.totalSlots >= (def.maxSlots || 4))
            return RpcHelpers.errorResponse("Max slots reached");
        if (def.slotCost && def.slotCost.currencies) {
            for (var cid in def.slotCost.currencies) {
                WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, def.slotCost.currencies[cid]);
            }
        }
        state.totalSlots++;
        saveUserState(nk, userId, state, data.gameId);
        return RpcHelpers.successResponse({ totalSlots: state.totalSlots });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_unlockables_get", rpcGet);
        initializer.registerRpc("hiro_unlockables_start", rpcStart);
        initializer.registerRpc("hiro_unlockables_claim", rpcClaim);
        initializer.registerRpc("hiro_unlockables_buy_slot", rpcBuySlot);
    }
    HiroUnlockables.register = register;
})(HiroUnlockables || (HiroUnlockables = {}));
var LegacyAnalyticsRetention;
(function (LegacyAnalyticsRetention) {
    function readAggStorage(nk, collection, key) {
        try {
            var recs = nk.storageRead([{ collection: collection, key: key, userId: Constants.SYSTEM_USER_ID }]);
            if (recs && recs.length > 0)
                return recs[0].value;
        }
        catch (_) { }
        return null;
    }
    function writeAggStorage(nk, collection, key, value) {
        nk.storageWrite([{
                collection: collection, key: key, userId: Constants.SYSTEM_USER_ID,
                value: value, permissionRead: 0, permissionWrite: 0
            }]);
    }
    function rpcCohortRetention(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId || null;
        var daysBack = parseInt(data.daysBack, 10) || 60;
        var now = Date.now();
        var cohorts = [];
        for (var d = 0; d < daysBack; d++) {
            var cohortDay = new Date(now - d * 86400000);
            var cohortKey = cohortDay.toISOString().split("T")[0];
            var dauKey = gameId ? "dau_" + gameId + "_" + cohortKey : "dau_platform_" + cohortKey;
            var dauData = readAggStorage(nk, "analytics_dau", dauKey);
            if (dauData && dauData.uniqueUsers) {
                cohorts.push({ date: cohortKey, dau: dauData.uniqueUsers.length || 0, newUsers: dauData.newUsers || 0 });
            }
        }
        var retentionData = readAggStorage(nk, "analytics_retention_agg", "retention_counters") || {};
        var total = retentionData.totalSignups || 0;
        return RpcHelpers.successResponse({
            cohorts: cohorts,
            retention: {
                totalSignups: total,
                d1Returns: retentionData.d1Returns || 0,
                d7Returns: retentionData.d7Returns || 0,
                d30Returns: retentionData.d30Returns || 0,
                d1Rate: total > 0 ? ((retentionData.d1Returns || 0) / total * 100).toFixed(1) + "%" : "0%",
                d7Rate: total > 0 ? ((retentionData.d7Returns || 0) / total * 100).toFixed(1) + "%" : "0%",
                d30Rate: total > 0 ? ((retentionData.d30Returns || 0) / total * 100).toFixed(1) + "%" : "0%"
            },
            gameId: gameId, daysBack: daysBack
        });
    }
    function rpcTrackRetentionEvent(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var eventType = data.eventType || "session";
        var counters = readAggStorage(nk, "analytics_retention_agg", "retention_counters") || {
            totalSignups: 0, d1Returns: 0, d7Returns: 0, d30Returns: 0
        };
        if (eventType === "signup")
            counters.totalSignups = (counters.totalSignups || 0) + 1;
        else if (eventType === "d1_return")
            counters.d1Returns = (counters.d1Returns || 0) + 1;
        else if (eventType === "d7_return")
            counters.d7Returns = (counters.d7Returns || 0) + 1;
        else if (eventType === "d30_return")
            counters.d30Returns = (counters.d30Returns || 0) + 1;
        writeAggStorage(nk, "analytics_retention_agg", "retention_counters", counters);
        var today = new Date().toISOString().split("T")[0];
        var platformDauKey = "dau_platform_" + today;
        var platformDau = readAggStorage(nk, "analytics_dau", platformDauKey) || { uniqueUsers: [], count: 0, newUsers: 0 };
        if (platformDau.uniqueUsers.indexOf(userId) === -1) {
            platformDau.uniqueUsers.push(userId);
            platformDau.count = platformDau.uniqueUsers.length;
            if (eventType === "signup")
                platformDau.newUsers = (platformDau.newUsers || 0) + 1;
            writeAggStorage(nk, "analytics_dau", platformDauKey, platformDau);
        }
        return RpcHelpers.successResponse({ eventType: eventType });
    }
    function rpcArpu(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        var period = data.period || "30d";
        var gameId = data.gameId || null;
        var daysBack = period === "7d" ? 7 : period === "90d" ? 90 : 30;
        var now = Date.now();
        var totalRevenue = 0;
        var totalPurchases = 0;
        var uniquePayingUsers = [];
        var totalActiveUsers = 0;
        for (var d = 0; d < daysBack; d++) {
            var dayStr = new Date(now - d * 86400000).toISOString().split("T")[0];
            var revData = readAggStorage(nk, "analytics_revenue", "revenue_" + dayStr);
            if (revData) {
                totalRevenue += revData.totalAmount || 0;
                totalPurchases += revData.purchaseCount || 0;
                if (revData.payingUsers) {
                    for (var i = 0; i < revData.payingUsers.length; i++) {
                        if (uniquePayingUsers.indexOf(revData.payingUsers[i]) === -1)
                            uniquePayingUsers.push(revData.payingUsers[i]);
                    }
                }
            }
            var dauKey = gameId ? "dau_" + gameId + "_" + dayStr : "dau_platform_" + dayStr;
            var dauData = readAggStorage(nk, "analytics_dau", dauKey);
            if (dauData && dauData.count)
                totalActiveUsers += dauData.count;
        }
        var avgDau = daysBack > 0 ? Math.round(totalActiveUsers / daysBack) : 0;
        var arpu = avgDau > 0 ? (totalRevenue / avgDau).toFixed(2) : "0.00";
        var arppu = uniquePayingUsers.length > 0 ? (totalRevenue / uniquePayingUsers.length).toFixed(2) : "0.00";
        return RpcHelpers.successResponse({
            period: period, daysBack: daysBack, totalRevenue: totalRevenue,
            totalPurchases: totalPurchases, uniquePayingUsers: uniquePayingUsers.length,
            avgDau: avgDau, arpu: parseFloat(arpu), arppu: parseFloat(arppu),
            conversionRate: avgDau > 0 ? ((uniquePayingUsers.length / avgDau) * 100).toFixed(2) + "%" : "0%",
            gameId: gameId
        });
    }
    function rpcTrackRevenue(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var amount = parseFloat(data.amount) || 0;
        var currency = data.currency || "USD";
        var productId = data.productId || "unknown";
        if (amount <= 0)
            return RpcHelpers.errorResponse("amount must be > 0");
        var today = new Date().toISOString().split("T")[0];
        var revenueKey = "revenue_" + today;
        var revData = readAggStorage(nk, "analytics_revenue", revenueKey) || {
            totalAmount: 0, purchaseCount: 0, payingUsers: [], transactions: []
        };
        revData.totalAmount = (revData.totalAmount || 0) + amount;
        revData.purchaseCount = (revData.purchaseCount || 0) + 1;
        if (revData.payingUsers.indexOf(userId) === -1)
            revData.payingUsers.push(userId);
        revData.transactions = revData.transactions || [];
        revData.transactions.push({
            userId: userId, amount: amount, currency: currency, productId: productId,
            timestamp: new Date().toISOString()
        });
        writeAggStorage(nk, "analytics_revenue", revenueKey, revData);
        return RpcHelpers.successResponse({
            tracked: { userId: userId, amount: amount, currency: currency, productId: productId }
        });
    }
    function register(initializer) {
        initializer.registerRpc("analytics_cohort_retention", rpcCohortRetention);
        initializer.registerRpc("analytics_track_retention_event", rpcTrackRetentionEvent);
        initializer.registerRpc("analytics_arpu", rpcArpu);
        initializer.registerRpc("analytics_track_revenue", rpcTrackRevenue);
    }
    LegacyAnalyticsRetention.register = register;
})(LegacyAnalyticsRetention || (LegacyAnalyticsRetention = {}));
var LegacyAnalytics;
(function (LegacyAnalytics) {
    function rpcAnalyticsLogEvent(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var eventName = data.name || data.eventName || "unknown";
            var properties = data.properties || data.data || {};
            var timestamp = Math.floor(Date.now() / 1000);
            var key = "evt_" + timestamp + "_" + userId + "_" + nk.uuidv4().slice(0, 8);
            var record = {
                eventName: eventName,
                userId: userId,
                properties: properties,
                timestamp: timestamp,
                date: new Date().toISOString().slice(0, 10)
            };
            nk.storageWrite([{
                    collection: Constants.ANALYTICS_COLLECTION,
                    key: key,
                    userId: Constants.SYSTEM_USER_ID,
                    value: record,
                    permissionRead: 0,
                    permissionWrite: 0
                }]);
            return RpcHelpers.successResponse({ success: true, key: key });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to log event");
        }
    }
    function register(initializer) {
        initializer.registerRpc("analytics_log_event", rpcAnalyticsLogEvent);
    }
    LegacyAnalytics.register = register;
})(LegacyAnalytics || (LegacyAnalytics = {}));
var LegacyChat;
(function (LegacyChat) {
    function rpcSendGroupChatMessage(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var groupId = data.groupId;
            var content = data.content || data.message || "";
            if (!groupId)
                return RpcHelpers.errorResponse("groupId required");
            var channelId = nk.channelIdBuild(userId, groupId, 3);
            var ack = nk.channelMessageSend(channelId, { body: content }, userId, username, true);
            return RpcHelpers.successResponse({ messageId: ack.messageId });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to send group message");
        }
    }
    function rpcSendDirectMessage(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var targetUserId = data.userId || data.targetUserId;
            var content = data.content || data.message || "";
            if (!targetUserId)
                return RpcHelpers.errorResponse("userId required");
            var channelId = nk.channelIdBuild(userId, targetUserId, 2);
            var ack = nk.channelMessageSend(channelId, { body: content }, userId, username, true);
            return RpcHelpers.successResponse({ messageId: ack.messageId });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to send direct message");
        }
    }
    function rpcSendChatRoomMessage(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var roomName = data.roomName || data.room || "general";
            var content = data.content || data.message || "";
            var channelId = nk.channelIdBuild(undefined, roomName, 1);
            var ack = nk.channelMessageSend(channelId, { body: content }, userId, username, true);
            return RpcHelpers.successResponse({ messageId: ack.messageId });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to send room message");
        }
    }
    function rpcGetGroupChatHistory(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var groupId = data.groupId;
            if (!groupId)
                return RpcHelpers.errorResponse("groupId required");
            var channelId = nk.channelIdBuild(userId, groupId, 3);
            var limit = data.limit || 100;
            var forward = data.forward !== false;
            var cursor = data.cursor || "";
            var result = nk.channelMessagesList(channelId, limit, forward, cursor);
            return RpcHelpers.successResponse({
                messages: result.messages || [],
                nextCursor: result.nextCursor || "",
                prevCursor: result.prevCursor || ""
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to get group chat history");
        }
    }
    function rpcGetDirectMessageHistory(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var targetUserId = data.userId || data.targetUserId;
            if (!targetUserId)
                return RpcHelpers.errorResponse("userId required");
            var channelId = nk.channelIdBuild(userId, targetUserId, 2);
            var limit = data.limit || 100;
            var forward = data.forward !== false;
            var cursor = data.cursor || "";
            var result = nk.channelMessagesList(channelId, limit, forward, cursor);
            return RpcHelpers.successResponse({
                messages: result.messages || [],
                nextCursor: result.nextCursor || "",
                prevCursor: result.prevCursor || ""
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to get direct message history");
        }
    }
    function rpcGetChatRoomHistory(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var roomName = data.roomName || data.room || "general";
            var channelId = nk.channelIdBuild(undefined, roomName, 1);
            var limit = data.limit || 100;
            var forward = data.forward !== false;
            var cursor = data.cursor || "";
            var result = nk.channelMessagesList(channelId, limit, forward, cursor);
            return RpcHelpers.successResponse({
                messages: result.messages || [],
                nextCursor: result.nextCursor || "",
                prevCursor: result.prevCursor || ""
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to get room history");
        }
    }
    function rpcMarkDirectMessagesRead(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var targetUserId = data.userId || data.targetUserId;
            if (!targetUserId)
                return RpcHelpers.errorResponse("userId required");
            return RpcHelpers.successResponse({ success: true });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to mark messages read");
        }
    }
    function register(initializer) {
        initializer.registerRpc("send_group_chat_message", rpcSendGroupChatMessage);
        initializer.registerRpc("send_direct_message", rpcSendDirectMessage);
        initializer.registerRpc("send_chat_room_message", rpcSendChatRoomMessage);
        initializer.registerRpc("get_group_chat_history", rpcGetGroupChatHistory);
        initializer.registerRpc("get_direct_message_history", rpcGetDirectMessageHistory);
        initializer.registerRpc("get_chat_room_history", rpcGetChatRoomHistory);
        initializer.registerRpc("mark_direct_messages_read", rpcMarkDirectMessagesRead);
    }
    LegacyChat.register = register;
})(LegacyChat || (LegacyChat = {}));
var LegacyCoupons;
(function (LegacyCoupons) {
    function safeRead(nk, collection, key, userId) {
        try {
            var recs = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
            if (recs && recs.length > 0)
                return recs[0].value;
        }
        catch (_) { }
        return null;
    }
    function rpcList(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.game_id;
            if (!gameId)
                return RpcHelpers.errorResponse("game_id required");
            var records = [];
            try {
                var result = nk.storageRead([{ collection: "game_coupons", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID }]);
                if (result && result.length > 0 && result[0].value && result[0].value.coupons)
                    records = result[0].value.coupons;
            }
            catch (_) { }
            var now = Date.now();
            var active = [];
            for (var i = 0; i < records.length; i++) {
                var c = records[i];
                if (c.status !== "active")
                    continue;
                if (c.valid_from && new Date(c.valid_from).getTime() > now)
                    continue;
                if (c.valid_until && new Date(c.valid_until).getTime() < now)
                    continue;
                if (c.max_redemptions !== null && c.current_redemptions >= c.max_redemptions)
                    continue;
                active.push(c);
            }
            return RpcHelpers.successResponse({ coupons: active, total: active.length });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function rpcRedeem(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.game_id;
            var couponId = data.coupon_id;
            if (!gameId || !couponId)
                return RpcHelpers.errorResponse("game_id and coupon_id required");
            var catalogRecs = nk.storageRead([{ collection: "game_coupons", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID }]);
            if (!catalogRecs || catalogRecs.length === 0)
                return RpcHelpers.errorResponse("No coupon catalog for this game");
            var coupons = catalogRecs[0].value.coupons || [];
            var coupon = null;
            var couponIdx = -1;
            for (var i = 0; i < coupons.length; i++) {
                if (coupons[i].id === couponId) {
                    coupon = coupons[i];
                    couponIdx = i;
                    break;
                }
            }
            if (!coupon)
                return RpcHelpers.errorResponse("Coupon not found");
            if (coupon.status !== "active")
                return RpcHelpers.errorResponse("Coupon not available");
            var now = Date.now();
            if (coupon.valid_from && new Date(coupon.valid_from).getTime() > now)
                return RpcHelpers.errorResponse("Coupon not yet available");
            if (coupon.valid_until && new Date(coupon.valid_until).getTime() < now)
                return RpcHelpers.errorResponse("Coupon has expired");
            if (coupon.max_redemptions !== null && coupon.current_redemptions >= coupon.max_redemptions)
                return RpcHelpers.errorResponse("Coupon fully redeemed");
            if (coupon.max_per_user > 0) {
                var redemptionKey = "redemptions:" + gameId + ":" + userId;
                var userRedemptions = safeRead(nk, "game_coupon_redemptions", redemptionKey, userId);
                var userCount = 0;
                if (userRedemptions && userRedemptions.redemptions) {
                    for (var j = 0; j < userRedemptions.redemptions.length; j++) {
                        if (userRedemptions.redemptions[j].coupon_id === couponId)
                            userCount++;
                    }
                }
                if (userCount >= coupon.max_per_user)
                    return RpcHelpers.errorResponse("Maximum redemptions per user reached");
            }
            if (coupon.coin_cost > 0) {
                var currency = coupon.coin_currency || "coins";
                var debitChangeset = {};
                debitChangeset[currency] = -coupon.coin_cost;
                try {
                    nk.walletUpdate(userId, debitChangeset, { reason: "game_coupon:" + couponId }, true);
                }
                catch (walletErr) {
                    return RpcHelpers.errorResponse("Insufficient coins: " + walletErr.message);
                }
            }
            coupons[couponIdx].current_redemptions = (coupons[couponIdx].current_redemptions || 0) + 1;
            if (coupons[couponIdx].max_redemptions !== null && coupons[couponIdx].current_redemptions >= coupons[couponIdx].max_redemptions) {
                coupons[couponIdx].status = "exhausted";
            }
            nk.storageWrite([{
                    collection: "game_coupons", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID,
                    value: { coupons: coupons, updated_at: new Date().toISOString() }, permissionRead: 2, permissionWrite: 0
                }]);
            var redemptionRecord = {
                redemption_id: nk.uuidv4(), coupon_id: couponId, coupon_title: coupon.title,
                coupon_code: coupon.coupon_code, coin_cost: coupon.coin_cost,
                discount_type: coupon.discount_type, discount_value: coupon.discount_value,
                reward_payload: coupon.reward_payload, redeemed_at: new Date().toISOString()
            };
            var historyKey = "redemptions:" + gameId + ":" + userId;
            var existing = safeRead(nk, "game_coupon_redemptions", historyKey, userId);
            var allRedemptions = (existing && existing.redemptions) ? existing.redemptions : [];
            allRedemptions.push(redemptionRecord);
            nk.storageWrite([{
                    collection: "game_coupon_redemptions", key: historyKey, userId: userId,
                    value: { redemptions: allRedemptions, updated_at: new Date().toISOString() }, permissionRead: 1, permissionWrite: 0
                }]);
            return RpcHelpers.successResponse({ redemption: redemptionRecord, message: "Coupon redeemed successfully" });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function rpcSyncCatalog(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.game_id || !data.coupons)
                return RpcHelpers.errorResponse("game_id and coupons[] required");
            nk.storageWrite([{
                    collection: "game_coupons", key: "catalog:" + data.game_id, userId: Constants.SYSTEM_USER_ID,
                    value: { coupons: data.coupons, synced_at: new Date().toISOString() }, permissionRead: 2, permissionWrite: 0
                }]);
            return RpcHelpers.successResponse({ synced: data.coupons.length });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function register(initializer) {
        initializer.registerRpc("game_coupon_list", rpcList);
        initializer.registerRpc("game_coupon_redeem", rpcRedeem);
        initializer.registerRpc("game_coupon_sync_catalog", rpcSyncCatalog);
    }
    LegacyCoupons.register = register;
})(LegacyCoupons || (LegacyCoupons = {}));
var LegacyDailyRewards;
(function (LegacyDailyRewards) {
    var CYCLE_DAYS = 7;
    function pad2(n) {
        return n < 10 ? "0" + n : String(n);
    }
    function getTodayDateString() {
        var d = new Date();
        return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }
    function getStatus(nk, userId) {
        return Storage.readJson(nk, Constants.DAILY_REWARDS_COLLECTION, "status_" + userId, userId);
    }
    function saveStatus(nk, userId, status) {
        Storage.writeJson(nk, Constants.DAILY_REWARDS_COLLECTION, "status_" + userId, userId, status);
    }
    function rpcGetStatus(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var status = getStatus(nk, userId);
        var today = getTodayDateString();
        if (!status) {
            status = { day: 0, lastClaimDate: "", streak: 0, rewards: [] };
        }
        return RpcHelpers.successResponse({
            day: status.day,
            lastClaimDate: status.lastClaimDate,
            streak: status.streak,
            rewards: status.rewards,
            canClaim: status.lastClaimDate !== today
        });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId || "default";
        var status = getStatus(nk, userId);
        var today = getTodayDateString();
        if (!status) {
            status = { day: 0, lastClaimDate: "", streak: 0, rewards: [] };
        }
        if (status.lastClaimDate === today) {
            return RpcHelpers.errorResponse("Already claimed today");
        }
        var prevDate = status.lastClaimDate;
        var dayDiff = 1;
        if (prevDate) {
            var prev = new Date(prevDate);
            var curr = new Date(today);
            dayDiff = Math.floor((curr.getTime() - prev.getTime()) / 86400000);
        }
        if (dayDiff > 1) {
            status.streak = 0;
        }
        else if (dayDiff === 1) {
            status.streak = (status.streak || 0) + 1;
        }
        status.day = ((status.day || 0) % CYCLE_DAYS) + 1;
        status.lastClaimDate = today;
        var rewardConfig = status.day <= 7
            ? { game: 50 * status.day, tokens: 10 * status.day, xp: 5 * status.day }
            : { game: 100, tokens: 20, xp: 10 };
        if (rewardConfig.game && rewardConfig.game > 0) {
            WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "game", rewardConfig.game);
        }
        if (rewardConfig.tokens && rewardConfig.tokens > 0) {
            WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "tokens", rewardConfig.tokens);
        }
        if (rewardConfig.xp && rewardConfig.xp > 0) {
            WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "xp", rewardConfig.xp);
        }
        status.rewards = status.rewards || [];
        status.rewards.push({
            day: status.day,
            date: today,
            game: rewardConfig.game,
            tokens: rewardConfig.tokens,
            xp: rewardConfig.xp
        });
        saveStatus(nk, userId, status);
        try {
            var syncPayload = {
                userId: userId,
                day: status.day,
                streak: status.streak,
                lastClaimDate: today,
                rewards: rewardConfig
            };
            var syncUrl = data.syncUrl;
            if (syncUrl && typeof syncUrl === "string") {
                HttpClient.post(nk, syncUrl, JSON.stringify(syncPayload));
            }
        }
        catch (_) { }
        var rewardAmount = (rewardConfig.game || 0) + (rewardConfig.tokens || 0);
        if (rewardAmount > 0) {
            try {
                var questsApiUrl = (ctx.env && ctx.env["QUESTS_ECONOMY_API_URL"]) || "http://localhost:3001";
                var webhookSecret = (ctx.env && ctx.env["NAKAMA_WEBHOOK_SECRET"]) || "";
                var qeGameId = (ctx.env && ctx.env["DEFAULT_GAME_ID"]) || "f6f7fe36-03de-43b8-8b5d-1a1892da4eed";
                var syncBody = JSON.stringify({ amount: rewardAmount, sourceType: "daily_reward", sourceId: "daily:day_" + status.day, description: "Daily reward day " + status.day });
                var sigBytes = nk.hmacSha256Hash(webhookSecret, syncBody);
                var sig = nk.binaryToString(sigBytes);
                nk.httpRequest(questsApiUrl.replace(/\/$/, "") + "/game-bridge/s2s/wallet/earn", "post", { "Content-Type": "application/json", "X-Source": "nakama-rpc", "X-Webhook-Signature": sig, "X-User-Id": userId, "X-Game-Id": qeGameId }, syncBody);
            }
            catch (_) { }
        }
        return RpcHelpers.successResponse({
            day: status.day,
            streak: status.streak,
            reward: rewardConfig
        });
    }
    function register(initializer) {
        initializer.registerRpc("daily_rewards_get_status", rpcGetStatus);
        initializer.registerRpc("daily_rewards_claim", rpcClaim);
    }
    LegacyDailyRewards.register = register;
})(LegacyDailyRewards || (LegacyDailyRewards = {}));
var LegacyFriends;
(function (LegacyFriends) {
    function rpcFriendsBlock(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var ids = data.ids ? (Array.isArray(data.ids) ? data.ids : [data.ids]) : [];
            var usernames = data.usernames ? (Array.isArray(data.usernames) ? data.usernames : [data.usernames]) : [];
            if (data.userId)
                ids.push(data.userId);
            if (data.username)
                usernames.push(data.username);
            if (ids.length === 0 && usernames.length === 0) {
                return RpcHelpers.errorResponse("ids or usernames required");
            }
            var result = nk.friendsBlock(userId, username, ids, usernames);
            return RpcHelpers.successResponse({ friends: result.friends || [] });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to block");
        }
    }
    function rpcFriendsUnblock(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var ids = data.ids ? (Array.isArray(data.ids) ? data.ids : [data.ids]) : [];
            var usernames = data.usernames ? (Array.isArray(data.usernames) ? data.usernames : [data.usernames]) : [];
            if (data.userId)
                ids.push(data.userId);
            if (data.username)
                usernames.push(data.username);
            if (ids.length === 0 && usernames.length === 0) {
                return RpcHelpers.errorResponse("ids or usernames required");
            }
            var result = nk.friendsDelete(userId, username, ids, usernames);
            return RpcHelpers.successResponse({ friends: result.friends || [] });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to unblock");
        }
    }
    function rpcFriendsRemove(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var ids = data.ids ? (Array.isArray(data.ids) ? data.ids : [data.ids]) : [];
            var usernames = data.usernames ? (Array.isArray(data.usernames) ? data.usernames : [data.usernames]) : [];
            if (data.userId)
                ids.push(data.userId);
            if (data.username)
                usernames.push(data.username);
            if (ids.length === 0 && usernames.length === 0) {
                return RpcHelpers.errorResponse("ids or usernames required");
            }
            var result = nk.friendsDelete(userId, username, ids, usernames);
            return RpcHelpers.successResponse({ friends: result.friends || [] });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to remove friend");
        }
    }
    function rpcFriendsList(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var limit = data.limit || 100;
            var state = data.state;
            var cursor = data.cursor || "";
            var result = nk.friendsList(userId, limit, state, cursor);
            return RpcHelpers.successResponse({
                friends: result.friends || [],
                cursor: result.cursor || ""
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to list friends");
        }
    }
    function rpcFriendsChallengeUser(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var targetUserId = data.userId || data.targetUserId;
            if (!targetUserId)
                return RpcHelpers.errorResponse("userId required");
            nk.notificationsSend([{
                    userId: targetUserId,
                    subject: "friend_challenge",
                    content: { senderId: userId, senderUsername: username, gameId: data.gameId || "", matchId: data.matchId || "" },
                    code: 1,
                    persistent: false
                }]);
            return RpcHelpers.successResponse({ success: true });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to send challenge");
        }
    }
    function rpcFriendsSpectate(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var targetUserId = data.userId || data.targetUserId;
            if (!targetUserId)
                return RpcHelpers.errorResponse("userId required");
            nk.notificationsSend([{
                    userId: targetUserId,
                    subject: "friend_spectate",
                    content: { spectatorId: userId, matchId: data.matchId || "" },
                    code: 2,
                    persistent: false
                }]);
            return RpcHelpers.successResponse({ success: true });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to send spectate request");
        }
    }
    function register(initializer) {
        initializer.registerRpc("friends_block", rpcFriendsBlock);
        initializer.registerRpc("friends_unblock", rpcFriendsUnblock);
        initializer.registerRpc("friends_remove", rpcFriendsRemove);
        initializer.registerRpc("friends_list", rpcFriendsList);
        initializer.registerRpc("friends_challenge_user", rpcFriendsChallengeUser);
        initializer.registerRpc("friends_spectate", rpcFriendsSpectate);
    }
    LegacyFriends.register = register;
})(LegacyFriends || (LegacyFriends = {}));
var LegacyGameEntry;
(function (LegacyGameEntry) {
    var GAME_ENTRY_COLLECTION = "game_entry";
    function getEntryKey(userId, gameId) {
        return "entry_" + userId + "_" + gameId;
    }
    function getEntry(nk, userId, gameId) {
        var key = getEntryKey(userId, gameId);
        return Storage.readJson(nk, GAME_ENTRY_COLLECTION, key, userId);
    }
    function saveEntry(nk, userId, entry) {
        var key = getEntryKey(entry.userId, entry.gameId);
        Storage.writeJson(nk, GAME_ENTRY_COLLECTION, key, userId, entry);
    }
    function rpcGameEntryValidate(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.gameId || "default";
            var currencyId = data.currencyId || "game";
            var amount = typeof data.amount === "number" ? data.amount : parseInt(String(data.amount || 0), 10);
            if (amount <= 0)
                return RpcHelpers.errorResponse("amount must be positive");
            if (!WalletHelpers.hasCurrency(nk, userId, gameId, currencyId, amount)) {
                return RpcHelpers.errorResponse("Insufficient " + currencyId);
            }
            WalletHelpers.spendCurrency(nk, logger, ctx, userId, gameId, currencyId, amount);
            var now = Math.floor(Date.now() / 1000);
            var entry = {
                userId: userId,
                gameId: gameId,
                currencyId: currencyId,
                amount: amount,
                status: "validated",
                validatedAt: now
            };
            saveEntry(nk, userId, entry);
            return RpcHelpers.successResponse({ valid: true, entry: entry });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Validation failed");
        }
    }
    function rpcGameEntryComplete(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.gameId || "default";
            var success = data.success !== false;
            var entry = getEntry(nk, userId, gameId);
            if (!entry)
                return RpcHelpers.errorResponse("No active entry found");
            if (entry.status !== "validated")
                return RpcHelpers.errorResponse("Entry already completed");
            var now = Math.floor(Date.now() / 1000);
            if (!success) {
                WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, entry.currencyId, entry.amount);
                entry.status = "refunded";
            }
            else {
                entry.status = "completed";
            }
            entry.completedAt = now;
            saveEntry(nk, userId, entry);
            return RpcHelpers.successResponse({ entry: entry });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Completion failed");
        }
    }
    function rpcGameEntryGetStatus(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.gameId || "default";
            var entry = getEntry(nk, userId, gameId);
            return RpcHelpers.successResponse({ entry: entry || null });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to get status");
        }
    }
    function register(initializer) {
        initializer.registerRpc("game_entry_validate", rpcGameEntryValidate);
        initializer.registerRpc("game_entry_complete", rpcGameEntryComplete);
        initializer.registerRpc("game_entry_get_status", rpcGameEntryGetStatus);
    }
    LegacyGameEntry.register = register;
})(LegacyGameEntry || (LegacyGameEntry = {}));
var LegacyGameRegistry;
(function (LegacyGameRegistry) {
    function getGameRegistry(nk) {
        var data = Storage.readSystemJson(nk, Constants.GAME_REGISTRY_COLLECTION, "registry");
        return data || { games: [] };
    }
    function rpcGetGameRegistry(ctx, logger, nk, payload) {
        var registry = getGameRegistry(nk);
        return RpcHelpers.successResponse({ games: registry.games, lastSyncAt: registry.lastSyncAt });
    }
    function rpcGetGameById(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.gameId)
            return RpcHelpers.errorResponse("gameId required");
        var registry = getGameRegistry(nk);
        var game = registry.games.find(function (g) { return g.id === data.gameId; });
        if (!game)
            return RpcHelpers.errorResponse("Game not found: " + data.gameId);
        return RpcHelpers.successResponse({ game: game });
    }
    function rpcSyncGameRegistry(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var apiUrl = data.apiUrl || "https://api.intelliversex.com/games";
            var response;
            try {
                response = HttpClient.get(nk, apiUrl);
            }
            catch (err) {
                logger.warn("[GameRegistry] API fetch failed, using existing data: " + err.message);
                var existing = getGameRegistry(nk);
                return RpcHelpers.successResponse({ success: true, gamesSync: existing.games.length, source: "cache" });
            }
            var games = [];
            if (response && response.code === 200 && response.body) {
                try {
                    var parsed = JSON.parse(response.body);
                    games = parsed.games || parsed.data || parsed || [];
                }
                catch (_) {
                    games = [];
                }
            }
            var registry = {
                games: games,
                lastSyncAt: new Date().toISOString()
            };
            Storage.writeSystemJson(nk, Constants.GAME_REGISTRY_COLLECTION, "registry", registry);
            return RpcHelpers.successResponse({ success: true, gamesSync: games.length });
        }
        catch (err) {
            return RpcHelpers.errorResponse("Sync failed: " + err.message);
        }
    }
    function register(initializer) {
        initializer.registerRpc("get_game_registry", rpcGetGameRegistry);
        initializer.registerRpc("get_game_by_id", rpcGetGameById);
        initializer.registerRpc("sync_game_registry", rpcSyncGameRegistry);
    }
    LegacyGameRegistry.register = register;
})(LegacyGameRegistry || (LegacyGameRegistry = {}));
var LegacyGiftCards;
(function (LegacyGiftCards) {
    function safeRead(nk, collection, key, userId) {
        try {
            var recs = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
            if (recs && recs.length > 0)
                return recs[0].value;
        }
        catch (_) { }
        return null;
    }
    function rpcList(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.game_id;
            if (!gameId)
                return RpcHelpers.errorResponse("game_id required");
            var records = [];
            try {
                var result = nk.storageRead([{ collection: "game_gift_cards", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID }]);
                if (result && result.length > 0 && result[0].value && result[0].value.cards)
                    records = result[0].value.cards;
            }
            catch (_) { }
            var now = Date.now();
            var active = [];
            for (var i = 0; i < records.length; i++) {
                var c = records[i];
                if (c.status !== "active")
                    continue;
                if (c.valid_from && new Date(c.valid_from).getTime() > now)
                    continue;
                if (c.valid_until && new Date(c.valid_until).getTime() < now)
                    continue;
                if (c.stock_total !== null && c.stock_sold >= c.stock_total)
                    continue;
                active.push(c);
            }
            return RpcHelpers.successResponse({ cards: active, total: active.length });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function rpcPurchase(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.game_id;
            var cardId = data.card_id;
            if (!gameId || !cardId)
                return RpcHelpers.errorResponse("game_id and card_id required");
            var catalogRecs = nk.storageRead([{ collection: "game_gift_cards", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID }]);
            if (!catalogRecs || catalogRecs.length === 0)
                return RpcHelpers.errorResponse("No gift card catalog for this game");
            var cards = catalogRecs[0].value.cards || [];
            var card = null;
            var cardIdx = -1;
            for (var i = 0; i < cards.length; i++) {
                if (cards[i].id === cardId) {
                    card = cards[i];
                    cardIdx = i;
                    break;
                }
            }
            if (!card)
                return RpcHelpers.errorResponse("Gift card not found");
            if (card.status !== "active")
                return RpcHelpers.errorResponse("Gift card not available");
            var now = Date.now();
            if (card.valid_from && new Date(card.valid_from).getTime() > now)
                return RpcHelpers.errorResponse("Gift card not yet available");
            if (card.valid_until && new Date(card.valid_until).getTime() < now)
                return RpcHelpers.errorResponse("Gift card has expired");
            if (card.stock_total !== null && card.stock_sold >= card.stock_total)
                return RpcHelpers.errorResponse("Gift card sold out");
            if (card.max_per_user > 0) {
                var purchaseKey = "purchases:" + gameId + ":" + userId;
                var userPurchases = safeRead(nk, "game_gift_card_purchases", purchaseKey, userId);
                var userCount = 0;
                if (userPurchases && userPurchases.purchases) {
                    for (var j = 0; j < userPurchases.purchases.length; j++) {
                        if (userPurchases.purchases[j].card_id === cardId)
                            userCount++;
                    }
                }
                if (userCount >= card.max_per_user)
                    return RpcHelpers.errorResponse("Maximum purchases per user reached");
            }
            var currency = card.coin_currency || "coins";
            var debitChangeset = {};
            debitChangeset[currency] = -card.coin_price;
            var walletResult;
            try {
                walletResult = nk.walletUpdate(userId, debitChangeset, { reason: "game_gift_card:" + cardId }, true);
            }
            catch (walletErr) {
                return RpcHelpers.errorResponse("Insufficient coins: " + walletErr.message);
            }
            cards[cardIdx].stock_sold = (cards[cardIdx].stock_sold || 0) + 1;
            if (cards[cardIdx].stock_total !== null && cards[cardIdx].stock_sold >= cards[cardIdx].stock_total) {
                cards[cardIdx].status = "sold_out";
            }
            nk.storageWrite([{
                    collection: "game_gift_cards", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID,
                    value: { cards: cards, updated_at: new Date().toISOString() }, permissionRead: 2, permissionWrite: 0
                }]);
            var purchaseRecord = {
                purchase_id: nk.uuidv4(), card_id: cardId, card_name: card.name,
                coin_price: card.coin_price, coin_currency: currency,
                reward_type: card.reward_type, reward_payload: card.reward_payload,
                purchased_at: new Date().toISOString()
            };
            var purchaseHistoryKey = "purchases:" + gameId + ":" + userId;
            var existing = safeRead(nk, "game_gift_card_purchases", purchaseHistoryKey, userId);
            var allPurchases = (existing && existing.purchases) ? existing.purchases : [];
            allPurchases.push(purchaseRecord);
            nk.storageWrite([{
                    collection: "game_gift_card_purchases", key: purchaseHistoryKey, userId: userId,
                    value: { purchases: allPurchases, updated_at: new Date().toISOString() }, permissionRead: 1, permissionWrite: 0
                }]);
            return RpcHelpers.successResponse({ purchase: purchaseRecord, new_wallet: walletResult || {}, message: "Gift card purchased successfully" });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function rpcSyncCatalog(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.game_id || !data.cards)
                return RpcHelpers.errorResponse("game_id and cards[] required");
            nk.storageWrite([{
                    collection: "game_gift_cards", key: "catalog:" + data.game_id, userId: Constants.SYSTEM_USER_ID,
                    value: { cards: data.cards, synced_at: new Date().toISOString() }, permissionRead: 2, permissionWrite: 0
                }]);
            return RpcHelpers.successResponse({ synced: data.cards.length });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function rpcGetPurchases(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.game_id)
                return RpcHelpers.errorResponse("game_id required");
            var purchaseKey = "purchases:" + data.game_id + ":" + userId;
            var existing = safeRead(nk, "game_gift_card_purchases", purchaseKey, userId);
            var purchases = (existing && existing.purchases) ? existing.purchases : [];
            return RpcHelpers.successResponse({ purchases: purchases, total: purchases.length });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function register(initializer) {
        initializer.registerRpc("game_gift_card_list", rpcList);
        initializer.registerRpc("game_gift_card_purchase", rpcPurchase);
        initializer.registerRpc("game_gift_card_sync_catalog", rpcSyncCatalog);
        initializer.registerRpc("game_gift_card_get_purchases", rpcGetPurchases);
    }
    LegacyGiftCards.register = register;
})(LegacyGiftCards || (LegacyGiftCards = {}));
var LegacyGroups;
(function (LegacyGroups) {
    var GROUP_WALLETS_COLLECTION = "group_wallets";
    function rpcCreateGameGroup(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var name = data.name || "Game Group";
            var description = data.description || "";
            var open = data.open !== false;
            var metadata = data.metadata || {};
            if (data.gameId)
                metadata.gameId = data.gameId;
            var group = nk.groupCreate(userId, name, userId, null, description, null, open, metadata, data.limit || 100);
            return RpcHelpers.successResponse({ group: group });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to create group");
        }
    }
    function rpcUpdateGroupXp(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var groupId = data.groupId;
            var xp = data.xp;
            if (!groupId)
                return RpcHelpers.errorResponse("groupId required");
            if (xp === undefined)
                return RpcHelpers.errorResponse("xp required");
            var groups = nk.groupsGetId([groupId]);
            if (!groups || groups.length === 0)
                return RpcHelpers.errorResponse("Group not found");
            var group = groups[0];
            var meta = group.metadata || {};
            var currentXp = typeof meta.xp === "number" ? meta.xp : 0;
            meta.xp = currentXp + (typeof xp === "number" ? xp : parseInt(String(xp), 10));
            nk.groupUpdate(groupId, userId, undefined, undefined, undefined, undefined, undefined, undefined, meta, undefined);
            return RpcHelpers.successResponse({ xp: meta.xp });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to update group XP");
        }
    }
    function getGroupWallet(nk, groupId) {
        var key = "wallet_" + groupId;
        var data = Storage.readSystemJson(nk, GROUP_WALLETS_COLLECTION, key);
        return data || {};
    }
    function saveGroupWallet(nk, groupId, wallet) {
        var key = "wallet_" + groupId;
        Storage.writeSystemJson(nk, GROUP_WALLETS_COLLECTION, key, wallet);
    }
    function rpcGetGroupWallet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var groupId = data.groupId;
            if (!groupId)
                return RpcHelpers.errorResponse("groupId required");
            var wallet = getGroupWallet(nk, groupId);
            return RpcHelpers.successResponse({ wallet: wallet });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to get group wallet");
        }
    }
    function rpcUpdateGroupWallet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var groupId = data.groupId;
            var currencyId = data.currencyId || "game";
            var amount = typeof data.amount === "number" ? data.amount : parseInt(String(data.amount || 0), 10);
            if (!groupId)
                return RpcHelpers.errorResponse("groupId required");
            var wallet = getGroupWallet(nk, groupId);
            var current = wallet[currencyId] || 0;
            wallet[currencyId] = current + amount;
            saveGroupWallet(nk, groupId, wallet);
            return RpcHelpers.successResponse({ wallet: wallet });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to update group wallet");
        }
    }
    function rpcGetUserGroups(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var limit = data.limit || 100;
            var state = data.state;
            var cursor = data.cursor || "";
            var result = nk.userGroupsList(userId, limit, state, cursor);
            return RpcHelpers.successResponse({
                userGroups: result.userGroups || [],
                cursor: result.cursor || ""
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to list user groups");
        }
    }
    function register(initializer) {
        initializer.registerRpc("create_game_group", rpcCreateGameGroup);
        initializer.registerRpc("update_group_xp", rpcUpdateGroupXp);
        initializer.registerRpc("get_group_wallet", rpcGetGroupWallet);
        initializer.registerRpc("update_group_wallet", rpcUpdateGroupWallet);
        initializer.registerRpc("get_user_groups", rpcGetUserGroups);
    }
    LegacyGroups.register = register;
})(LegacyGroups || (LegacyGroups = {}));
var LegacyLeaderboards;
(function (LegacyLeaderboards) {
    var RESET_SCHEDULES = {
        daily: "0 0 * * *",
        weekly: "0 0 * * 0",
        monthly: "0 0 1 * *",
        alltime: ""
    };
    var PERIODS = ["daily", "weekly", "monthly", "alltime"];
    function ensureLeaderboardExists(nk, logger, leaderboardId, resetSchedule, metadata) {
        try {
            try {
                var existing = nk.leaderboardsGetId([leaderboardId]);
                if (existing && existing.length > 0)
                    return true;
            }
            catch (_) { /* proceed to create */ }
            nk.leaderboardCreate(leaderboardId, true, "descending" /* nkruntime.SortOrder.DESCENDING */, "best" /* nkruntime.Operator.BEST */, resetSchedule || "", metadata || {});
            logger.info("[LegacyLeaderboards] Created: " + leaderboardId);
            return true;
        }
        catch (err) {
            logger.warn("[LegacyLeaderboards] ensureLeaderboardExists: " + err.message);
            return false;
        }
    }
    function readRegistry(nk) {
        var data = Storage.readSystemJson(nk, Constants.LEADERBOARDS_REGISTRY_COLLECTION, "all_created");
        return data || [];
    }
    function readTimePeriodRegistry(nk) {
        var data = Storage.readSystemJson(nk, Constants.LEADERBOARDS_REGISTRY_COLLECTION, "time_period_leaderboards");
        return (data && data.leaderboards) ? data.leaderboards : [];
    }
    function getAllLeaderboardIds(nk, logger) {
        var ids = [];
        var registry = readRegistry(nk);
        for (var i = 0; i < registry.length; i++) {
            if (registry[i].leaderboardId)
                ids.push(registry[i].leaderboardId);
        }
        var timeReg = readTimePeriodRegistry(nk);
        for (var j = 0; j < timeReg.length; j++) {
            var lb = timeReg[j];
            if (lb.leaderboardId && ids.indexOf(lb.leaderboardId) === -1)
                ids.push(lb.leaderboardId);
        }
        return ids;
    }
    function writeToAllLeaderboards(nk, logger, userId, username, gameId, score) {
        var updated = [];
        var metadata = { source: "submit_score_and_sync", gameId: gameId, submittedAt: new Date().toISOString() };
        var mainId = "leaderboard_" + gameId;
        if (ensureLeaderboardExists(nk, logger, mainId, "", { scope: "game", gameId: gameId })) {
            try {
                nk.leaderboardRecordWrite(mainId, userId, username, score, 0, metadata);
                updated.push(mainId);
            }
            catch (_) { /* skip */ }
        }
        for (var i = 0; i < PERIODS.length; i++) {
            var period = PERIODS[i];
            var periodId = "leaderboard_" + gameId + "_" + period;
            if (ensureLeaderboardExists(nk, logger, periodId, RESET_SCHEDULES[period], { scope: "game", gameId: gameId, timePeriod: period })) {
                try {
                    nk.leaderboardRecordWrite(periodId, userId, username, score, 0, metadata);
                    updated.push(periodId);
                }
                catch (_) { /* skip */ }
            }
        }
        var globalId = "leaderboard_global";
        if (ensureLeaderboardExists(nk, logger, globalId, "", { scope: "global" })) {
            try {
                nk.leaderboardRecordWrite(globalId, userId, username, score, 0, metadata);
                updated.push(globalId);
            }
            catch (_) { /* skip */ }
        }
        for (var k = 0; k < PERIODS.length; k++) {
            var gp = PERIODS[k];
            var gid = "leaderboard_global_" + gp;
            if (ensureLeaderboardExists(nk, logger, gid, RESET_SCHEDULES[gp], { scope: "global", timePeriod: gp })) {
                try {
                    nk.leaderboardRecordWrite(gid, userId, username, score, 0, metadata);
                    updated.push(gid);
                }
                catch (_) { /* skip */ }
            }
        }
        var allIds = getAllLeaderboardIds(nk, logger);
        for (var m = 0; m < allIds.length; m++) {
            var lbId = allIds[m];
            if (updated.indexOf(lbId) !== -1)
                continue;
            if (lbId.indexOf(gameId) !== -1 || lbId.indexOf("global") !== -1) {
                try {
                    nk.leaderboardRecordWrite(lbId, userId, username, score, 0, metadata);
                    updated.push(lbId);
                }
                catch (_) { /* skip */ }
            }
        }
        return updated;
    }
    function rpcCreateAllLeaderboardsPersistent(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload || "{}");
            var existingRecords = readRegistry(nk);
            var existingIds = {};
            for (var i = 0; i < existingRecords.length; i++)
                existingIds[existingRecords[i].leaderboardId] = true;
            var created = [];
            var skipped = [];
            var globalId = "leaderboard_global";
            if (!existingIds[globalId]) {
                try {
                    nk.leaderboardCreate(globalId, true, "descending" /* nkruntime.SortOrder.DESCENDING */, "best" /* nkruntime.Operator.BEST */, "0 0 * * 0", { scope: "global", desc: "Global Ecosystem Leaderboard" });
                    created.push(globalId);
                    existingRecords.push({ leaderboardId: globalId, scope: "global", createdAt: new Date().toISOString() });
                }
                catch (err) {
                    skipped.push(globalId);
                }
            }
            else {
                skipped.push(globalId);
            }
            var games = data.games || [];
            for (var j = 0; j < games.length; j++) {
                var game = games[j];
                var gid = game.id || game.gameId;
                if (!gid)
                    continue;
                var lbId = "leaderboard_" + gid;
                if (existingIds[lbId]) {
                    skipped.push(lbId);
                    continue;
                }
                try {
                    nk.leaderboardCreate(lbId, true, "descending" /* nkruntime.SortOrder.DESCENDING */, "best" /* nkruntime.Operator.BEST */, "0 0 * * 0", {
                        desc: "Leaderboard for " + (game.gameTitle || game.name || "Untitled"),
                        gameId: gid,
                        scope: "game"
                    });
                    created.push(lbId);
                    existingRecords.push({ leaderboardId: lbId, gameId: gid, scope: "game", createdAt: new Date().toISOString() });
                }
                catch (err) {
                    skipped.push(lbId);
                }
            }
            Storage.writeSystemJson(nk, Constants.LEADERBOARDS_REGISTRY_COLLECTION, "all_created", existingRecords);
            return RpcHelpers.successResponse({ created: created, skipped: skipped, totalProcessed: games.length, storedRecords: existingRecords.length });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to create leaderboards");
        }
    }
    function rpcCreateTimePeriodLeaderboards(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload || "{}");
            var games = data.games || [];
            var allLeaderboards = [];
            for (var i = 0; i < PERIODS.length; i++) {
                var period = PERIODS[i];
                var gid = "leaderboard_global_" + period;
                try {
                    nk.leaderboardsGetId([gid]);
                }
                catch (_) {
                    try {
                        nk.leaderboardCreate(gid, true, "descending" /* nkruntime.SortOrder.DESCENDING */, "best" /* nkruntime.Operator.BEST */, RESET_SCHEDULES[period], { scope: "global", timePeriod: period });
                        allLeaderboards.push({ leaderboardId: gid, period: period, scope: "global" });
                    }
                    catch (e) {
                        logger.warn("[LegacyLeaderboards] create global " + period + ": " + e.message);
                    }
                }
            }
            for (var j = 0; j < games.length; j++) {
                var game = games[j];
                var gameId = game.id || game.gameId;
                if (!gameId)
                    continue;
                for (var k = 0; k < PERIODS.length; k++) {
                    var p = PERIODS[k];
                    var lid = "leaderboard_" + gameId + "_" + p;
                    try {
                        nk.leaderboardsGetId([lid]);
                    }
                    catch (_) {
                        try {
                            nk.leaderboardCreate(lid, true, "descending" /* nkruntime.SortOrder.DESCENDING */, "best" /* nkruntime.Operator.BEST */, RESET_SCHEDULES[p], {
                                gameId: gameId,
                                gameTitle: game.gameTitle || game.name,
                                scope: "game",
                                timePeriod: p
                            });
                            allLeaderboards.push({ leaderboardId: lid, period: p, gameId: gameId });
                        }
                        catch (e) {
                            logger.warn("[LegacyLeaderboards] create " + lid + ": " + e.message);
                        }
                    }
                }
            }
            Storage.writeSystemJson(nk, Constants.LEADERBOARDS_REGISTRY_COLLECTION, "time_period_leaderboards", {
                leaderboards: allLeaderboards,
                lastUpdated: new Date().toISOString(),
                totalGames: games.length
            });
            return RpcHelpers.successResponse({
                summary: { totalCreated: allLeaderboards.length, gamesProcessed: games.length },
                leaderboards: allLeaderboards
            });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to create time-period leaderboards");
        }
    }
    function rpcSubmitScoreToTimePeriods(ctx, logger, nk, payload) {
        try {
            if (!ctx.userId)
                return RpcHelpers.errorResponse("Authentication required");
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.gameId || (data.score === undefined || data.score === null))
                return RpcHelpers.errorResponse("gameId and score required");
            var score = parseInt(String(data.score));
            if (isNaN(score))
                return RpcHelpers.errorResponse("Score must be a number");
            var gameId = data.gameId;
            var subscore = parseInt(String(data.subscore)) || 0;
            var metadata = data.metadata || {};
            metadata.submittedAt = new Date().toISOString();
            metadata.gameId = gameId;
            metadata.source = "submit_score_to_time_periods";
            var userId = ctx.userId;
            var username = ctx.username || userId;
            var results = [];
            var errors = [];
            for (var i = 0; i < PERIODS.length; i++) {
                var period = PERIODS[i];
                var lbId = "leaderboard_" + gameId + "_" + period;
                try {
                    nk.leaderboardRecordWrite(lbId, userId, username, score, subscore, metadata);
                    results.push({ leaderboardId: lbId, period: period, scope: "game", success: true });
                }
                catch (e) {
                    errors.push({ leaderboardId: lbId, period: period, error: e.message });
                }
            }
            for (var j = 0; j < PERIODS.length; j++) {
                var p = PERIODS[j];
                var gid = "leaderboard_global_" + p;
                try {
                    nk.leaderboardRecordWrite(gid, userId, username, score, subscore, metadata);
                    results.push({ leaderboardId: gid, period: p, scope: "global", success: true });
                }
                catch (e) {
                    errors.push({ leaderboardId: gid, period: p, error: e.message });
                }
            }
            return RpcHelpers.successResponse({ gameId: gameId, score: score, userId: userId, results: results, errors: errors });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to submit score");
        }
    }
    function rpcGetTimePeriodLeaderboard(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.gameId && data.scope !== "global")
                return RpcHelpers.errorResponse("gameId or scope=global required");
            if (!data.period)
                return RpcHelpers.errorResponse("period required (daily, weekly, monthly, alltime)");
            var period = data.period;
            if (PERIODS.indexOf(period) === -1)
                return RpcHelpers.errorResponse("Invalid period");
            var leaderboardId = data.scope === "global" ? "leaderboard_global_" + period : "leaderboard_" + data.gameId + "_" + period;
            var limit = parseInt(String(data.limit)) || 10;
            var cursor = data.cursor || "";
            var ownerIds = data.ownerIds || null;
            var result = nk.leaderboardRecordsList(leaderboardId, ownerIds, limit, cursor, 0);
            return RpcHelpers.successResponse({
                leaderboardId: leaderboardId,
                period: period,
                gameId: data.gameId,
                scope: data.scope || "game",
                records: result.records || [],
                ownerRecords: result.ownerRecords || [],
                prevCursor: result.prevCursor || "",
                nextCursor: result.nextCursor || "",
                rankCount: result.rankCount || 0
            });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to fetch leaderboard");
        }
    }
    function rpcSubmitScoreAndSync(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var v = RpcHelpers.validatePayload(data, ["score", "device_id", "game_id"]);
            if (!v.valid)
                return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
            var score = parseInt(String(data.score));
            if (isNaN(score))
                return RpcHelpers.errorResponse("Score must be a number");
            var deviceId = data.device_id;
            var gameId = data.game_id;
            var userId = ctx.userId || deviceId;
            var username = ctx.username || "";
            if (!username) {
                try {
                    var users = nk.usersGetId([userId]);
                    if (users && users.length > 0 && users[0].username)
                        username = users[0].username;
                }
                catch (_) { }
            }
            if (!username)
                username = userId;
            var updated = writeToAllLeaderboards(nk, logger, userId, username, gameId, score);
            return RpcHelpers.successResponse({
                success: true,
                score: score,
                leaderboards_updated: updated,
                game_id: gameId
            });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to submit score");
        }
    }
    function rpcGetAllLeaderboards(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.device_id || !data.game_id)
                return RpcHelpers.errorResponse("device_id and game_id required");
            var deviceId = data.device_id;
            var gameId = data.game_id;
            var limit = parseInt(String(data.limit)) || 10;
            var userId = ctx.userId || deviceId;
            var leaderboardIds = [];
            leaderboardIds.push("leaderboard_" + gameId);
            for (var i = 0; i < PERIODS.length; i++) {
                leaderboardIds.push("leaderboard_" + gameId + "_" + PERIODS[i]);
            }
            leaderboardIds.push("leaderboard_global");
            for (var j = 0; j < PERIODS.length; j++) {
                leaderboardIds.push("leaderboard_global_" + PERIODS[j]);
            }
            leaderboardIds.push("leaderboard_friends_" + gameId);
            leaderboardIds.push("leaderboard_friends_global");
            var allIds = getAllLeaderboardIds(nk, logger);
            for (var k = 0; k < allIds.length; k++) {
                var lb = allIds[k];
                if (leaderboardIds.indexOf(lb) === -1 && (lb.indexOf(gameId) !== -1 || lb.indexOf("global") !== -1)) {
                    leaderboardIds.push(lb);
                }
            }
            var leaderboards = {};
            var successCount = 0;
            for (var m = 0; m < leaderboardIds.length; m++) {
                var lbId = leaderboardIds[m];
                try {
                    var recs = nk.leaderboardRecordsList(lbId, null, limit, null, 0);
                    var userRec = null;
                    try {
                        var ur = nk.leaderboardRecordsList(lbId, [userId], 1, null, 0);
                        if (ur && ur.records && ur.records.length > 0)
                            userRec = ur.records[0];
                    }
                    catch (_) { }
                    leaderboards[lbId] = {
                        leaderboard_id: lbId,
                        records: recs.records || [],
                        user_record: userRec,
                        next_cursor: recs.nextCursor || "",
                        prev_cursor: recs.prevCursor || ""
                    };
                    successCount++;
                }
                catch (e) {
                    leaderboards[lbId] = { leaderboard_id: lbId, error: e.message, records: [], user_record: null };
                }
            }
            return RpcHelpers.successResponse({
                device_id: deviceId,
                game_id: gameId,
                leaderboards: leaderboards,
                total_leaderboards: leaderboardIds.length,
                successful_queries: successCount
            });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to get leaderboards");
        }
    }
    function rpcSubmitLeaderboardScore(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload || "{}");
            if (!data.device_id || !data.game_id)
                return RpcHelpers.errorResponse("device_id and game_id required");
            if (data.score === undefined || data.score === null)
                return RpcHelpers.errorResponse("score required");
            var score = Number(data.score);
            if (isNaN(score))
                return RpcHelpers.errorResponse("score must be a number");
            var syncPayload = JSON.stringify({
                device_id: data.device_id,
                game_id: data.game_id,
                score: score,
                metadata: data.metadata || {}
            });
            var resultStr = rpcSubmitScoreAndSync(ctx, logger, nk, syncPayload);
            var result = JSON.parse(resultStr);
            if (!result.success)
                return RpcHelpers.errorResponse("Failed to submit score: " + (result.error || ""));
            return RpcHelpers.successResponse({
                success: true,
                leaderboards_updated: result.data.leaderboards_updated || [],
                score: score,
                message: "Score submitted successfully"
            });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to submit score");
        }
    }
    function rpcGetLeaderboard(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload || "{}");
            if (!data.game_id)
                return RpcHelpers.errorResponse("game_id required");
            var period = data.period || "alltime";
            var limit = Math.min(Math.max(parseInt(String(data.limit)) || 10, 1), 100);
            var cursor = data.cursor || "";
            var innerPayload = JSON.stringify({
                gameId: data.game_id,
                period: period,
                limit: limit,
                cursor: cursor
            });
            var resultStr = rpcGetTimePeriodLeaderboard(ctx, logger, nk, innerPayload);
            var result = JSON.parse(resultStr);
            if (!result.success)
                return RpcHelpers.errorResponse("Failed to get leaderboard: " + (result.error || ""));
            var lbData = result.data || result;
            return RpcHelpers.successResponse({
                leaderboard_id: lbData.leaderboardId,
                records: lbData.records || [],
                next_cursor: lbData.nextCursor || "",
                prev_cursor: lbData.prevCursor || "",
                period: period,
                game_id: data.game_id
            });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to get leaderboard");
        }
    }
    function register(initializer) {
        initializer.registerRpc("create_all_leaderboards_persistent", rpcCreateAllLeaderboardsPersistent);
        initializer.registerRpc("create_time_period_leaderboards", rpcCreateTimePeriodLeaderboards);
        initializer.registerRpc("submit_score_to_time_periods", rpcSubmitScoreToTimePeriods);
        initializer.registerRpc("get_time_period_leaderboard", rpcGetTimePeriodLeaderboard);
        initializer.registerRpc("submit_score_and_sync", rpcSubmitScoreAndSync);
        initializer.registerRpc("get_all_leaderboards", rpcGetAllLeaderboards);
        initializer.registerRpc("submit_leaderboard_score", rpcSubmitLeaderboardScore);
        initializer.registerRpc("get_leaderboard", rpcGetLeaderboard);
    }
    LegacyLeaderboards.register = register;
})(LegacyLeaderboards || (LegacyLeaderboards = {}));
var LegacyMissions;
(function (LegacyMissions) {
    function pad2(n) {
        return n < 10 ? "0" + n : String(n);
    }
    function getTodayDateString() {
        var d = new Date();
        return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    }
    function getDefaultMissions() {
        return [
            { id: "play_3", type: "play_games", description: "Play 3 games", target: 3, progress: 0, completed: false, claimed: false, reward: { game: 30 } },
            { id: "win_1", type: "win_games", description: "Win 1 game", target: 1, progress: 0, completed: false, claimed: false, reward: { tokens: 15 } },
            { id: "correct_10", type: "correct_answers", description: "Get 10 correct answers", target: 10, progress: 0, completed: false, claimed: false, reward: { xp: 25 } }
        ];
    }
    function getMissionsForUser(nk, userId, date) {
        var key = "daily_" + userId + "_" + date;
        var data = Storage.readJson(nk, Constants.MISSIONS_COLLECTION, key, userId);
        if (!data || data.date !== date) {
            return { missions: getDefaultMissions(), date: date };
        }
        return data;
    }
    function saveMissions(nk, userId, data) {
        var key = "daily_" + userId + "_" + data.date;
        Storage.writeJson(nk, Constants.MISSIONS_COLLECTION, key, userId, data);
    }
    function rpcGetDailyMissions(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var today = getTodayDateString();
        var data = getMissionsForUser(nk, userId, today);
        return RpcHelpers.successResponse({ missions: data.missions, date: data.date });
    }
    function rpcSubmitProgress(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.missionId || data.amount === undefined) {
            return RpcHelpers.errorResponse("missionId and amount required");
        }
        var today = getTodayDateString();
        var missionsData = getMissionsForUser(nk, userId, today);
        var mission = missionsData.missions.find(function (m) { return m.id === data.missionId; });
        if (!mission) {
            return RpcHelpers.errorResponse("Mission not found");
        }
        if (mission.completed && mission.claimed) {
            return RpcHelpers.successResponse({ mission: mission, alreadyComplete: true });
        }
        var amount = Math.max(0, Number(data.amount) || 0);
        if (mission.type === "play_games" || mission.type === "win_games" || mission.type === "correct_answers") {
            mission.progress = Math.min(mission.target, (mission.progress || 0) + amount);
            mission.completed = mission.progress >= mission.target;
        }
        else {
            mission.progress = Math.min(mission.target, (mission.progress || 0) + amount);
            mission.completed = mission.progress >= mission.target;
        }
        saveMissions(nk, userId, missionsData);
        return RpcHelpers.successResponse({ mission: mission });
    }
    function rpcClaimReward(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.missionId)
            return RpcHelpers.errorResponse("missionId required");
        var gameId = data.gameId || "default";
        var today = getTodayDateString();
        var missionsData = getMissionsForUser(nk, userId, today);
        var mission = missionsData.missions.find(function (m) { return m.id === data.missionId; });
        if (!mission) {
            return RpcHelpers.errorResponse("Mission not found");
        }
        if (!mission.completed) {
            return RpcHelpers.errorResponse("Mission not completed");
        }
        if (mission.claimed) {
            return RpcHelpers.errorResponse("Reward already claimed");
        }
        var reward = mission.reward || {};
        if (reward.game && reward.game > 0) {
            WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "game", reward.game);
        }
        if (reward.tokens && reward.tokens > 0) {
            WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "tokens", reward.tokens);
        }
        if (reward.xp && reward.xp > 0) {
            WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "xp", reward.xp);
        }
        mission.claimed = true;
        saveMissions(nk, userId, missionsData);
        try {
            var syncUrl = data.syncUrl;
            if (syncUrl && typeof syncUrl === "string") {
                HttpClient.post(nk, syncUrl, JSON.stringify({
                    userId: userId,
                    missionId: mission.id,
                    reward: reward
                }));
            }
        }
        catch (_) { }
        var missionRewardTotal = (reward.game || 0) + (reward.tokens || 0);
        if (missionRewardTotal > 0) {
            try {
                var questsApiUrl = (ctx.env && ctx.env["QUESTS_ECONOMY_API_URL"]) || "http://localhost:3001";
                var webhookSecret = (ctx.env && ctx.env["NAKAMA_WEBHOOK_SECRET"]) || "";
                var qeGameId = (ctx.env && ctx.env["DEFAULT_GAME_ID"]) || "f6f7fe36-03de-43b8-8b5d-1a1892da4eed";
                var syncBody = JSON.stringify({ amount: missionRewardTotal, sourceType: "mission_reward", sourceId: "mission:" + mission.id, description: "Mission reward claimed" });
                var sigBytes = nk.hmacSha256Hash(webhookSecret, syncBody);
                var sig = nk.binaryToString(sigBytes);
                nk.httpRequest(questsApiUrl.replace(/\/$/, "") + "/game-bridge/s2s/wallet/earn", "post", { "Content-Type": "application/json", "X-Source": "nakama-rpc", "X-Webhook-Signature": sig, "X-User-Id": userId, "X-Game-Id": qeGameId }, syncBody);
            }
            catch (_) { }
        }
        return RpcHelpers.successResponse({ mission: mission, reward: reward });
    }
    function register(initializer) {
        initializer.registerRpc("get_daily_missions", rpcGetDailyMissions);
        initializer.registerRpc("submit_mission_progress", rpcSubmitProgress);
        initializer.registerRpc("claim_mission_reward", rpcClaimReward);
    }
    LegacyMissions.register = register;
})(LegacyMissions || (LegacyMissions = {}));
var LegacyMultiGame;
(function (LegacyMultiGame) {
    function gameRpcHandler(gameId, handler) {
        return function (ctx, logger, nk, payload) {
            try {
                var userId = RpcHelpers.requireUserId(ctx);
                var data = RpcHelpers.parseRpcPayload(payload);
                var result = handler(ctx, logger, nk, data, userId, gameId);
                return RpcHelpers.successResponse(result);
            }
            catch (err) {
                return RpcHelpers.errorResponse(err.message);
            }
        };
    }
    function updateUserProfile(ctx, logger, nk, data, userId, gId) {
        var metadata = Storage.readJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId) || {};
        if (data.displayName)
            metadata.displayName = data.displayName;
        if (data.avatarUrl)
            metadata.avatarUrl = data.avatarUrl;
        if (data.level !== undefined)
            metadata.level = data.level;
        Storage.writeJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId, metadata, 2, 1);
        return { metadata: metadata };
    }
    function grantCurrency(ctx, logger, nk, data, userId, gId) {
        var wallet = WalletHelpers.addCurrency(nk, logger, ctx, userId, gId, data.currencyId || "game", data.amount || 0);
        return { wallet: wallet.currencies };
    }
    function spendCurrency(ctx, logger, nk, data, userId, gId) {
        var wallet = WalletHelpers.spendCurrency(nk, logger, ctx, userId, gId, data.currencyId || "game", data.amount || 0);
        return { wallet: wallet.currencies };
    }
    function validatePurchase(ctx, logger, nk, data, userId, gId) {
        if (!data.itemId || !data.price)
            throw new Error("itemId and price required");
        var canAfford = WalletHelpers.hasCurrency(nk, userId, gId, data.currencyId || "game", data.price);
        return { valid: canAfford, itemId: data.itemId, price: data.price };
    }
    function listInventory(ctx, logger, nk, data, userId, gId) {
        var inv = Storage.readJson(nk, "game_inventory", gId + "_" + userId, userId) || { items: {} };
        return inv;
    }
    function grantItem(ctx, logger, nk, data, userId, gId) {
        if (!data.itemId)
            throw new Error("itemId required");
        var inv = Storage.readJson(nk, "game_inventory", gId + "_" + userId, userId) || { items: {} };
        if (!inv.items[data.itemId])
            inv.items[data.itemId] = { count: 0 };
        inv.items[data.itemId].count += (data.count || 1);
        Storage.writeJson(nk, "game_inventory", gId + "_" + userId, userId, inv);
        return { item: inv.items[data.itemId] };
    }
    function consumeItem(ctx, logger, nk, data, userId, gId) {
        if (!data.itemId)
            throw new Error("itemId required");
        var inv = Storage.readJson(nk, "game_inventory", gId + "_" + userId, userId) || { items: {} };
        var item = inv.items[data.itemId];
        if (!item || item.count < (data.count || 1))
            throw new Error("Insufficient items");
        item.count -= (data.count || 1);
        if (item.count <= 0)
            delete inv.items[data.itemId];
        Storage.writeJson(nk, "game_inventory", gId + "_" + userId, userId, inv);
        return { success: true };
    }
    function submitScore(ctx, logger, nk, data, userId, gId) {
        if (data.score === undefined)
            throw new Error("score required");
        var lbId = gId + "_leaderboard";
        try {
            nk.leaderboardCreate(lbId, false, "descending" /* nkruntime.SortOrder.DESCENDING */, "best" /* nkruntime.Operator.BEST */);
        }
        catch (_) { }
        nk.leaderboardRecordWrite(lbId, userId, ctx.username || "", data.score, data.subscore || 0, data.metadata || {}, "best" /* nkruntime.OverrideOperator.BEST */);
        EventBus.emit(nk, logger, ctx, EventBus.Events.SCORE_SUBMITTED, { userId: userId, gameId: gId, score: data.score });
        return { success: true };
    }
    function getLeaderboard(ctx, logger, nk, data, userId, gId) {
        var lbId = gId + "_leaderboard";
        var limit = data.limit || 20;
        var records = nk.leaderboardRecordsList(lbId, [], limit, data.cursor || undefined, 0);
        return { records: records.records || [], ownerRecords: records.ownerRecords || [] };
    }
    function joinOrCreateMatch(ctx, logger, nk, data, userId, gId) {
        return { success: true, message: "Matchmaking handled by client" };
    }
    function claimDailyReward(ctx, logger, nk, data, userId, gId) {
        var key = "daily_" + gId + "_" + userId;
        var state = Storage.readJson(nk, "daily_rewards", key, userId) || { lastClaimDate: "", streak: 0 };
        var today = new Date().toISOString().slice(0, 10);
        if (state.lastClaimDate === today)
            return { alreadyClaimed: true, streak: state.streak };
        state.streak = state.lastClaimDate ? state.streak + 1 : 1;
        if (state.streak > 7)
            state.streak = 1;
        state.lastClaimDate = today;
        var rewardAmount = state.streak * 10;
        WalletHelpers.addCurrency(nk, logger, ctx, userId, gId, "game", rewardAmount);
        Storage.writeJson(nk, "daily_rewards", key, userId, state);
        return { streak: state.streak, reward: rewardAmount };
    }
    function findFriends(ctx, logger, nk, data, userId, gId) {
        var friends = nk.friendsList(userId, 100, 0, "");
        var result = (friends.friends || []).map(function (f) {
            return { userId: f.user.userId, username: f.user.username, displayName: f.user.displayName };
        });
        return { friends: result };
    }
    function savePlayerData(ctx, logger, nk, data, userId, gId) {
        if (!data.data)
            throw new Error("data required");
        Storage.writeJson(nk, "player_data", gId + "_save", userId, data.data);
        return { success: true };
    }
    function loadPlayerData(ctx, logger, nk, data, userId, gId) {
        var saved = Storage.readJson(nk, "player_data", gId + "_save", userId);
        return { data: saved || {} };
    }
    function getItemCatalog(ctx, logger, nk, data, userId, gId) {
        var catalog = Storage.readSystemJson(nk, "game_catalogs", gId + "_catalog");
        return catalog || { items: [] };
    }
    function searchItems(ctx, logger, nk, data, userId, gId) {
        var catalog = Storage.readSystemJson(nk, "game_catalogs", gId + "_catalog") || { items: [] };
        var query = (data.query || "").toLowerCase();
        var results = catalog.items.filter(function (item) {
            return item.name && item.name.toLowerCase().indexOf(query) >= 0;
        });
        return { items: results };
    }
    function getQuizCategories(ctx, logger, nk, data, userId, gId) {
        var config = Storage.readSystemJson(nk, "game_configs", gId + "_quiz_categories");
        return config || { categories: [] };
    }
    function getWeaponStats(ctx, logger, nk, data, userId, gId) {
        var config = Storage.readSystemJson(nk, "game_configs", gId + "_weapon_stats");
        return config || { weapons: [] };
    }
    function refreshServerCache(ctx, logger, nk, data, userId, gId) {
        ConfigLoader.invalidateCache();
        return { success: true };
    }
    function guildCreate(ctx, logger, nk, data, userId, gId) {
        if (!data.name)
            throw new Error("name required");
        var group = nk.groupCreate(userId, data.name, userId, gId, data.description || "", data.avatarUrl || "", false, {}, data.maxMembers || 50);
        return { groupId: group.id, name: data.name };
    }
    function guildJoin(ctx, logger, nk, data, userId, gId) {
        if (!data.groupId)
            throw new Error("groupId required");
        nk.groupUserJoin(data.groupId, userId, ctx.username || "");
        return { success: true };
    }
    function guildLeave(ctx, logger, nk, data, userId, gId) {
        if (!data.groupId)
            throw new Error("groupId required");
        nk.groupUserLeave(data.groupId, userId, ctx.username || "");
        return { success: true };
    }
    function guildList(ctx, logger, nk, data, userId, gId) {
        var groups = nk.groupsList(data.name || "", gId, null, null, data.limit || 20, data.cursor || undefined);
        return { groups: groups.groups || [] };
    }
    function sendChannelMessage(ctx, logger, nk, data, userId, gId) {
        if (!data.channelId || !data.content)
            throw new Error("channelId and content required");
        nk.channelMessageSend(data.channelId, { message: data.content }, userId, ctx.username || "", true);
        return { success: true };
    }
    function logEvent(ctx, logger, nk, data, userId, gId) {
        var key = "ev_" + gId + "_" + userId + "_" + Date.now();
        Storage.writeJson(nk, Constants.ANALYTICS_COLLECTION, key, Constants.SYSTEM_USER_ID, {
            userId: userId, gameId: gId, event: data.eventName, data: data.eventData, timestamp: new Date().toISOString()
        }, 0, 0);
        return { success: true };
    }
    function trackSessionStart(ctx, logger, nk, data, userId, gId) {
        var key = "session_" + gId + "_" + userId;
        Storage.writeJson(nk, "sessions", key, userId, { gameId: gId, startedAt: new Date().toISOString(), platform: data.platform });
        EventBus.emit(nk, logger, ctx, EventBus.Events.SESSION_START, { userId: userId, gameId: gId });
        return { success: true };
    }
    function trackSessionEnd(ctx, logger, nk, data, userId, gId) {
        EventBus.emit(nk, logger, ctx, EventBus.Events.SESSION_END, { userId: userId, gameId: gId, duration: data.duration });
        return { success: true };
    }
    function getServerConfig(ctx, logger, nk, data, userId, gId) {
        var config = Storage.readSystemJson(nk, "game_configs", gId + "_server_config");
        return config || {};
    }
    function adminGrantItem(ctx, logger, nk, data, userId, gId) {
        var targetUserId = data.targetUserId || userId;
        return grantItem(ctx, logger, nk, data, targetUserId, gId);
    }
    function registerGameRpcs(initializer, prefix, gameId) {
        initializer.registerRpc(prefix + "update_user_profile", gameRpcHandler(gameId, updateUserProfile));
        initializer.registerRpc(prefix + "grant_currency", gameRpcHandler(gameId, grantCurrency));
        initializer.registerRpc(prefix + "spend_currency", gameRpcHandler(gameId, spendCurrency));
        initializer.registerRpc(prefix + "validate_purchase", gameRpcHandler(gameId, validatePurchase));
        initializer.registerRpc(prefix + "list_inventory", gameRpcHandler(gameId, listInventory));
        initializer.registerRpc(prefix + "grant_item", gameRpcHandler(gameId, grantItem));
        initializer.registerRpc(prefix + "consume_item", gameRpcHandler(gameId, consumeItem));
        initializer.registerRpc(prefix + "submit_score", gameRpcHandler(gameId, submitScore));
        initializer.registerRpc(prefix + "get_leaderboard", gameRpcHandler(gameId, getLeaderboard));
        initializer.registerRpc(prefix + "join_or_create_match", gameRpcHandler(gameId, joinOrCreateMatch));
        initializer.registerRpc(prefix + "claim_daily_reward", gameRpcHandler(gameId, claimDailyReward));
        initializer.registerRpc(prefix + "find_friends", gameRpcHandler(gameId, findFriends));
        initializer.registerRpc(prefix + "save_player_data", gameRpcHandler(gameId, savePlayerData));
        initializer.registerRpc(prefix + "load_player_data", gameRpcHandler(gameId, loadPlayerData));
        initializer.registerRpc(prefix + "get_item_catalog", gameRpcHandler(gameId, getItemCatalog));
        initializer.registerRpc(prefix + "search_items", gameRpcHandler(gameId, searchItems));
        initializer.registerRpc(prefix + "refresh_server_cache", gameRpcHandler(gameId, refreshServerCache));
        initializer.registerRpc(prefix + "guild_create", gameRpcHandler(gameId, guildCreate));
        initializer.registerRpc(prefix + "guild_join", gameRpcHandler(gameId, guildJoin));
        initializer.registerRpc(prefix + "guild_leave", gameRpcHandler(gameId, guildLeave));
        initializer.registerRpc(prefix + "guild_list", gameRpcHandler(gameId, guildList));
        initializer.registerRpc(prefix + "send_channel_message", gameRpcHandler(gameId, sendChannelMessage));
        initializer.registerRpc(prefix + "log_event", gameRpcHandler(gameId, logEvent));
        initializer.registerRpc(prefix + "track_session_start", gameRpcHandler(gameId, trackSessionStart));
        initializer.registerRpc(prefix + "track_session_end", gameRpcHandler(gameId, trackSessionEnd));
        initializer.registerRpc(prefix + "get_server_config", gameRpcHandler(gameId, getServerConfig));
        initializer.registerRpc(prefix + "admin_grant_item", gameRpcHandler(gameId, adminGrantItem));
    }
    function register(initializer) {
        registerGameRpcs(initializer, "quizverse_", "quizverse");
        // QuizVerse-specific
        initializer.registerRpc("quizverse_get_quiz_categories", gameRpcHandler("quizverse", getQuizCategories));
        registerGameRpcs(initializer, "lasttolive_", "lasttolive");
        // LastToLive-specific
        initializer.registerRpc("lasttolive_get_weapon_stats", gameRpcHandler("lasttolive", getWeaponStats));
    }
    LegacyMultiGame.register = register;
})(LegacyMultiGame || (LegacyMultiGame = {}));
var LegacyPlayer;
(function (LegacyPlayer) {
    function getPlayerMetadata(nk, userId) {
        var data = Storage.readJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId);
        return data || {};
    }
    function savePlayerMetadata(nk, userId, metadata) {
        metadata.updatedAt = new Date().toISOString();
        Storage.writeJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId, metadata, 2, 1);
    }
    function rpcGetPlayerPortfolio(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var targetUserId = data.userId || userId;
        var metadata = getPlayerMetadata(nk, targetUserId);
        var account = nk.accountGetId(targetUserId);
        var user = account.user;
        return RpcHelpers.successResponse({
            userId: targetUserId,
            username: user ? user.username : "",
            displayName: user ? user.displayName : metadata.displayName || "",
            avatarUrl: user ? user.avatarUrl : metadata.avatarUrl || "",
            metadata: metadata,
            createTime: user ? user.createTime : 0
        });
    }
    function rpcUpdatePlayerMetadataUnified(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var metadata = getPlayerMetadata(nk, userId);
        if (data.displayName !== undefined)
            metadata.displayName = data.displayName;
        if (data.avatarUrl !== undefined)
            metadata.avatarUrl = data.avatarUrl;
        if (data.country !== undefined)
            metadata.country = data.country;
        if (data.language !== undefined)
            metadata.language = data.language;
        if (data.timezone !== undefined)
            metadata.timezone = data.timezone;
        if (data.bio !== undefined)
            metadata.bio = data.bio;
        if (data.favoriteGame !== undefined)
            metadata.favoriteGame = data.favoriteGame;
        if (data.customData !== undefined) {
            if (!metadata.customData)
                metadata.customData = {};
            for (var k in data.customData) {
                metadata.customData[k] = data.customData[k];
            }
        }
        if (data.displayName || data.avatarUrl) {
            try {
                nk.accountUpdateId(userId, null, data.displayName || null, data.avatarUrl || null, null, null, null);
            }
            catch (err) {
                logger.warn("[Player] Failed to update account: " + err.message);
            }
        }
        savePlayerMetadata(nk, userId, metadata);
        return RpcHelpers.successResponse({ metadata: metadata });
    }
    function rpcChangeUsername(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.username)
            return RpcHelpers.errorResponse("username required");
        try {
            nk.accountUpdateId(userId, data.username, null, null, null, null, null);
            return RpcHelpers.successResponse({ username: data.username });
        }
        catch (err) {
            return RpcHelpers.errorResponse("Failed to change username: " + err.message);
        }
    }
    function rpcGetPlayerMetadata(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var targetUserId = data.userId || userId;
        var metadata = getPlayerMetadata(nk, targetUserId);
        return RpcHelpers.successResponse({ metadata: metadata });
    }
    function rpcAdminDeletePlayerMetadata(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId)
            return RpcHelpers.errorResponse("userId required");
        Storage.deleteRecord(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", data.userId);
        return RpcHelpers.successResponse({ deleted: true });
    }
    function rpcCheckGeoAndUpdateProfile(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var metadata = getPlayerMetadata(nk, userId);
        if (data.country)
            metadata.country = data.country;
        if (data.timezone)
            metadata.timezone = data.timezone;
        if (data.language)
            metadata.language = data.language;
        savePlayerMetadata(nk, userId, metadata);
        return RpcHelpers.successResponse({ metadata: metadata });
    }
    function rpcCreateOrSyncUser(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var metadata = getPlayerMetadata(nk, userId);
        if (data.displayName)
            metadata.displayName = data.displayName;
        if (data.avatarUrl)
            metadata.avatarUrl = data.avatarUrl;
        savePlayerMetadata(nk, userId, metadata);
        var account = nk.accountGetId(userId);
        return RpcHelpers.successResponse({
            userId: userId,
            username: account.user ? account.user.username : "",
            metadata: metadata,
            synced: true
        });
    }
    function register(initializer) {
        initializer.registerRpc("get_player_portfolio", rpcGetPlayerPortfolio);
        initializer.registerRpc("rpc_update_player_metadata", rpcUpdatePlayerMetadataUnified);
        initializer.registerRpc("rpc_change_username", rpcChangeUsername);
        initializer.registerRpc("get_player_metadata", rpcGetPlayerMetadata);
        initializer.registerRpc("admin_delete_player_metadata", rpcAdminDeletePlayerMetadata);
        initializer.registerRpc("check_geo_and_update_profile", rpcCheckGeoAndUpdateProfile);
        initializer.registerRpc("create_or_sync_user", rpcCreateOrSyncUser);
    }
    LegacyPlayer.register = register;
})(LegacyPlayer || (LegacyPlayer = {}));
var LegacyPush;
(function (LegacyPush) {
    function getPushTokens(nk, userId) {
        var key = "token_" + userId;
        var data = Storage.readJson(nk, Constants.PUSH_TOKENS_COLLECTION, key, userId);
        return data || { tokens: [] };
    }
    function savePushTokens(nk, userId, data) {
        var key = "token_" + userId;
        Storage.writeJson(nk, Constants.PUSH_TOKENS_COLLECTION, key, userId, data);
    }
    function rpcPushRegisterToken(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var token = data.token;
            var platform = data.platform || "unknown";
            if (!token)
                return RpcHelpers.errorResponse("token required");
            var tokensData = getPushTokens(nk, userId);
            var now = Math.floor(Date.now() / 1000);
            var existing = tokensData.tokens.find(function (t) { return t.token === token; });
            if (existing) {
                existing.platform = platform;
                existing.updatedAt = now;
            }
            else {
                tokensData.tokens.push({ token: token, platform: platform, updatedAt: now });
            }
            savePushTokens(nk, userId, tokensData);
            return RpcHelpers.successResponse({ success: true });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to register token");
        }
    }
    function rpcPushSendEvent(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var targetUserId = data.userId || data.targetUserId;
            var subject = data.subject || "push_event";
            var content = data.content || {};
            if (!targetUserId)
                return RpcHelpers.errorResponse("userId required");
            nk.notificationsSend([{
                    userId: targetUserId,
                    subject: subject,
                    content: content,
                    code: data.code || 0,
                    persistent: data.persistent !== false
                }]);
            return RpcHelpers.successResponse({ success: true });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to send event");
        }
    }
    function rpcPushGetEndpoints(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var targetUserId = data.userId || userId;
            var tokensData = getPushTokens(nk, targetUserId);
            var endpoints = tokensData.tokens.map(function (t) {
                return { token: t.token, platform: t.platform };
            });
            return RpcHelpers.successResponse({ endpoints: endpoints });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to get endpoints");
        }
    }
    function register(initializer) {
        initializer.registerRpc("push_register_token", rpcPushRegisterToken);
        initializer.registerRpc("push_send_event", rpcPushSendEvent);
        initializer.registerRpc("push_get_endpoints", rpcPushGetEndpoints);
    }
    LegacyPush.register = register;
})(LegacyPush || (LegacyPush = {}));
var LegacyQuestsEconomyBridge;
(function (LegacyQuestsEconomyBridge) {
    function getBridgeConfig(nk) {
        var config = Storage.readSystemJson(nk, Constants.WALLETS_COLLECTION, "bridge_config");
        return config || { apiBaseUrl: "https://quests-economy-api.intelliversex.com" };
    }
    function apiCall(nk, endpoint, data) {
        var config = getBridgeConfig(nk);
        var url = config.apiBaseUrl + endpoint;
        if (config.webhookSecret) {
            return HttpClient.signedPost(nk, url, data, config.webhookSecret);
        }
        return HttpClient.postJson(nk, url, data);
    }
    // IntelliDraws RPCs
    function rpcIntelliDrawsList(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var result = apiCall(nk, "/intellidraws/list", { userId: userId });
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("IntelliDraws list failed: " + err.message);
        }
    }
    function rpcIntelliDrawsWinners(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var result = apiCall(nk, "/intellidraws/winners", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("IntelliDraws winners failed: " + err.message);
        }
    }
    function rpcIntelliDrawsEnter(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            data.userId = userId;
            var result = apiCall(nk, "/intellidraws/enter", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("IntelliDraws enter failed: " + err.message);
        }
    }
    function rpcIntelliDrawsPast(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var result = apiCall(nk, "/intellidraws/past", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("IntelliDraws past failed: " + err.message);
        }
    }
    // Conversion ratio RPCs
    function rpcConversionRatioSet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var result = apiCall(nk, "/conversion/ratio/set", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("Conversion ratio set failed: " + err.message);
        }
    }
    function rpcConversionRatioGet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var result = apiCall(nk, "/conversion/ratio/get", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("Conversion ratio get failed: " + err.message);
        }
    }
    // Game-to-global conversion RPCs
    function rpcGameToGlobalConvert(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            data.userId = userId;
            var result = apiCall(nk, "/wallet/game-to-global", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("Game to global convert failed: " + err.message);
        }
    }
    function rpcGameToGlobalPreview(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var result = apiCall(nk, "/wallet/game-to-global/preview", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("Game to global preview failed: " + err.message);
        }
    }
    function register(initializer) {
        initializer.registerRpc("intellidraws_list", rpcIntelliDrawsList);
        initializer.registerRpc("intellidraws_winners", rpcIntelliDrawsWinners);
        initializer.registerRpc("intellidraws_enter", rpcIntelliDrawsEnter);
        initializer.registerRpc("intellidraws_past", rpcIntelliDrawsPast);
        initializer.registerRpc("game_to_global_convert", rpcGameToGlobalConvert);
        initializer.registerRpc("game_to_global_preview", rpcGameToGlobalPreview);
        initializer.registerRpc("conversion_ratio_set", rpcConversionRatioSet);
        initializer.registerRpc("conversion_ratio_get", rpcConversionRatioGet);
    }
    LegacyQuestsEconomyBridge.register = register;
})(LegacyQuestsEconomyBridge || (LegacyQuestsEconomyBridge = {}));
var LegacyQuiz;
(function (LegacyQuiz) {
    function getStats(nk, userId) {
        return Storage.readJson(nk, Constants.QUIZ_RESULTS_COLLECTION, "stats_" + userId, userId);
    }
    function saveStats(nk, userId, stats) {
        Storage.writeJson(nk, Constants.QUIZ_RESULTS_COLLECTION, "stats_" + userId, userId, stats);
    }
    function rpcSubmitResult(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var score = Math.max(0, Number(data.score) || 0);
        var totalQuestions = Math.max(1, Number(data.totalQuestions) || 1);
        var correctAnswers = Math.min(totalQuestions, Math.max(0, Number(data.correctAnswers) || 0));
        var category = data.category || "general";
        var ts = Math.floor(Date.now() / 1000);
        var result = {
            score: score,
            totalQuestions: totalQuestions,
            correctAnswers: correctAnswers,
            category: category,
            timestamp: ts
        };
        var resultKey = "result_" + userId + "_" + ts;
        Storage.writeJson(nk, Constants.QUIZ_RESULTS_COLLECTION, resultKey, userId, result);
        var stats = getStats(nk, userId) || {
            totalGames: 0,
            totalCorrect: 0,
            totalQuestions: 0,
            averageScore: 0,
            lastPlayedAt: 0
        };
        var oldGames = stats.totalGames;
        stats.totalGames += 1;
        stats.totalCorrect += correctAnswers;
        stats.totalQuestions += totalQuestions;
        stats.averageScore = oldGames > 0
            ? Math.round((stats.averageScore * oldGames + score) / stats.totalGames * 100) / 100
            : score;
        stats.lastPlayedAt = ts;
        saveStats(nk, userId, stats);
        return RpcHelpers.successResponse({ result: result, stats: stats });
    }
    function rpcGetHistory(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var limit = Math.min(50, Math.max(1, Number(data.limit) || 20));
        var cursor = data.cursor || "";
        var listResult = Storage.listUserRecords(nk, Constants.QUIZ_RESULTS_COLLECTION, userId, limit, cursor);
        var records = listResult.records || [];
        var results = [];
        for (var i = 0; i < records.length; i++) {
            var rec = records[i];
            if (rec.key && rec.key.indexOf("result_") === 0 && rec.value) {
                results.push(rec.value);
            }
        }
        results.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
        return RpcHelpers.successResponse({ results: results, cursor: listResult.cursor });
    }
    function rpcGetStats(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var stats = getStats(nk, userId);
        if (!stats) {
            stats = {
                totalGames: 0,
                totalCorrect: 0,
                totalQuestions: 0,
                averageScore: 0,
                lastPlayedAt: 0
            };
        }
        return RpcHelpers.successResponse({
            totalGames: stats.totalGames,
            totalCorrect: stats.totalCorrect,
            totalQuestions: stats.totalQuestions,
            averageScore: stats.averageScore,
            lastPlayedAt: stats.lastPlayedAt
        });
    }
    function rpcCheckDailyCompletion(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var dateStr = data.date;
        if (!dateStr || typeof dateStr !== "string") {
            var d = new Date();
            var pad2 = function (n) { return n < 10 ? "0" + n : String(n); };
            dateStr = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
        }
        var listResult = Storage.listUserRecords(nk, Constants.QUIZ_RESULTS_COLLECTION, userId, 100, "");
        var records = listResult.records || [];
        var dayStart = new Date(dateStr).getTime() / 1000;
        var dayEnd = dayStart + 86400;
        var completedToday = false;
        for (var i = 0; i < records.length; i++) {
            var rec = records[i];
            if (rec.key && rec.key.indexOf("result_") === 0 && rec.value) {
                var val = rec.value;
                if (val.timestamp >= dayStart && val.timestamp < dayEnd) {
                    completedToday = true;
                    break;
                }
            }
        }
        return RpcHelpers.successResponse({ date: dateStr, completed: completedToday });
    }
    function register(initializer) {
        initializer.registerRpc("quiz_submit_result", rpcSubmitResult);
        initializer.registerRpc("quiz_get_history", rpcGetHistory);
        initializer.registerRpc("quiz_get_stats", rpcGetStats);
        initializer.registerRpc("quiz_check_daily_completion", rpcCheckDailyCompletion);
    }
    LegacyQuiz.register = register;
})(LegacyQuiz || (LegacyQuiz = {}));
var LegacyWallet;
(function (LegacyWallet) {
    var DEFAULT_REWARD_CONFIG = {
        game_name: "Default",
        score_to_coins_multiplier: 0.1,
        min_score_for_reward: 0,
        max_reward_per_match: 100000,
        currency: "coins",
        bonus_thresholds: [],
        streak_multipliers: {}
    };
    function getGlobalApiConfig(nk) {
        var config = Storage.readSystemJson(nk, Constants.WALLETS_COLLECTION, "wallet_api_config");
        return config && config.url ? config : null;
    }
    function getConversionRatios(nk) {
        var data = Storage.readSystemJson(nk, Constants.WALLETS_COLLECTION, "conversion_rate");
        return (data && data.ratios) ? data.ratios : {};
    }
    function getRewardConfig(nk, gameId) {
        var cfg = Storage.readSystemJson(nk, Constants.WALLETS_COLLECTION, "reward_config_" + gameId);
        if (!cfg)
            return DEFAULT_REWARD_CONFIG;
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
    function proxyGlobalApi(nk, logger, userId, endpoint, body, gameId) {
        var config = getGlobalApiConfig(nk);
        if (!config || !config.url) {
            throw new Error("Global wallet API not configured. Store wallet_api_config in wallets collection.");
        }
        var url = config.url.replace(/\/$/, "") + "/game-bridge/s2s/wallet/" + endpoint;
        var bodyStr = JSON.stringify(body || {});
        var headers = {
            "Content-Type": "application/json",
            "X-Source": "nakama-rpc",
            "X-User-Id": userId,
            "X-Game-Id": gameId || config.defaultGameId || "00000000-0000-0000-0000-000000000000"
        };
        if (config.webhookSecret) {
            var sig = nk.hmacSha256Hash(config.webhookSecret, bodyStr);
            headers["X-Webhook-Signature"] = sig;
        }
        return HttpClient.postJson(nk, url, body, headers);
    }
    function getGlobalWallet(nk, userId) {
        var key = "global_" + userId;
        var wallet = Storage.readJson(nk, Constants.WALLETS_COLLECTION, key, userId);
        if (!wallet) {
            wallet = { userId: userId, currencies: { global: 0, xut: 0, xp: 0 }, items: {} };
        }
        if (wallet.currencies) {
            if (wallet.currencies.global === undefined)
                wallet.currencies.global = wallet.currencies.xut || 0;
            if (wallet.currencies.xut === undefined)
                wallet.currencies.xut = wallet.currencies.global || 0;
        }
        return wallet;
    }
    function saveGlobalWallet(nk, userId, wallet) {
        var key = "global_" + userId;
        Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, userId, wallet);
    }
    // ---- RPC implementations ----
    function rpcGetUserWallet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var userId = ctx.userId || data.userId || data.sub;
            var username = ctx.username || data.username || userId;
            if (!userId)
                return RpcHelpers.errorResponse("User ID required");
            var key = "registry_" + userId;
            var registry = Storage.readJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID);
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
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "get_user_wallet failed");
        }
    }
    LegacyWallet.rpcGetUserWallet = rpcGetUserWallet;
    function rpcLinkWalletToGame(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.gameId;
            if (!gameId)
                return RpcHelpers.errorResponse("gameId required");
            var userId = ctx.userId || data.userId || data.sub;
            var username = ctx.username || data.username || userId;
            if (!userId)
                return RpcHelpers.errorResponse("User ID required");
            var key = "registry_" + userId;
            var registry = Storage.readJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID);
            if (!registry) {
                registry = { walletId: userId, userId: userId, gamesLinked: [] };
            }
            if (!registry.gamesLinked)
                registry.gamesLinked = [];
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
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "link_wallet_to_game failed");
        }
    }
    LegacyWallet.rpcLinkWalletToGame = rpcLinkWalletToGame;
    function rpcGetWalletRegistry(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var limit = data.limit || 100;
            var result = nk.storageList(Constants.SYSTEM_USER_ID, Constants.WALLETS_COLLECTION, limit, "");
            var wallets = [];
            if (result && result.objects) {
                for (var i = 0; i < result.objects.length; i++) {
                    var obj = result.objects[i];
                    if (obj.key && obj.key.indexOf("registry_") === 0 && obj.value) {
                        wallets.push(obj.value);
                    }
                }
            }
            return RpcHelpers.successResponse({ wallets: wallets, count: wallets.length });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "get_wallet_registry failed");
        }
    }
    LegacyWallet.rpcGetWalletRegistry = rpcGetWalletRegistry;
    function rpcWalletGetAll(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var globalWallet = getGlobalWallet(nk, userId);
            var result = Storage.listUserRecords(nk, Constants.WALLETS_COLLECTION, userId, 100);
            var gameWallets = [];
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
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_get_all failed");
        }
    }
    LegacyWallet.rpcWalletGetAll = rpcWalletGetAll;
    function rpcWalletUpdateGlobal(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var v = RpcHelpers.validatePayload(data, ["currency", "amount", "operation"]);
            if (!v.valid)
                return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
            var userId = RpcHelpers.requireUserId(ctx);
            var wallet = getGlobalWallet(nk, userId);
            if (!wallet.currencies[data.currency])
                wallet.currencies[data.currency] = 0;
            var op = data.operation;
            var amt = Number(data.amount);
            if (op === "add")
                wallet.currencies[data.currency] += amt;
            else if (op === "subtract") {
                wallet.currencies[data.currency] -= amt;
                if (wallet.currencies[data.currency] < 0)
                    wallet.currencies[data.currency] = 0;
            }
            else
                return RpcHelpers.errorResponse("Invalid operation");
            saveGlobalWallet(nk, userId, wallet);
            return RpcHelpers.successResponse({
                userId: userId,
                currency: data.currency,
                newBalance: wallet.currencies[data.currency],
                timestamp: new Date().toISOString()
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_update_global failed");
        }
    }
    LegacyWallet.rpcWalletUpdateGlobal = rpcWalletUpdateGlobal;
    function rpcWalletUpdateGameWallet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var v = RpcHelpers.validatePayload(data, ["gameId", "currency", "amount", "operation"]);
            if (!v.valid)
                return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
            var userId = RpcHelpers.requireUserId(ctx);
            var wallet = WalletHelpers.getGameWallet(nk, userId, data.gameId);
            var currency = data.currency;
            var currenciesToUpdate = (currency === "game" || currency === "tokens") ? ["game", "tokens"] : [currency];
            var amt = Number(data.amount);
            var op = data.operation;
            for (var i = 0; i < currenciesToUpdate.length; i++) {
                var c = currenciesToUpdate[i];
                if (wallet.currencies[c] === undefined)
                    wallet.currencies[c] = 0;
                if (op === "add")
                    wallet.currencies[c] += amt;
                else if (op === "subtract") {
                    wallet.currencies[c] -= amt;
                    if (wallet.currencies[c] < 0)
                        wallet.currencies[c] = 0;
                }
                else
                    return RpcHelpers.errorResponse("Invalid operation");
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
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_update_game_wallet failed");
        }
    }
    LegacyWallet.rpcWalletUpdateGameWallet = rpcWalletUpdateGameWallet;
    function rpcWalletTransferBetweenGameWallets(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var v = RpcHelpers.validatePayload(data, ["fromGameId", "toGameId", "currency", "amount"]);
            if (!v.valid)
                return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
            var userId = RpcHelpers.requireUserId(ctx);
            var from = WalletHelpers.getGameWallet(nk, userId, data.fromGameId);
            var to = WalletHelpers.getGameWallet(nk, userId, data.toGameId);
            var amt = Number(data.amount);
            var cur = data.currency;
            var bal = from.currencies[cur] || 0;
            if (bal < amt)
                return RpcHelpers.errorResponse("Insufficient balance in source wallet");
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
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_transfer_between_game_wallets failed");
        }
    }
    LegacyWallet.rpcWalletTransferBetweenGameWallets = rpcWalletTransferBetweenGameWallets;
    function rpcWalletGetBalances(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.gameId)
                return RpcHelpers.errorResponse("gameId required");
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
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_get_balances failed");
        }
    }
    LegacyWallet.rpcWalletGetBalances = rpcWalletGetBalances;
    function rpcWalletConvertPreview(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.gameId)
                return RpcHelpers.errorResponse("gameId required");
            var userId = RpcHelpers.requireUserId(ctx);
            var ratios = getConversionRatios(nk);
            var ratio = ratios[data.gameId] || 0;
            if (ratio <= 0)
                return RpcHelpers.errorResponse("No conversion ratio configured for game");
            var wallet = WalletHelpers.getGameWallet(nk, userId, data.gameId);
            var gameBal = wallet.currencies.game || wallet.currencies.tokens || 0;
            var reqAmt = data.amount != null ? Number(data.amount) : gameBal;
            if (reqAmt <= 0)
                return RpcHelpers.errorResponse("No game coins to convert");
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
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_convert_preview failed");
        }
    }
    LegacyWallet.rpcWalletConvertPreview = rpcWalletConvertPreview;
    function rpcWalletConvertToGlobal(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var v = RpcHelpers.validatePayload(data, ["gameId", "amount"]);
            if (!v.valid)
                return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
            var userId = RpcHelpers.requireUserId(ctx);
            var amt = Number(data.amount);
            if (isNaN(amt) || amt <= 0)
                return RpcHelpers.errorResponse("amount must be positive");
            var ratios = getConversionRatios(nk);
            var ratio = ratios[data.gameId] || 0;
            if (ratio <= 0)
                return RpcHelpers.errorResponse("No conversion ratio configured");
            if (amt < ratio)
                return RpcHelpers.errorResponse("Minimum conversion is " + ratio + " game coins");
            var wallet = WalletHelpers.getGameWallet(nk, userId, data.gameId);
            var gameBal = wallet.currencies.game || wallet.currencies.tokens || 0;
            if (gameBal < amt)
                return RpcHelpers.errorResponse("Insufficient game balance");
            var globalEarned = Math.floor(amt / ratio);
            var coinsBurned = globalEarned * ratio;
            var keys = ["game", "tokens"];
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                if (wallet.currencies[k] !== undefined) {
                    wallet.currencies[k] -= coinsBurned;
                    if (wallet.currencies[k] < 0)
                        wallet.currencies[k] = 0;
                }
            }
            WalletHelpers.saveGameWallet(nk, wallet);
            var newGlobal = null;
            try {
                var res = proxyGlobalApi(nk, logger, userId, "earn", {
                    amount: globalEarned,
                    sourceType: "game_to_global_conversion",
                    sourceId: data.gameId,
                    description: "Converted " + coinsBurned + " game coins -> " + globalEarned + " global points"
                }, data.gameId);
                newGlobal = res && res.newBalance != null ? res.newBalance : null;
            }
            catch (_) { /* non-critical */ }
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
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_convert_to_global failed");
        }
    }
    LegacyWallet.rpcWalletConvertToGlobal = rpcWalletConvertToGlobal;
    function rpcWalletConversionRate(ctx, logger, nk, payload) {
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
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_conversion_rate failed");
        }
    }
    LegacyWallet.rpcWalletConversionRate = rpcWalletConversionRate;
    function rpcGlobalToGameConvert(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.gameId || "";
            var amt = parseInt(String(data.amount), 10) || 0;
            if (!gameId)
                return RpcHelpers.errorResponse("gameId required");
            if (amt <= 0)
                return RpcHelpers.errorResponse("amount must be > 0");
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
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "global_to_game_convert failed");
        }
    }
    LegacyWallet.rpcGlobalToGameConvert = rpcGlobalToGameConvert;
    function rpcGlobalWalletBalance(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var result = proxyGlobalApi(nk, logger, userId, "balance", {});
            return RpcHelpers.successResponse({ userId: userId, balance: result.balance || result || 0 });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "global_wallet_balance failed");
        }
    }
    LegacyWallet.rpcGlobalWalletBalance = rpcGlobalWalletBalance;
    function rpcGlobalWalletEarn(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.amount || data.amount <= 0)
                return RpcHelpers.errorResponse("amount required and must be > 0");
            var body = {
                amount: data.amount,
                sourceType: data.sourceType || "nakama_rpc",
                sourceId: data.sourceId || ("rpc:" + userId),
                description: data.description || "Earn via Nakama RPC"
            };
            var result = proxyGlobalApi(nk, logger, userId, "earn", body, data.gameId);
            return RpcHelpers.successResponse({ userId: userId, result: result });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "global_wallet_earn failed");
        }
    }
    LegacyWallet.rpcGlobalWalletEarn = rpcGlobalWalletEarn;
    function rpcGlobalWalletSpend(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.amount || data.amount <= 0)
                return RpcHelpers.errorResponse("amount required and must be > 0");
            var body = {
                amount: data.amount,
                sourceType: data.sourceType || "nakama_rpc",
                sourceId: data.sourceId || ("rpc:" + userId),
                description: data.description || "Spend via Nakama RPC"
            };
            var result = proxyGlobalApi(nk, logger, userId, "spend", body, data.gameId);
            return RpcHelpers.successResponse({ userId: userId, result: result });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "global_wallet_spend failed");
        }
    }
    LegacyWallet.rpcGlobalWalletSpend = rpcGlobalWalletSpend;
    function rpcGlobalWalletHistory(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var body = { page: data.page || 1, limit: data.limit || 20 };
            var result = proxyGlobalApi(nk, logger, userId, "history", body);
            return RpcHelpers.successResponse({ userId: userId, result: result });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "global_wallet_history failed");
        }
    }
    LegacyWallet.rpcGlobalWalletHistory = rpcGlobalWalletHistory;
    function rpcCreatePlayerWallet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var deviceId = data.device_id || data.deviceId;
            var gameId = data.game_id || data.gameId;
            if (!deviceId || !gameId)
                return RpcHelpers.errorResponse("device_id and game_id required");
            var userId = ctx.userId || deviceId;
            var gameWallet = WalletHelpers.getGameWallet(nk, userId, gameId);
            var globalWallet = getGlobalWallet(nk, userId);
            var key = "registry_" + userId;
            var registry = Storage.readJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID);
            if (!registry) {
                registry = { walletId: userId, userId: userId, gamesLinked: [gameId], status: "active", createdAt: new Date().toISOString() };
                Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID, registry);
            }
            else if (registry.gamesLinked && registry.gamesLinked.indexOf(gameId) === -1) {
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
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "create_player_wallet failed");
        }
    }
    LegacyWallet.rpcCreatePlayerWallet = rpcCreatePlayerWallet;
    function rpcUpdateWalletBalance(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var deviceId = data.device_id || data.deviceId;
            var gameId = data.game_id || data.gameId;
            if (!deviceId || !gameId)
                return RpcHelpers.errorResponse("device_id and game_id required");
            if (data.balance === undefined || data.balance === null)
                return RpcHelpers.errorResponse("balance required");
            var userId = ctx.userId || deviceId;
            var bal = Number(data.balance);
            if (isNaN(bal) || bal < 0)
                return RpcHelpers.errorResponse("balance must be non-negative");
            var walletType = data.wallet_type || data.walletType || "game";
            if (walletType === "global") {
                var gw = getGlobalWallet(nk, userId);
                gw.currencies.global = gw.currencies.xut = bal;
                saveGlobalWallet(nk, userId, gw);
                return RpcHelpers.successResponse({ wallet_type: "global", balance: bal, message: "Wallet balance updated" });
            }
            else {
                var w = WalletHelpers.getGameWallet(nk, userId, gameId);
                w.currencies.game = w.currencies.tokens = bal;
                WalletHelpers.saveGameWallet(nk, w);
                return RpcHelpers.successResponse({ wallet_type: "game", balance: bal, message: "Wallet balance updated" });
            }
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "update_wallet_balance failed");
        }
    }
    LegacyWallet.rpcUpdateWalletBalance = rpcUpdateWalletBalance;
    function rpcGetWalletBalance(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var deviceId = data.device_id || data.deviceId;
            var gameId = data.game_id || data.gameId;
            if (!deviceId || !gameId)
                return RpcHelpers.errorResponse("device_id and game_id required");
            var userId = ctx.userId || deviceId;
            var gameWallet = WalletHelpers.getGameWallet(nk, userId, gameId);
            var globalWallet = getGlobalWallet(nk, userId);
            return RpcHelpers.successResponse({
                game_wallet: { wallet_id: "wallet_" + userId + "_" + gameId, balance: gameWallet.currencies.game || 0, currency: "game", game_id: gameId },
                global_wallet: { wallet_id: "global_" + userId, balance: globalWallet.currencies.global || 0, currency: "global" },
                device_id: deviceId,
                game_id: gameId
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "get_wallet_balance failed");
        }
    }
    LegacyWallet.rpcGetWalletBalance = rpcGetWalletBalance;
    function rpcCreateOrGetWallet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var deviceId = data.device_id || data.deviceId;
            var gameId = data.game_id || data.gameId;
            if (!deviceId || !gameId)
                return RpcHelpers.errorResponse("device_id and game_id required");
            var userId = ctx.userId || deviceId;
            var gameWallet = WalletHelpers.getGameWallet(nk, userId, gameId);
            var globalWallet = getGlobalWallet(nk, userId);
            return RpcHelpers.successResponse({
                game_wallet: { wallet_id: "wallet_" + userId + "_" + gameId, balance: gameWallet.currencies.game || 0, currency: "game", game_id: gameId },
                global_wallet: { wallet_id: "global_" + userId, balance: globalWallet.currencies.global || 0, currency: "global" }
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "create_or_get_wallet failed");
        }
    }
    LegacyWallet.rpcCreateOrGetWallet = rpcCreateOrGetWallet;
    function calculateScoreReward(nk, gameId, score, currentStreak) {
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
            var keys = Object.keys(config.streak_multipliers).map(Number).sort(function (a, b) { return b - a; });
            for (var i = 0; i < keys.length; i++) {
                if (currentStreak >= keys[i]) {
                    streakMult = config.streak_multipliers[keys[i]];
                    break;
                }
            }
        }
        var rewardWithStreak = Math.floor(baseReward * streakMult);
        var bonuses = [];
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
    function rpcCalculateScoreReward(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.game_id || data.gameId;
            if (!gameId)
                return RpcHelpers.errorResponse("game_id required");
            if (data.score === undefined && data.score !== 0)
                return RpcHelpers.errorResponse("score required");
            var score = parseInt(String(data.score), 10) || 0;
            var streak = data.current_streak != null ? parseInt(String(data.current_streak), 10) || 0 : 0;
            var result = calculateScoreReward(nk, gameId, score, streak);
            return RpcHelpers.successResponse({
                reward: result.reward,
                currency: result.currency,
                bonuses: result.bonuses,
                details: result.details
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "calculate_score_reward failed");
        }
    }
    LegacyWallet.rpcCalculateScoreReward = rpcCalculateScoreReward;
    function rpcUpdateGameRewardConfig(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.game_id || data.gameId;
            if (!gameId)
                return RpcHelpers.errorResponse("game_id required");
            var config = data.config;
            if (!config)
                return RpcHelpers.errorResponse("config object required");
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
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "update_game_reward_config failed");
        }
    }
    LegacyWallet.rpcUpdateGameRewardConfig = rpcUpdateGameRewardConfig;
    function register(initializer) {
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
    LegacyWallet.register = register;
})(LegacyWallet || (LegacyWallet = {}));
var SatoriAudiences;
(function (SatoriAudiences) {
    function getAudienceDefinitions(nk) {
        var custom = ConfigLoader.loadSatoriConfig(nk, "audiences", {});
        return applyDefaults(custom);
    }
    function applyDefaults(audiences) {
        if (!audiences["new_players"]) {
            audiences["new_players"] = {
                id: "new_players",
                name: "New Players",
                description: "Players who joined in the last 7 days",
                rule: {
                    combinator: "and",
                    filters: [{ property: "first_seen_days_ago", operator: "lte", value: "7" }]
                },
                createdAt: 0,
                updatedAt: 0
            };
        }
        if (!audiences["returning_players"]) {
            audiences["returning_players"] = {
                id: "returning_players",
                name: "Returning Players",
                description: "Players with 3+ sessions",
                rule: {
                    combinator: "and",
                    filters: [{ property: "session_count", operator: "gte", value: "3" }]
                },
                createdAt: 0,
                updatedAt: 0
            };
        }
        if (!audiences["spenders"]) {
            audiences["spenders"] = {
                id: "spenders",
                name: "Spenders",
                description: "Players who have spent money",
                rule: {
                    combinator: "and",
                    filters: [{ property: "total_spend", operator: "gt", value: "0" }]
                },
                createdAt: 0,
                updatedAt: 0
            };
        }
        return audiences;
    }
    function isInAudience(nk, userId, audienceId) {
        var audiences = getAudienceDefinitions(nk);
        var def = audiences[audienceId];
        if (!def)
            return false;
        if (def.excludeIds && def.excludeIds.indexOf(userId) >= 0)
            return false;
        if (def.includeIds && def.includeIds.indexOf(userId) >= 0)
            return true;
        if (def.samplePct !== undefined && def.samplePct < 100) {
            var hash = 0;
            var seed = userId + ":" + audienceId;
            for (var c = 0; c < seed.length; c++) {
                hash = ((hash << 5) - hash) + seed.charCodeAt(c);
                hash = hash & 0x7FFFFFFF;
            }
            if ((hash % 100) >= def.samplePct)
                return false;
        }
        var props = SatoriIdentities.getAllProperties(nk, userId);
        var allProps = {};
        for (var k in props.defaultProperties)
            allProps[k] = props.defaultProperties[k];
        for (var ck in props.customProperties)
            allProps[ck] = props.customProperties[ck];
        for (var pk in props.computedProperties)
            allProps[pk] = props.computedProperties[pk];
        // Add computed time-based properties
        if (allProps["first_seen"]) {
            var firstSeen = new Date(allProps["first_seen"]).getTime();
            var daysSince = Math.floor((Date.now() - firstSeen) / 86400000);
            allProps["first_seen_days_ago"] = String(daysSince);
        }
        return evaluateRule(allProps, def.rule);
    }
    SatoriAudiences.isInAudience = isInAudience;
    function evaluateRule(props, rule) {
        var results = [];
        if (rule.filters) {
            for (var i = 0; i < rule.filters.length; i++) {
                results.push(evaluateFilter(props, rule.filters[i]));
            }
        }
        if (rule.rules) {
            for (var j = 0; j < rule.rules.length; j++) {
                results.push(evaluateRule(props, rule.rules[j]));
            }
        }
        if (results.length === 0)
            return true;
        if (rule.combinator === "or") {
            for (var r = 0; r < results.length; r++) {
                if (results[r])
                    return true;
            }
            return false;
        }
        for (var a = 0; a < results.length; a++) {
            if (!results[a])
                return false;
        }
        return true;
    }
    function evaluateFilter(props, filter) {
        var propValue = props[filter.property];
        switch (filter.operator) {
            case "exists": return propValue !== undefined && propValue !== null;
            case "not_exists": return propValue === undefined || propValue === null;
            case "eq": return propValue === filter.value;
            case "neq": return propValue !== filter.value;
            case "gt": return parseFloat(propValue || "0") > parseFloat(filter.value);
            case "gte": return parseFloat(propValue || "0") >= parseFloat(filter.value);
            case "lt": return parseFloat(propValue || "0") < parseFloat(filter.value);
            case "lte": return parseFloat(propValue || "0") <= parseFloat(filter.value);
            case "contains": return (propValue || "").indexOf(filter.value) >= 0;
            case "not_contains": return (propValue || "").indexOf(filter.value) < 0;
            case "in": return filter.value.split(",").indexOf(propValue || "") >= 0;
            case "not_in": return filter.value.split(",").indexOf(propValue || "") < 0;
            case "matches":
                try {
                    return new RegExp(filter.value).test(propValue || "");
                }
                catch (_) {
                    return false;
                }
            default: return false;
        }
    }
    // ---- RPCs ----
    function rpcGetMemberships(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var audiences = getAudienceDefinitions(nk);
        var memberships = [];
        for (var id in audiences) {
            if (isInAudience(nk, userId, id)) {
                memberships.push(id);
            }
        }
        return RpcHelpers.successResponse({ audiences: memberships });
    }
    function rpcCompute(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        var targetUserId = data.userId || ctx.userId;
        if (!targetUserId)
            return RpcHelpers.errorResponse("userId required");
        var audiences = getAudienceDefinitions(nk);
        var memberships = [];
        for (var id in audiences) {
            if (isInAudience(nk, targetUserId, id)) {
                memberships.push(id);
            }
        }
        return RpcHelpers.successResponse({ userId: targetUserId, audiences: memberships });
    }
    function register(initializer) {
        initializer.registerRpc("satori_audiences_get_memberships", rpcGetMemberships);
        initializer.registerRpc("satori_audiences_compute", rpcCompute);
    }
    SatoriAudiences.register = register;
})(SatoriAudiences || (SatoriAudiences = {}));
var SatoriDataLake;
(function (SatoriDataLake) {
    var DEFAULT_CONFIG = {
        targets: [],
        retentionDays: 90,
        enabledGlobally: false
    };
    function getConfig(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "data_lake", DEFAULT_CONFIG);
    }
    function buildExportPayload(events) {
        var lines = [];
        for (var i = 0; i < events.length; i++) {
            lines.push(JSON.stringify(events[i]));
        }
        return lines.join("\n");
    }
    function exportBatch(nk, logger, events) {
        var config = getConfig(nk);
        if (!config.enabledGlobally || config.targets.length === 0 || events.length === 0)
            return;
        var payload = buildExportPayload(events);
        for (var i = 0; i < config.targets.length; i++) {
            var target = config.targets[i];
            if (!target.enabled)
                continue;
            try {
                switch (target.type) {
                    case "s3":
                        exportToS3(nk, logger, target, payload);
                        break;
                    case "bigquery":
                        exportToBigQuery(nk, logger, target, events);
                        break;
                    case "snowflake":
                        exportToSnowflake(nk, logger, target, events);
                        break;
                    case "redshift":
                        exportToRedshift(nk, logger, target, events);
                        break;
                }
            }
            catch (e) {
                logger.warn("[DataLake] Export to %s/%s failed: %s", target.type, target.id, e.message || String(e));
            }
        }
    }
    SatoriDataLake.exportBatch = exportBatch;
    function exportToS3(nk, logger, target, payload) {
        var bucket = target.config["bucket"];
        var region = target.config["region"] || "us-east-1";
        var prefix = target.config["prefix"] || "satori-events";
        var endpoint = target.config["endpoint"];
        if (!bucket || !endpoint) {
            logger.warn("[DataLake/S3] Missing bucket or endpoint config for target %s", target.id);
            return;
        }
        var dateStr = new Date().toISOString().slice(0, 10);
        var ts = Date.now();
        var key = prefix + "/" + dateStr + "/" + ts + ".jsonl";
        var url = endpoint + "/" + bucket + "/" + key;
        var headers = {
            "Content-Type": "application/x-ndjson"
        };
        if (target.config["apiKey"]) {
            headers["Authorization"] = "Bearer " + target.config["apiKey"];
        }
        nk.httpRequest(url, "put", headers, payload);
        logger.info("[DataLake/S3] Exported %d bytes to %s", payload.length, key);
    }
    function exportToBigQuery(nk, logger, target, events) {
        var endpoint = target.config["endpoint"];
        if (!endpoint) {
            logger.warn("[DataLake/BigQuery] Missing endpoint for target %s", target.id);
            return;
        }
        var headers = {
            "Content-Type": "application/json"
        };
        if (target.config["apiKey"]) {
            headers["Authorization"] = "Bearer " + target.config["apiKey"];
        }
        var body = JSON.stringify({ rows: events.map(function (e) { return { json: e }; }) });
        nk.httpRequest(endpoint, "post", headers, body);
        logger.info("[DataLake/BigQuery] Exported %d events to %s", events.length, target.id);
    }
    function exportToSnowflake(nk, logger, target, events) {
        var endpoint = target.config["endpoint"];
        if (!endpoint) {
            logger.warn("[DataLake/Snowflake] Missing endpoint for target %s", target.id);
            return;
        }
        var headers = {
            "Content-Type": "application/json"
        };
        if (target.config["token"]) {
            headers["Authorization"] = "Snowflake Token=\"" + target.config["token"] + "\"";
        }
        var body = JSON.stringify(events);
        nk.httpRequest(endpoint, "post", headers, body);
        logger.info("[DataLake/Snowflake] Exported %d events to %s", events.length, target.id);
    }
    function exportToRedshift(nk, logger, target, events) {
        var endpoint = target.config["endpoint"];
        if (!endpoint) {
            logger.warn("[DataLake/Redshift] Missing endpoint for target %s", target.id);
            return;
        }
        var headers = {
            "Content-Type": "application/json"
        };
        if (target.config["apiKey"]) {
            headers["Authorization"] = "Bearer " + target.config["apiKey"];
        }
        var body = JSON.stringify({ records: events });
        nk.httpRequest(endpoint, "post", headers, body);
        logger.info("[DataLake/Redshift] Exported %d events to %s", events.length, target.id);
    }
    function rpcGetConfig(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var config = getConfig(nk);
        return RpcHelpers.successResponse(config);
    }
    function rpcUpsertTarget(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id || !data.type)
            return RpcHelpers.errorResponse("id and type required");
        var validTypes = ["bigquery", "snowflake", "redshift", "s3"];
        if (validTypes.indexOf(data.type) === -1)
            return RpcHelpers.errorResponse("type must be one of: " + validTypes.join(", "));
        var config = getConfig(nk);
        var idx = config.targets.findIndex(function (t) { return t.id === data.id; });
        var target = {
            id: data.id,
            type: data.type,
            enabled: data.enabled !== false,
            config: data.config || {},
            eventFilters: data.eventFilters,
            batchSize: data.batchSize || 100,
            flushIntervalSec: data.flushIntervalSec || 300
        };
        if (idx >= 0) {
            config.targets[idx] = target;
        }
        else {
            config.targets.push(target);
        }
        ConfigLoader.saveSatoriConfig(nk, "data_lake", config);
        return RpcHelpers.successResponse({ target: target });
    }
    function rpcDeleteTarget(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id)
            return RpcHelpers.errorResponse("id required");
        var config = getConfig(nk);
        config.targets = config.targets.filter(function (t) { return t.id !== data.id; });
        ConfigLoader.saveSatoriConfig(nk, "data_lake", config);
        return RpcHelpers.successResponse({ deleted: data.id });
    }
    function rpcSetEnabled(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        config.enabledGlobally = !!data.enabled;
        ConfigLoader.saveSatoriConfig(nk, "data_lake", config);
        return RpcHelpers.successResponse({ enabledGlobally: config.enabledGlobally });
    }
    function rpcSetRetention(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.days || data.days < 1)
            return RpcHelpers.errorResponse("days required (positive integer)");
        var config = getConfig(nk);
        config.retentionDays = data.days;
        ConfigLoader.saveSatoriConfig(nk, "data_lake", config);
        return RpcHelpers.successResponse({ retentionDays: config.retentionDays });
    }
    function rpcManualExport(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        var events = [];
        var cursor = "";
        var limit = data.limit || 500;
        var result = nk.storageList(Constants.SYSTEM_USER_ID, Constants.SATORI_EVENTS_COLLECTION, limit > 100 ? 100 : limit, cursor);
        if (result.objects) {
            for (var i = 0; i < result.objects.length; i++) {
                events.push(result.objects[i].value);
            }
        }
        if (events.length > 0) {
            exportBatch(nk, logger, events);
        }
        return RpcHelpers.successResponse({ exportedCount: events.length });
    }
    function register(initializer) {
        initializer.registerRpc("satori_datalake_config", rpcGetConfig);
        initializer.registerRpc("satori_datalake_upsert_target", rpcUpsertTarget);
        initializer.registerRpc("satori_datalake_delete_target", rpcDeleteTarget);
        initializer.registerRpc("satori_datalake_set_enabled", rpcSetEnabled);
        initializer.registerRpc("satori_datalake_set_retention", rpcSetRetention);
        initializer.registerRpc("satori_datalake_manual_export", rpcManualExport);
    }
    SatoriDataLake.register = register;
})(SatoriDataLake || (SatoriDataLake = {}));
var SatoriEventCapture;
(function (SatoriEventCapture) {
    function appendToUserHistory(nk, userId, event) {
        var history = Storage.readJson(nk, Constants.SATORI_EVENTS_COLLECTION, "history", userId);
        if (!history)
            history = { events: [] };
        history.events.push({
            name: event.name,
            timestamp: event.timestamp,
            metadata: event.metadata || {}
        });
        if (history.events.length > 500) {
            history.events = history.events.slice(history.events.length - 500);
        }
        Storage.writeJson(nk, Constants.SATORI_EVENTS_COLLECTION, "history", userId, history);
    }
    function captureEvent(nk, logger, userId, event) {
        var validation = SatoriTaxonomy.validateEvent(nk, event);
        if (!validation.valid) {
            logger.warn("[EventCapture] Rejected event '%s': %s", event.name, validation.errors.join("; "));
            return;
        }
        var dateStr = new Date(event.timestamp).toISOString().slice(0, 10);
        var key = "ev_" + dateStr + "_" + userId + "_" + Date.now();
        var record = {
            userId: userId,
            name: event.name,
            timestamp: event.timestamp,
            metadata: event.metadata || {},
            date: dateStr
        };
        nk.storageWrite([{
                collection: Constants.SATORI_EVENTS_COLLECTION,
                key: key,
                userId: Constants.SYSTEM_USER_ID,
                value: record,
                permissionRead: 0,
                permissionWrite: 0
            }]);
        appendToUserHistory(nk, userId, event);
        SatoriIdentities.onEvent(nk, logger, userId, event);
        SatoriMetrics.processEvent(nk, logger, userId, event.name, event.metadata || {});
        SatoriWebhooks.dispatch(nk, logger, "event:" + event.name, record);
        SatoriDataLake.exportBatch(nk, logger, [record]);
    }
    SatoriEventCapture.captureEvent = captureEvent;
    function captureEvents(nk, logger, userId, events) {
        var writes = [];
        var validEvents = [];
        var exportRecords = [];
        for (var i = 0; i < events.length; i++) {
            var event = events[i];
            var validation = SatoriTaxonomy.validateEvent(nk, event);
            if (!validation.valid) {
                continue;
            }
            validEvents.push(event);
            var dateStr = new Date(event.timestamp).toISOString().slice(0, 10);
            var key = "ev_" + dateStr + "_" + userId + "_" + (Date.now() + i);
            var record = {
                userId: userId,
                name: event.name,
                timestamp: event.timestamp,
                metadata: event.metadata || {},
                date: dateStr
            };
            exportRecords.push(record);
            writes.push({
                collection: Constants.SATORI_EVENTS_COLLECTION,
                key: key,
                userId: Constants.SYSTEM_USER_ID,
                value: record,
                permissionRead: 0,
                permissionWrite: 0
            });
        }
        if (writes.length > 0) {
            Storage.writeMultiple(nk, writes);
        }
        for (var j = 0; j < validEvents.length; j++) {
            appendToUserHistory(nk, userId, validEvents[j]);
            SatoriIdentities.onEvent(nk, logger, userId, validEvents[j]);
            SatoriMetrics.processEvent(nk, logger, userId, validEvents[j].name, validEvents[j].metadata || {});
            SatoriWebhooks.dispatch(nk, logger, "event:" + validEvents[j].name, exportRecords[j]);
        }
        if (exportRecords.length > 0) {
            SatoriDataLake.exportBatch(nk, logger, exportRecords);
        }
    }
    SatoriEventCapture.captureEvents = captureEvents;
    // ---- RPCs ----
    function rpcEvent(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("Event name required");
        var event = {
            name: data.name,
            timestamp: data.timestamp || Date.now(),
            metadata: data.metadata
        };
        captureEvent(nk, logger, userId, event);
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcEventsBatch(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.events || !Array.isArray(data.events))
            return RpcHelpers.errorResponse("events array required");
        var events = [];
        for (var i = 0; i < data.events.length; i++) {
            var e = data.events[i];
            if (!e.name)
                continue;
            events.push({
                name: e.name,
                timestamp: e.timestamp || Date.now(),
                metadata: e.metadata
            });
        }
        var preCount = events.length;
        captureEvents(nk, logger, userId, events);
        return RpcHelpers.successResponse({ captured: preCount, submitted: data.events.length });
    }
    function register(initializer) {
        initializer.registerRpc("satori_event", rpcEvent);
        initializer.registerRpc("satori_events_batch", rpcEventsBatch);
    }
    SatoriEventCapture.register = register;
})(SatoriEventCapture || (SatoriEventCapture = {}));
var SatoriExperiments;
(function (SatoriExperiments) {
    function getExperiments(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "experiments", {});
    }
    function getUserExperiments(nk, userId) {
        var data = Storage.readJson(nk, Constants.SATORI_ASSIGNMENTS_COLLECTION, "assignments", userId);
        return data || { assignments: {} };
    }
    function saveUserExperiments(nk, userId, data) {
        Storage.writeJson(nk, Constants.SATORI_ASSIGNMENTS_COLLECTION, "assignments", userId, data);
    }
    function deterministicAssign(userId, experimentId, variants, splitKey) {
        var totalWeight = 0;
        for (var i = 0; i < variants.length; i++) {
            totalWeight += variants[i].weight;
        }
        if (totalWeight <= 0)
            return variants[0].id;
        var seed = userId + ":" + experimentId;
        if (splitKey === "random") {
            seed = userId + ":" + experimentId + ":" + Date.now();
        }
        var hash = 0;
        for (var c = 0; c < seed.length; c++) {
            hash = ((hash << 5) - hash) + seed.charCodeAt(c);
            hash = hash & 0x7FFFFFFF;
        }
        var bucket = hash % totalWeight;
        var cumulative = 0;
        for (var j = 0; j < variants.length; j++) {
            cumulative += variants[j].weight;
            if (bucket < cumulative)
                return variants[j].id;
        }
        return variants[variants.length - 1].id;
    }
    function isExperimentActive(def) {
        if (def.status !== "running")
            return false;
        var now = Math.floor(Date.now() / 1000);
        if (def.startAt && now < def.startAt)
            return false;
        if (def.endAt && now > def.endAt)
            return false;
        return true;
    }
    function isWithinAdmissionDeadline(def) {
        if (!def.admissionDeadline)
            return true;
        return Math.floor(Date.now() / 1000) <= def.admissionDeadline;
    }
    function getVariant(nk, userId, experimentId) {
        var experiments = getExperiments(nk);
        var def = experiments[experimentId];
        if (!def || !isExperimentActive(def))
            return null;
        if (!def.variants || def.variants.length === 0)
            return null;
        if (def.audienceId && !SatoriAudiences.isInAudience(nk, userId, def.audienceId)) {
            return null;
        }
        var userExp = getUserExperiments(nk, userId);
        var assignment = userExp.assignments[experimentId];
        if (!assignment) {
            if (!isWithinAdmissionDeadline(def))
                return null;
            var variantId = deterministicAssign(userId, experimentId, def.variants, def.splitKey);
            assignment = {
                experimentId: experimentId,
                variantId: variantId,
                assignedAt: Math.floor(Date.now() / 1000)
            };
            userExp.assignments[experimentId] = assignment;
            saveUserExperiments(nk, userId, userExp);
        }
        if (def.lockParticipation && assignment.locked) {
            // locked assignments cannot change
        }
        var found = null;
        for (var i = 0; i < def.variants.length; i++) {
            if (def.variants[i].id === assignment.variantId) {
                found = def.variants[i];
                break;
            }
        }
        // Multi-phase: check if current phase has different variants
        if (def.phases && Array.isArray(def.phases)) {
            var now = Math.floor(Date.now() / 1000);
            for (var p = 0; p < def.phases.length; p++) {
                var phase = def.phases[p];
                if (now >= phase.startAt && now <= phase.endAt && phase.variants) {
                    for (var pv = 0; pv < phase.variants.length; pv++) {
                        if (phase.variants[pv].id === assignment.variantId) {
                            found = phase.variants[pv];
                            break;
                        }
                    }
                    break;
                }
            }
        }
        return found;
    }
    SatoriExperiments.getVariant = getVariant;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var experiments = getExperiments(nk);
        var result = [];
        for (var id in experiments) {
            var def = experiments[id];
            if (!isExperimentActive(def))
                continue;
            if (def.audienceId && !SatoriAudiences.isInAudience(nk, userId, def.audienceId))
                continue;
            var variant = getVariant(nk, userId, id);
            result.push({
                id: id,
                name: def.name,
                description: def.description,
                type: def.experimentType || "custom",
                variant: variant ? { id: variant.id, name: variant.name, config: variant.config } : null,
                startAt: def.startAt,
                endAt: def.endAt,
                goalMetric: def.goalMetric
            });
        }
        return RpcHelpers.successResponse({ experiments: result });
    }
    function rpcGetVariant(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.experimentId)
            return RpcHelpers.errorResponse("experimentId required");
        var variant = getVariant(nk, userId, data.experimentId);
        return RpcHelpers.successResponse({ variant: variant });
    }
    function register(initializer) {
        initializer.registerRpc("satori_experiments_get", rpcGet);
        initializer.registerRpc("satori_experiments_get_variant", rpcGetVariant);
    }
    SatoriExperiments.register = register;
})(SatoriExperiments || (SatoriExperiments = {}));
var SatoriFeatureFlags;
(function (SatoriFeatureFlags) {
    var DEFAULT_CONFIG = { flags: {} };
    function getConfig(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "flags", DEFAULT_CONFIG);
    }
    function getFlag(nk, userId, flagName, defaultValue) {
        var config = getConfig(nk);
        var def = config.flags[flagName];
        if (!def || !def.enabled) {
            return { name: flagName, value: defaultValue || "" };
        }
        if (def.conditionsByAudience && userId) {
            for (var audienceId in def.conditionsByAudience) {
                if (SatoriAudiences.isInAudience(nk, userId, audienceId)) {
                    return { name: flagName, value: def.conditionsByAudience[audienceId] };
                }
            }
        }
        return { name: flagName, value: def.value };
    }
    SatoriFeatureFlags.getFlag = getFlag;
    function getAllFlags(nk, userId) {
        var config = getConfig(nk);
        var flags = [];
        for (var name in config.flags) {
            var def = config.flags[name];
            if (!def.enabled)
                continue;
            var value = def.value;
            if (def.conditionsByAudience && userId) {
                for (var audienceId in def.conditionsByAudience) {
                    if (SatoriAudiences.isInAudience(nk, userId, audienceId)) {
                        value = def.conditionsByAudience[audienceId];
                        break;
                    }
                }
            }
            flags.push({ name: name, value: value });
        }
        return flags;
    }
    SatoriFeatureFlags.getAllFlags = getAllFlags;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("Flag name required");
        var flag = getFlag(nk, userId, data.name, data.defaultValue);
        return RpcHelpers.successResponse({ flag: flag });
    }
    function rpcGetAll(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var flags;
        if (data.names && Array.isArray(data.names)) {
            flags = [];
            for (var i = 0; i < data.names.length; i++) {
                flags.push(getFlag(nk, userId, data.names[i]));
            }
        }
        else {
            flags = getAllFlags(nk, userId);
        }
        return RpcHelpers.successResponse({ flags: flags });
    }
    function rpcSet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("Flag name required");
        var config = getConfig(nk);
        var now = Math.floor(Date.now() / 1000);
        var existing = config.flags[data.name];
        config.flags[data.name] = {
            name: data.name,
            value: data.value !== undefined ? data.value : (existing ? existing.value : ""),
            description: data.description || (existing ? existing.description : ""),
            conditionsByAudience: data.conditionsByAudience || (existing ? existing.conditionsByAudience : undefined),
            enabled: data.enabled !== undefined ? data.enabled : (existing ? existing.enabled : true),
            createdAt: existing ? existing.createdAt : now,
            updatedAt: now
        };
        ConfigLoader.saveSatoriConfig(nk, "flags", config);
        return RpcHelpers.successResponse({ flag: config.flags[data.name] });
    }
    function register(initializer) {
        initializer.registerRpc("satori_flags_get", rpcGet);
        initializer.registerRpc("satori_flags_get_all", rpcGetAll);
        initializer.registerRpc("satori_flags_set", rpcSet);
    }
    SatoriFeatureFlags.register = register;
})(SatoriFeatureFlags || (SatoriFeatureFlags = {}));
var SatoriIdentities;
(function (SatoriIdentities) {
    function getProperties(nk, userId) {
        var data = Storage.readJson(nk, Constants.SATORI_IDENTITY_COLLECTION, "props", userId);
        return data || {
            defaultProperties: {},
            customProperties: {},
            computedProperties: {}
        };
    }
    function saveProperties(nk, userId, props) {
        Storage.writeJson(nk, Constants.SATORI_IDENTITY_COLLECTION, "props", userId, props);
    }
    function onEvent(nk, logger, userId, event) {
        try {
            var props = getProperties(nk, userId);
            var now = new Date().toISOString();
            if (!props.defaultProperties.first_seen) {
                props.defaultProperties.first_seen = now;
            }
            props.defaultProperties.last_seen = now;
            var sessionCount = parseInt(props.computedProperties.session_count || "0");
            if (event.name === "session_start") {
                props.computedProperties.session_count = String(sessionCount + 1);
            }
            var eventCount = parseInt(props.computedProperties["event_count_" + event.name] || "0");
            props.computedProperties["event_count_" + event.name] = String(eventCount + 1);
            var totalEvents = parseInt(props.computedProperties.total_events || "0");
            props.computedProperties.total_events = String(totalEvents + 1);
            if (event.name === "purchase" && event.metadata && event.metadata.amount) {
                var totalSpend = parseFloat(props.computedProperties.total_spend || "0");
                totalSpend += parseFloat(event.metadata.amount);
                props.computedProperties.total_spend = String(totalSpend);
            }
            saveProperties(nk, userId, props);
        }
        catch (err) {
            logger.warn("SatoriIdentities.onEvent error: %s", err.message || String(err));
        }
    }
    SatoriIdentities.onEvent = onEvent;
    function getProperty(nk, userId, key) {
        var props = getProperties(nk, userId);
        return props.defaultProperties[key] || props.customProperties[key] || props.computedProperties[key] || null;
    }
    SatoriIdentities.getProperty = getProperty;
    function getAllProperties(nk, userId) {
        return getProperties(nk, userId);
    }
    SatoriIdentities.getAllProperties = getAllProperties;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var props = getProperties(nk, userId);
        return RpcHelpers.successResponse({ properties: props });
    }
    function rpcUpdate(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var props = getProperties(nk, userId);
        if (data.defaultProperties) {
            for (var k in data.defaultProperties) {
                props.defaultProperties[k] = data.defaultProperties[k];
            }
        }
        if (data.customProperties) {
            for (var ck in data.customProperties) {
                props.customProperties[ck] = data.customProperties[ck];
            }
        }
        saveProperties(nk, userId, props);
        return RpcHelpers.successResponse({ properties: props });
    }
    function register(initializer) {
        initializer.registerRpc("satori_identity_get", rpcGet);
        initializer.registerRpc("satori_identity_update_properties", rpcUpdate);
    }
    SatoriIdentities.register = register;
})(SatoriIdentities || (SatoriIdentities = {}));
var SatoriLiveEvents;
(function (SatoriLiveEvents) {
    function getEventDefinitions(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "live_events", {});
    }
    function getUserLiveEventStates(nk, userId) {
        var data = Storage.readJson(nk, Constants.SATORI_CONFIGS_COLLECTION, "live_event_state_" + userId, userId);
        return (data && data.events) || {};
    }
    function saveUserLiveEventStates(nk, userId, states) {
        Storage.writeJson(nk, Constants.SATORI_CONFIGS_COLLECTION, "live_event_state_" + userId, userId, { events: states });
    }
    function getEventStatus(def) {
        var now = Math.floor(Date.now() / 1000);
        var startAt = def.startAt;
        var endAt = def.endAt;
        if (def.recurrenceCron && def.recurrenceIntervalSec) {
            var runState = computeRecurrence(def);
            startAt = runState.currentStart;
            endAt = runState.currentEnd;
        }
        if (now < startAt)
            return "upcoming";
        if (now > endAt)
            return "ended";
        return "active";
    }
    function computeRecurrence(def) {
        var now = Math.floor(Date.now() / 1000);
        var interval = def.recurrenceIntervalSec || 86400;
        var duration = def.endAt - def.startAt;
        var elapsed = now - def.startAt;
        if (elapsed < 0)
            return { currentStart: def.startAt, currentEnd: def.endAt };
        var cycleIndex = Math.floor(elapsed / interval);
        var currentStart = def.startAt + (cycleIndex * interval);
        return { currentStart: currentStart, currentEnd: currentStart + duration };
    }
    // ---- RPCs ----
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var events = getEventDefinitions(nk);
        var userStates = getUserLiveEventStates(nk, userId);
        var result = [];
        for (var id in events) {
            var def = events[id];
            if (def.audienceId && !SatoriAudiences.isInAudience(nk, userId, def.audienceId))
                continue;
            var status = getEventStatus(def);
            if (data.names && data.names.indexOf(def.name) < 0)
                continue;
            var userState = userStates[id];
            var effectiveStart = def.startAt;
            var effectiveEnd = def.endAt;
            if (def.recurrenceCron && def.recurrenceIntervalSec) {
                var run = computeRecurrence(def);
                effectiveStart = run.currentStart;
                effectiveEnd = run.currentEnd;
            }
            result.push({
                id: id,
                name: def.name,
                description: def.description,
                category: def.category || "",
                startAt: effectiveStart,
                endAt: effectiveEnd,
                status: status,
                config: def.config,
                joined: userState ? !!userState.joinedAt : false,
                claimed: userState ? !!userState.claimedAt : false,
                hasReward: !!def.reward,
                sticky: !!def.sticky,
                requiresJoin: !!def.requiresJoin,
                flagOverrides: def.flagOverrides
            });
        }
        return RpcHelpers.successResponse({ events: result });
    }
    function rpcJoin(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var events = getEventDefinitions(nk);
        var def = events[data.eventId];
        if (!def)
            return RpcHelpers.errorResponse("Event not found");
        var status = getEventStatus(def);
        if (status !== "active")
            return RpcHelpers.errorResponse("Event is not active");
        var userStates = getUserLiveEventStates(nk, userId);
        if (!userStates[data.eventId]) {
            userStates[data.eventId] = { eventId: data.eventId };
        }
        userStates[data.eventId].joinedAt = Math.floor(Date.now() / 1000);
        saveUserLiveEventStates(nk, userId, userStates);
        if (def.onJoinMessageId) {
            var msgDefs = ConfigLoader.loadSatoriConfig(nk, "messages", {});
            if (msgDefs[def.onJoinMessageId]) {
                SatoriMessages.deliverMessage(nk, userId, msgDefs[def.onJoinMessageId]);
            }
        }
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var events = getEventDefinitions(nk);
        var def = events[data.eventId];
        if (!def)
            return RpcHelpers.errorResponse("Event not found");
        var userStates = getUserLiveEventStates(nk, userId);
        var state = userStates[data.eventId];
        if (def.requiresJoin && (!state || !state.joinedAt))
            return RpcHelpers.errorResponse("Not joined");
        if (state && state.claimedAt)
            return RpcHelpers.errorResponse("Already claimed");
        if (!state) {
            state = { eventId: data.eventId };
            userStates[data.eventId] = state;
        }
        var reward = null;
        if (def.reward) {
            reward = RewardEngine.resolveReward(nk, def.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
        }
        state.claimedAt = Math.floor(Date.now() / 1000);
        saveUserLiveEventStates(nk, userId, userStates);
        return RpcHelpers.successResponse({ reward: reward });
    }
    function register(initializer) {
        initializer.registerRpc("satori_live_events_list", rpcList);
        initializer.registerRpc("satori_live_events_join", rpcJoin);
        initializer.registerRpc("satori_live_events_claim", rpcClaim);
    }
    SatoriLiveEvents.register = register;
})(SatoriLiveEvents || (SatoriLiveEvents = {}));
var SatoriMessages;
(function (SatoriMessages) {
    function getMessageDefinitions(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "messages", {});
    }
    function getUserMessages(nk, userId) {
        var data = Storage.readJson(nk, Constants.SATORI_MESSAGES_COLLECTION, "inbox", userId);
        return data || { messages: [] };
    }
    function saveUserMessages(nk, userId, data) {
        Storage.writeJson(nk, Constants.SATORI_MESSAGES_COLLECTION, "inbox", userId, data);
    }
    function deliverMessage(nk, userId, messageDef) {
        var inbox = getUserMessages(nk, userId);
        var alreadyDelivered = false;
        for (var i = 0; i < inbox.messages.length; i++) {
            if (inbox.messages[i].messageDefId === messageDef.id) {
                alreadyDelivered = true;
                break;
            }
        }
        if (alreadyDelivered)
            return;
        var msg = {
            id: nk.uuidv4(),
            messageDefId: messageDef.id,
            title: messageDef.title,
            body: messageDef.body,
            imageUrl: messageDef.imageUrl,
            metadata: messageDef.metadata,
            reward: messageDef.reward,
            createdAt: Math.floor(Date.now() / 1000),
            expiresAt: messageDef.expiresAt
        };
        inbox.messages.push(msg);
        saveUserMessages(nk, userId, inbox);
    }
    SatoriMessages.deliverMessage = deliverMessage;
    function deliverToAudience(nk, logger, messageDef, audienceId) {
        var delivered = 0;
        try {
            var users = nk.usersGetRandom(100);
            for (var i = 0; i < users.length; i++) {
                if (SatoriAudiences.isInAudience(nk, users[i].userId, audienceId)) {
                    deliverMessage(nk, users[i].userId, messageDef);
                    delivered++;
                }
            }
        }
        catch (e) {
            logger.warn("deliverToAudience error: %s", e.message || String(e));
        }
        return delivered;
    }
    SatoriMessages.deliverToAudience = deliverToAudience;
    function processScheduledMessages(nk, logger) {
        var definitions = getMessageDefinitions(nk);
        var now = Math.floor(Date.now() / 1000);
        for (var id in definitions) {
            var def = definitions[id];
            if (!def.scheduleAt || def.scheduleAt > now)
                continue;
            var deliveryState = Storage.readSystemJson(nk, Constants.SATORI_MESSAGES_COLLECTION, "schedule_" + id);
            if (deliveryState && deliveryState.delivered)
                continue;
            if (def.audienceId) {
                deliverToAudience(nk, logger, def, def.audienceId);
            }
            Storage.writeSystemJson(nk, Constants.SATORI_MESSAGES_COLLECTION, "schedule_" + id, { delivered: true, deliveredAt: now });
            logger.info("Delivered scheduled message: %s", id);
        }
    }
    SatoriMessages.processScheduledMessages = processScheduledMessages;
    function purgeExpired(inbox) {
        var now = Math.floor(Date.now() / 1000);
        inbox.messages = inbox.messages.filter(function (m) {
            return !m.expiresAt || m.expiresAt > now;
        });
        return inbox;
    }
    // ---- RPCs ----
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        processScheduledMessages(nk, logger);
        var inbox = getUserMessages(nk, userId);
        inbox = purgeExpired(inbox);
        saveUserMessages(nk, userId, inbox);
        return RpcHelpers.successResponse({
            messages: inbox.messages.map(function (m) {
                return {
                    id: m.id,
                    title: m.title,
                    body: m.body,
                    imageUrl: m.imageUrl,
                    metadata: m.metadata,
                    hasReward: !!m.reward,
                    createdAt: m.createdAt,
                    expiresAt: m.expiresAt,
                    readAt: m.readAt,
                    consumedAt: m.consumedAt
                };
            })
        });
    }
    function rpcRead(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.messageId)
            return RpcHelpers.errorResponse("messageId required");
        var inbox = getUserMessages(nk, userId);
        var msg;
        for (var i = 0; i < inbox.messages.length; i++) {
            if (inbox.messages[i].id === data.messageId) {
                msg = inbox.messages[i];
                break;
            }
        }
        if (!msg)
            return RpcHelpers.errorResponse("Message not found");
        if (!msg.readAt) {
            msg.readAt = Math.floor(Date.now() / 1000);
            saveUserMessages(nk, userId, inbox);
        }
        var reward = null;
        if (msg.reward && !msg.consumedAt) {
            reward = RewardEngine.resolveReward(nk, msg.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
            msg.consumedAt = Math.floor(Date.now() / 1000);
            saveUserMessages(nk, userId, inbox);
        }
        return RpcHelpers.successResponse({ message: msg, reward: reward });
    }
    function rpcDelete(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.messageId)
            return RpcHelpers.errorResponse("messageId required");
        var inbox = getUserMessages(nk, userId);
        inbox.messages = inbox.messages.filter(function (m) { return m.id !== data.messageId; });
        saveUserMessages(nk, userId, inbox);
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcBroadcast(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.title)
            return RpcHelpers.errorResponse("title required");
        var now = Math.floor(Date.now() / 1000);
        var msgDef = {
            id: data.id || nk.uuidv4(),
            title: data.title,
            body: data.body,
            imageUrl: data.imageUrl,
            metadata: data.metadata,
            reward: data.reward,
            audienceId: data.audienceId,
            scheduleAt: data.scheduleAt,
            expiresAt: data.expiresAt,
            createdAt: now
        };
        if (data.audienceId) {
            var delivered = deliverToAudience(nk, logger, msgDef, data.audienceId);
            return RpcHelpers.successResponse({ delivered: delivered, audienceId: data.audienceId });
        }
        var definitions = getMessageDefinitions(nk);
        definitions[msgDef.id] = msgDef;
        ConfigLoader.saveSatoriConfig(nk, "messages", definitions);
        return RpcHelpers.successResponse({ scheduled: true, messageId: msgDef.id });
    }
    function register(initializer) {
        initializer.registerRpc("satori_messages_list", rpcList);
        initializer.registerRpc("satori_messages_read", rpcRead);
        initializer.registerRpc("satori_messages_delete", rpcDelete);
        initializer.registerRpc("satori_messages_broadcast", rpcBroadcast);
    }
    SatoriMessages.register = register;
})(SatoriMessages || (SatoriMessages = {}));
var SatoriMetrics;
(function (SatoriMetrics) {
    function getMetricDefinitions(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "metrics", {});
    }
    function getMetricState(nk, metricId) {
        var data = Storage.readSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, metricId);
        return data || { buckets: {} };
    }
    function saveMetricState(nk, metricId, state) {
        Storage.writeSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, metricId, state);
    }
    function processEvent(nk, logger, userId, eventName, metadata) {
        var definitions = getMetricDefinitions(nk);
        for (var id in definitions) {
            var def = definitions[id];
            if (def.eventName !== eventName)
                continue;
            var state = getMetricState(nk, id);
            var now = Math.floor(Date.now() / 1000);
            var bucketKey = def.windowSec ? String(Math.floor(now / def.windowSec) * def.windowSec) : "all";
            if (!state.buckets[bucketKey]) {
                state.buckets[bucketKey] = { value: 0, count: 0, uniqueUsers: [] };
            }
            var bucket = state.buckets[bucketKey];
            var numericValue = 1;
            if (def.metadataField && metadata[def.metadataField]) {
                numericValue = parseFloat(metadata[def.metadataField]) || 1;
            }
            switch (def.aggregation) {
                case "count":
                    bucket.value++;
                    break;
                case "sum":
                    bucket.value += numericValue;
                    break;
                case "avg":
                    bucket.value = ((bucket.value * bucket.count) + numericValue) / (bucket.count + 1);
                    break;
                case "min":
                    bucket.value = bucket.count === 0 ? numericValue : Math.min(bucket.value, numericValue);
                    break;
                case "max":
                    bucket.value = Math.max(bucket.value, numericValue);
                    break;
                case "unique":
                    if (bucket.uniqueUsers.indexOf(userId) < 0) {
                        bucket.uniqueUsers.push(userId);
                        bucket.value = bucket.uniqueUsers.length;
                    }
                    break;
            }
            bucket.count++;
            saveMetricState(nk, id, state);
            checkAlerts(nk, logger, id, bucket.value);
        }
    }
    SatoriMetrics.processEvent = processEvent;
    function getAlerts(nk) {
        var data = Storage.readSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, "alerts");
        return (data && data.alerts) || [];
    }
    function checkAlerts(nk, logger, metricId, value) {
        var alerts = getAlerts(nk);
        for (var i = 0; i < alerts.length; i++) {
            var alert = alerts[i];
            if (!alert.enabled || alert.metricId !== metricId)
                continue;
            var triggered = false;
            switch (alert.operator) {
                case "gt":
                    triggered = value > alert.threshold;
                    break;
                case "lt":
                    triggered = value < alert.threshold;
                    break;
                case "gte":
                    triggered = value >= alert.threshold;
                    break;
                case "lte":
                    triggered = value <= alert.threshold;
                    break;
            }
            if (triggered) {
                logger.warn("[MetricAlert] %s triggered: %s = %f (threshold: %f)", alert.name, metricId, value, alert.threshold);
                Storage.writeSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, "alert_triggered_" + alert.name, {
                    alert: alert, value: value, triggeredAt: Math.floor(Date.now() / 1000)
                });
            }
        }
    }
    // ---- RPCs ----
    function rpcQuery(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        var definitions = getMetricDefinitions(nk);
        var results = [];
        var now = Math.floor(Date.now() / 1000);
        var metricIds = data.metricIds || Object.keys(definitions);
        for (var i = 0; i < metricIds.length; i++) {
            var metricId = metricIds[i];
            var state = getMetricState(nk, metricId);
            var latestBucket = "all";
            var latestTime = 0;
            for (var bk in state.buckets) {
                var bkTime = parseInt(bk) || 0;
                if (bkTime > latestTime) {
                    latestTime = bkTime;
                    latestBucket = bk;
                }
            }
            var bucket = state.buckets[latestBucket];
            if (bucket) {
                results.push({
                    metricId: metricId,
                    value: bucket.value,
                    computedAt: now
                });
            }
        }
        return RpcHelpers.successResponse({ metrics: results });
    }
    function rpcDefine(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id || !data.name || !data.eventName || !data.aggregation) {
            return RpcHelpers.errorResponse("id, name, eventName, and aggregation required");
        }
        var definitions = getMetricDefinitions(nk);
        definitions[data.id] = {
            id: data.id,
            name: data.name,
            eventName: data.eventName,
            metadataField: data.metadataField,
            aggregation: data.aggregation,
            windowSec: data.windowSec
        };
        ConfigLoader.saveSatoriConfig(nk, "metrics", definitions);
        return RpcHelpers.successResponse({ metric: definitions[data.id] });
    }
    function rpcSetAlert(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.metricId || !data.name || data.threshold === undefined || !data.operator) {
            return RpcHelpers.errorResponse("metricId, name, threshold, and operator required");
        }
        var alerts = getAlerts(nk);
        var existing = false;
        for (var i = 0; i < alerts.length; i++) {
            if (alerts[i].name === data.name) {
                alerts[i] = { metricId: data.metricId, threshold: data.threshold, operator: data.operator, name: data.name, enabled: data.enabled !== false };
                existing = true;
                break;
            }
        }
        if (!existing) {
            alerts.push({ metricId: data.metricId, threshold: data.threshold, operator: data.operator, name: data.name, enabled: data.enabled !== false });
        }
        Storage.writeSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, "alerts", { alerts: alerts });
        return RpcHelpers.successResponse({ alerts: alerts });
    }
    function rpcPrometheus(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var definitions = getMetricDefinitions(nk);
        var lines = [];
        for (var id in definitions) {
            var state = getMetricState(nk, id);
            var latestValue = 0;
            var latestTime = 0;
            for (var bk in state.buckets) {
                var bkTime = parseInt(bk) || 0;
                if (bkTime >= latestTime) {
                    latestTime = bkTime;
                    latestValue = state.buckets[bk].value;
                }
            }
            var safeName = id.replace(/[^a-zA-Z0-9_]/g, "_");
            lines.push("# HELP " + safeName + " " + (definitions[id].name || id));
            lines.push("# TYPE " + safeName + " gauge");
            lines.push(safeName + " " + latestValue);
        }
        return RpcHelpers.successResponse({ text: lines.join("\n") });
    }
    function register(initializer) {
        initializer.registerRpc("satori_metrics_query", rpcQuery);
        initializer.registerRpc("satori_metrics_define", rpcDefine);
        initializer.registerRpc("satori_metrics_set_alert", rpcSetAlert);
        initializer.registerRpc("satori_metrics_prometheus", rpcPrometheus);
    }
    SatoriMetrics.register = register;
    function registerEventHandlers() {
        EventBus.on(EventBus.Events.CURRENCY_EARNED, function (nk, logger, ctx, data) {
            processEvent(nk, logger, data.userId, "currency_earned", { currency: data.currencyId, amount: String(data.amount) });
        });
        EventBus.on(EventBus.Events.CURRENCY_SPENT, function (nk, logger, ctx, data) {
            processEvent(nk, logger, data.userId, "currency_spent", { currency: data.currencyId, amount: String(data.amount) });
        });
        EventBus.on(EventBus.Events.STORE_PURCHASE, function (nk, logger, ctx, data) {
            processEvent(nk, logger, data.userId, "store_purchase", { offerId: data.offerId });
        });
        EventBus.on(EventBus.Events.GAME_COMPLETED, function (nk, logger, ctx, data) {
            processEvent(nk, logger, data.userId, "game_completed", { gameId: data.gameId });
        });
        EventBus.on(EventBus.Events.SESSION_START, function (nk, logger, ctx, data) {
            processEvent(nk, logger, data.userId, "session_start", {});
        });
    }
    SatoriMetrics.registerEventHandlers = registerEventHandlers;
})(SatoriMetrics || (SatoriMetrics = {}));
var SatoriTaxonomy;
(function (SatoriTaxonomy) {
    var DEFAULT_CONFIG = {
        schemas: {},
        enforceStrict: false,
        maxEventNameLength: 128,
        maxMetadataValueLength: 1024,
        allowedCategories: ["engagement", "monetization", "progression", "social", "system", "custom"]
    };
    function getConfig(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "taxonomy", DEFAULT_CONFIG);
    }
    function validateEvent(nk, event) {
        var config = getConfig(nk);
        var errors = [];
        var warnings = [];
        if (!event.name) {
            errors.push("Event name is required");
            return { valid: false, errors: errors, warnings: warnings };
        }
        if (event.name.length > config.maxEventNameLength) {
            errors.push("Event name exceeds max length of " + config.maxEventNameLength);
        }
        var schema = config.schemas[event.name];
        if (!schema && config.enforceStrict) {
            errors.push("Unknown event '" + event.name + "' (strict mode enabled)");
            return { valid: false, errors: errors, warnings: warnings };
        }
        if (!schema) {
            warnings.push("No schema defined for event '" + event.name + "'");
            return { valid: errors.length === 0, errors: errors, warnings: warnings };
        }
        if (schema.deprecated) {
            warnings.push("Event '" + event.name + "' is deprecated");
        }
        if (schema.requiredMetadata && event.metadata) {
            for (var i = 0; i < schema.requiredMetadata.length; i++) {
                var reqKey = schema.requiredMetadata[i];
                if (event.metadata[reqKey] === undefined || event.metadata[reqKey] === null) {
                    errors.push("Missing required metadata key: " + reqKey);
                }
            }
        }
        else if (schema.requiredMetadata && schema.requiredMetadata.length > 0 && !event.metadata) {
            errors.push("Metadata required but not provided");
        }
        if (event.metadata) {
            var metaKeys = Object.keys(event.metadata);
            if (schema.maxMetadataKeys && metaKeys.length > schema.maxMetadataKeys) {
                errors.push("Too many metadata keys: " + metaKeys.length + " (max " + schema.maxMetadataKeys + ")");
            }
            for (var j = 0; j < metaKeys.length; j++) {
                var val = event.metadata[metaKeys[j]];
                if (val && val.length > config.maxMetadataValueLength) {
                    errors.push("Metadata value for '" + metaKeys[j] + "' exceeds max length");
                }
                if (schema.metadataTypes && schema.metadataTypes[metaKeys[j]]) {
                    var expectedType = schema.metadataTypes[metaKeys[j]];
                    if (expectedType === "number" && isNaN(parseFloat(val))) {
                        errors.push("Metadata '" + metaKeys[j] + "' should be a number");
                    }
                    if (expectedType === "boolean" && val !== "true" && val !== "false") {
                        errors.push("Metadata '" + metaKeys[j] + "' should be 'true' or 'false'");
                    }
                }
            }
        }
        return { valid: errors.length === 0, errors: errors, warnings: warnings };
    }
    SatoriTaxonomy.validateEvent = validateEvent;
    function rpcGetSchemas(ctx, logger, nk, payload) {
        var config = getConfig(nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (data.category) {
            var filtered = {};
            for (var name in config.schemas) {
                if (config.schemas[name].category === data.category)
                    filtered[name] = config.schemas[name];
            }
            return RpcHelpers.successResponse({ schemas: filtered, category: data.category });
        }
        return RpcHelpers.successResponse({
            schemas: config.schemas,
            enforceStrict: config.enforceStrict,
            categories: config.allowedCategories,
            totalSchemas: Object.keys(config.schemas).length
        });
    }
    function rpcUpsertSchema(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("name required");
        var config = getConfig(nk);
        config.schemas[data.name] = {
            name: data.name,
            description: data.description || "",
            category: data.category || "custom",
            requiredMetadata: data.requiredMetadata || [],
            optionalMetadata: data.optionalMetadata || [],
            metadataTypes: data.metadataTypes || {},
            maxMetadataKeys: data.maxMetadataKeys || 50,
            deprecated: data.deprecated || false
        };
        ConfigLoader.saveSatoriConfig(nk, "taxonomy", config);
        return RpcHelpers.successResponse({ schema: config.schemas[data.name] });
    }
    function rpcDeleteSchema(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("name required");
        var config = getConfig(nk);
        delete config.schemas[data.name];
        ConfigLoader.saveSatoriConfig(nk, "taxonomy", config);
        return RpcHelpers.successResponse({ deleted: data.name });
    }
    function rpcValidateEvent(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("name required");
        var result = validateEvent(nk, { name: data.name, timestamp: Math.floor(Date.now() / 1000), metadata: data.metadata });
        return RpcHelpers.successResponse(result);
    }
    function rpcSetStrictMode(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        config.enforceStrict = !!data.enforceStrict;
        ConfigLoader.saveSatoriConfig(nk, "taxonomy", config);
        return RpcHelpers.successResponse({ enforceStrict: config.enforceStrict });
    }
    function register(initializer) {
        initializer.registerRpc("satori_taxonomy_schemas", rpcGetSchemas);
        initializer.registerRpc("satori_taxonomy_upsert", rpcUpsertSchema);
        initializer.registerRpc("satori_taxonomy_delete", rpcDeleteSchema);
        initializer.registerRpc("satori_taxonomy_validate", rpcValidateEvent);
        initializer.registerRpc("satori_taxonomy_strict_mode", rpcSetStrictMode);
    }
    SatoriTaxonomy.register = register;
})(SatoriTaxonomy || (SatoriTaxonomy = {}));
var SatoriWebhooks;
(function (SatoriWebhooks) {
    var DEFAULT_CONFIG = { webhooks: [] };
    function getConfig(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "webhooks", DEFAULT_CONFIG);
    }
    function dispatch(nk, logger, eventName, payload) {
        var config = getConfig(nk);
        if (!config.webhooks || config.webhooks.length === 0)
            return;
        for (var i = 0; i < config.webhooks.length; i++) {
            var wh = config.webhooks[i];
            if (!wh.enabled)
                continue;
            if (wh.events.indexOf(eventName) === -1 && wh.events.indexOf("*") === -1)
                continue;
            try {
                var body = JSON.stringify({
                    event: eventName,
                    timestamp: Math.floor(Date.now() / 1000),
                    data: payload
                });
                var headers = {
                    "Content-Type": "application/json",
                    "X-Webhook-Event": eventName
                };
                if (wh.secret) {
                    var sigBytes = nk.hmacSha256Hash(wh.secret, body);
                    headers["X-Webhook-Signature"] = nk.binaryToString(sigBytes);
                }
                if (wh.headers) {
                    for (var h in wh.headers) {
                        headers[h] = wh.headers[h];
                    }
                }
                nk.httpRequest(wh.url, "post", headers, body);
            }
            catch (e) {
                logger.warn("[Webhooks] Failed to dispatch '%s' to %s: %s", eventName, wh.url, e.message || String(e));
            }
        }
    }
    SatoriWebhooks.dispatch = dispatch;
    function rpcList(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var config = getConfig(nk);
        return RpcHelpers.successResponse({ webhooks: config.webhooks });
    }
    function rpcUpsert(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id || !data.url || !data.events)
            return RpcHelpers.errorResponse("id, url, and events[] required");
        var config = getConfig(nk);
        var existing = config.webhooks.findIndex(function (w) { return w.id === data.id; });
        var wh = {
            id: data.id,
            url: data.url,
            events: data.events,
            enabled: data.enabled !== false,
            secret: data.secret,
            headers: data.headers,
            retryCount: data.retryCount || 0,
            timeoutMs: data.timeoutMs || 5000
        };
        if (existing >= 0) {
            config.webhooks[existing] = wh;
        }
        else {
            config.webhooks.push(wh);
        }
        ConfigLoader.saveSatoriConfig(nk, "webhooks", config);
        return RpcHelpers.successResponse({ webhook: wh });
    }
    function rpcDelete(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id)
            return RpcHelpers.errorResponse("id required");
        var config = getConfig(nk);
        config.webhooks = config.webhooks.filter(function (w) { return w.id !== data.id; });
        ConfigLoader.saveSatoriConfig(nk, "webhooks", config);
        return RpcHelpers.successResponse({ deleted: data.id });
    }
    function rpcTest(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id)
            return RpcHelpers.errorResponse("id required");
        var config = getConfig(nk);
        var wh = config.webhooks.find(function (w) { return w.id === data.id; });
        if (!wh)
            return RpcHelpers.errorResponse("Webhook not found");
        try {
            dispatch(nk, logger, "test_ping", { message: "Test webhook dispatch", webhookId: data.id });
            return RpcHelpers.successResponse({ success: true, url: wh.url });
        }
        catch (e) {
            return RpcHelpers.errorResponse("Test failed: " + (e.message || String(e)));
        }
    }
    function register(initializer) {
        initializer.registerRpc("satori_webhooks_list", rpcList);
        initializer.registerRpc("satori_webhooks_upsert", rpcUpsert);
        initializer.registerRpc("satori_webhooks_delete", rpcDelete);
        initializer.registerRpc("satori_webhooks_test", rpcTest);
    }
    SatoriWebhooks.register = register;
    function registerEventHandlers() {
        var events = [
            EventBus.Events.CURRENCY_EARNED, EventBus.Events.CURRENCY_SPENT,
            EventBus.Events.ITEM_GRANTED, EventBus.Events.ITEM_CONSUMED,
            EventBus.Events.ACHIEVEMENT_COMPLETED, EventBus.Events.ACHIEVEMENT_CLAIMED,
            EventBus.Events.LEVEL_UP, EventBus.Events.STORE_PURCHASE,
            EventBus.Events.GAME_STARTED, EventBus.Events.GAME_COMPLETED,
            EventBus.Events.SESSION_START, EventBus.Events.SESSION_END
        ];
        for (var i = 0; i < events.length; i++) {
            (function (eventName) {
                EventBus.on(eventName, function (nk, logger, _ctx, data) {
                    dispatch(nk, logger, eventName, data);
                });
            })(events[i]);
        }
    }
    SatoriWebhooks.registerEventHandlers = registerEventHandlers;
})(SatoriWebhooks || (SatoriWebhooks = {}));
var ConfigLoader;
(function (ConfigLoader) {
    var configCache = {};
    var CACHE_TTL_MS = 60000; // 1 minute
    function loadConfig(nk, configKey, defaultValue) {
        var now = Date.now();
        var cached = configCache[configKey];
        if (cached && (now - cached.loadedAt) < CACHE_TTL_MS) {
            return cached.data;
        }
        var data = Storage.readSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, configKey);
        if (!data) {
            data = defaultValue;
        }
        configCache[configKey] = { data: data, loadedAt: now };
        return data;
    }
    ConfigLoader.loadConfig = loadConfig;
    function loadSatoriConfig(nk, configKey, defaultValue) {
        var now = Date.now();
        var cacheKey = "satori_" + configKey;
        var cached = configCache[cacheKey];
        if (cached && (now - cached.loadedAt) < CACHE_TTL_MS) {
            return cached.data;
        }
        var data = Storage.readSystemJson(nk, Constants.SATORI_CONFIGS_COLLECTION, configKey);
        if (!data) {
            data = defaultValue;
        }
        configCache[cacheKey] = { data: data, loadedAt: now };
        return data;
    }
    ConfigLoader.loadSatoriConfig = loadSatoriConfig;
    function saveConfig(nk, configKey, data) {
        Storage.writeSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, configKey, data);
        delete configCache[configKey];
    }
    ConfigLoader.saveConfig = saveConfig;
    function saveSatoriConfig(nk, configKey, data) {
        Storage.writeSystemJson(nk, Constants.SATORI_CONFIGS_COLLECTION, configKey, data);
        delete configCache["satori_" + configKey];
    }
    ConfigLoader.saveSatoriConfig = saveSatoriConfig;
    function invalidateCache(configKey) {
        if (configKey) {
            delete configCache[configKey];
            delete configCache["satori_" + configKey];
        }
        else {
            configCache = {};
        }
    }
    ConfigLoader.invalidateCache = invalidateCache;
})(ConfigLoader || (ConfigLoader = {}));
var Constants;
(function (Constants) {
    Constants.SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
    Constants.DEFAULT_GAME_ID = "default";
    function gameKey(gameId, key) {
        var gid = gameId || Constants.DEFAULT_GAME_ID;
        if (gid === Constants.DEFAULT_GAME_ID)
            return key;
        return gid + ":" + key;
    }
    Constants.gameKey = gameKey;
    // Hiro storage collections
    Constants.HIRO_CONFIGS_COLLECTION = "hiro_configs";
    Constants.HIRO_ACHIEVEMENTS_COLLECTION = "hiro_achievements";
    Constants.HIRO_INVENTORY_COLLECTION = "hiro_inventory";
    Constants.HIRO_PROGRESSION_COLLECTION = "hiro_progression";
    Constants.HIRO_ENERGY_COLLECTION = "hiro_energy";
    Constants.HIRO_STATS_COLLECTION = "hiro_stats";
    Constants.HIRO_STREAKS_COLLECTION = "hiro_streaks";
    Constants.HIRO_TUTORIALS_COLLECTION = "hiro_tutorials";
    Constants.HIRO_UNLOCKABLES_COLLECTION = "hiro_unlockables";
    Constants.HIRO_MAILBOX_COLLECTION = "hiro_mailbox";
    Constants.HIRO_CHALLENGES_COLLECTION = "hiro_challenges";
    Constants.HIRO_AUCTIONS_COLLECTION = "hiro_auctions";
    // Satori storage collections
    Constants.SATORI_CONFIGS_COLLECTION = "satori_configs";
    Constants.SATORI_EVENTS_COLLECTION = "satori_events";
    Constants.SATORI_IDENTITY_COLLECTION = "satori_identity_props";
    Constants.SATORI_ASSIGNMENTS_COLLECTION = "satori_assignments";
    Constants.SATORI_MESSAGES_COLLECTION = "satori_messages";
    Constants.SATORI_METRICS_COLLECTION = "satori_metrics";
    // Legacy storage collections (preserved for backward compatibility)
    Constants.WALLETS_COLLECTION = "wallets";
    Constants.LEADERBOARDS_REGISTRY_COLLECTION = "leaderboards_registry";
    Constants.DAILY_REWARDS_COLLECTION = "daily_rewards";
    Constants.MISSIONS_COLLECTION = "missions";
    Constants.QUIZ_RESULTS_COLLECTION = "quiz_results";
    Constants.GAME_REGISTRY_COLLECTION = "game_registry";
    Constants.ANALYTICS_COLLECTION = "analytics_error_events";
    Constants.PLAYER_METADATA_COLLECTION = "player_metadata";
    Constants.PUSH_TOKENS_COLLECTION = "push_tokens";
})(Constants || (Constants = {}));
var EventBus;
(function (EventBus) {
    var handlers = {};
    function on(eventName, handler) {
        if (!handlers[eventName]) {
            handlers[eventName] = [];
        }
        handlers[eventName].push(handler);
    }
    EventBus.on = on;
    function emit(nk, logger, ctx, eventName, data) {
        var eventHandlers = handlers[eventName];
        if (!eventHandlers)
            return;
        for (var i = 0; i < eventHandlers.length; i++) {
            try {
                eventHandlers[i](nk, logger, ctx, data);
            }
            catch (err) {
                logger.error("EventBus handler error for '%s': %s", eventName, err.message || String(err));
            }
        }
    }
    EventBus.emit = emit;
    // Well-known event names
    EventBus.Events = {
        CURRENCY_SPENT: "currency_spent",
        CURRENCY_EARNED: "currency_earned",
        ITEM_GRANTED: "item_granted",
        ITEM_CONSUMED: "item_consumed",
        ACHIEVEMENT_PROGRESS: "achievement_progress",
        ACHIEVEMENT_COMPLETED: "achievement_completed",
        ACHIEVEMENT_CLAIMED: "achievement_claimed",
        LEVEL_UP: "level_up",
        XP_EARNED: "xp_earned",
        ENERGY_SPENT: "energy_spent",
        ENERGY_REFILLED: "energy_refilled",
        STAT_UPDATED: "stat_updated",
        STREAK_UPDATED: "streak_updated",
        STREAK_BROKEN: "streak_broken",
        STORE_PURCHASE: "store_purchase",
        SCORE_SUBMITTED: "score_submitted",
        CHALLENGE_COMPLETED: "challenge_completed",
        REWARD_GRANTED: "reward_granted",
        GAME_STARTED: "game_started",
        GAME_COMPLETED: "game_completed",
        SESSION_START: "session_start",
        SESSION_END: "session_end",
    };
})(EventBus || (EventBus = {}));
var HttpClient;
(function (HttpClient) {
    function get(nk, url, headers) {
        var resp = nk.httpRequest(url, "get", headers || {}, "");
        return { code: resp.code, body: resp.body, headers: resp.headers || {} };
    }
    HttpClient.get = get;
    function post(nk, url, body, headers) {
        var hdrs = headers || {};
        if (!hdrs["Content-Type"]) {
            hdrs["Content-Type"] = "application/json";
        }
        var resp = nk.httpRequest(url, "post", hdrs, body);
        return { code: resp.code, body: resp.body, headers: resp.headers || {} };
    }
    HttpClient.post = post;
    function postJson(nk, url, data, headers) {
        var resp = post(nk, url, JSON.stringify(data), headers);
        if (resp.code >= 200 && resp.code < 300) {
            try {
                return JSON.parse(resp.body);
            }
            catch (_) {
                return resp.body;
            }
        }
        throw new Error("HTTP " + resp.code + ": " + resp.body);
    }
    HttpClient.postJson = postJson;
    function signedPost(nk, url, data, secret, additionalHeaders) {
        var body = JSON.stringify(data);
        var signatureBytes = nk.hmacSha256Hash(secret, body);
        var signature = nk.binaryToString(signatureBytes);
        var headers = {
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature
        };
        if (additionalHeaders) {
            for (var k in additionalHeaders) {
                headers[k] = additionalHeaders[k];
            }
        }
        return postJson(nk, url, data, headers);
    }
    HttpClient.signedPost = signedPost;
})(HttpClient || (HttpClient = {}));
var RewardEngine;
(function (RewardEngine) {
    function resolveReward(nk, reward) {
        var result = {
            currencies: {},
            items: {},
            energies: {},
            modifiers: []
        };
        if (reward.guaranteed) {
            mergeGrant(result, reward.guaranteed);
        }
        if (reward.weighted && reward.weighted.length > 0) {
            var rolls = reward.maxRolls || 1;
            for (var r = 0; r < rolls; r++) {
                var picked = pickWeighted(nk, reward.weighted);
                if (picked) {
                    mergeGrant(result, picked);
                }
            }
        }
        return result;
    }
    RewardEngine.resolveReward = resolveReward;
    function pickWeighted(nk, pool) {
        var totalWeight = 0;
        for (var i = 0; i < pool.length; i++) {
            totalWeight += pool[i].weight;
        }
        if (totalWeight <= 0)
            return null;
        var randStr = nk.uuidv4();
        var rand = simpleHash(randStr) % totalWeight;
        var cumulative = 0;
        for (var j = 0; j < pool.length; j++) {
            cumulative += pool[j].weight;
            if (rand < cumulative) {
                return pool[j];
            }
        }
        return pool[pool.length - 1];
    }
    function simpleHash(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            var ch = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + ch;
            hash = hash & 0x7FFFFFFF;
        }
        return hash;
    }
    function mergeGrant(target, grant) {
        if (grant.currencies) {
            for (var cid in grant.currencies) {
                if (!target.currencies[cid])
                    target.currencies[cid] = 0;
                target.currencies[cid] += grant.currencies[cid];
            }
        }
        if (grant.items) {
            for (var iid in grant.items) {
                var itemDef = grant.items[iid];
                var qty = itemDef.min;
                if (itemDef.max && itemDef.max > itemDef.min) {
                    qty = itemDef.min + Math.floor(Math.random() * (itemDef.max - itemDef.min + 1));
                }
                if (!target.items[iid])
                    target.items[iid] = 0;
                target.items[iid] += qty;
            }
        }
        if (grant.energies) {
            for (var eid in grant.energies) {
                if (!target.energies[eid])
                    target.energies[eid] = 0;
                target.energies[eid] += grant.energies[eid];
            }
        }
        if (grant.energyModifiers) {
            for (var m = 0; m < grant.energyModifiers.length; m++) {
                target.modifiers.push(grant.energyModifiers[m]);
            }
        }
        if (grant.rewardModifiers) {
            for (var n = 0; n < grant.rewardModifiers.length; n++) {
                target.modifiers.push(grant.rewardModifiers[n]);
            }
        }
    }
    function grantReward(nk, logger, ctx, userId, gameId, resolved) {
        // Grant currencies
        for (var cid in resolved.currencies) {
            if (resolved.currencies[cid] > 0) {
                WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, cid, resolved.currencies[cid]);
            }
        }
        // Grant items via inventory system
        for (var iid in resolved.items) {
            if (resolved.items[iid] > 0) {
                HiroInventory.grantItem(nk, logger, ctx, userId, iid, resolved.items[iid], undefined, undefined, gameId);
            }
        }
        // Grant energy
        for (var eid in resolved.energies) {
            if (resolved.energies[eid] > 0) {
                HiroEnergy.addEnergy(nk, logger, ctx, userId, eid, resolved.energies[eid], gameId);
            }
        }
        EventBus.emit(nk, logger, ctx, EventBus.Events.REWARD_GRANTED, {
            userId: userId, gameId: gameId, reward: resolved
        });
    }
    RewardEngine.grantReward = grantReward;
    function grantToMailbox(nk, userId, subject, reward, expiresAt) {
        var msg = {
            id: nk.uuidv4(),
            subject: subject,
            reward: reward,
            createdAt: Math.floor(Date.now() / 1000),
            expiresAt: expiresAt
        };
        var mailbox = Storage.readJson(nk, Constants.HIRO_MAILBOX_COLLECTION, "inbox", userId);
        if (!mailbox) {
            mailbox = { messages: [] };
        }
        mailbox.messages.push(msg);
        Storage.writeJson(nk, Constants.HIRO_MAILBOX_COLLECTION, "inbox", userId, mailbox);
    }
    RewardEngine.grantToMailbox = grantToMailbox;
})(RewardEngine || (RewardEngine = {}));
var RpcHelpers;
(function (RpcHelpers) {
    function validatePayload(payload, fields) {
        var missing = [];
        for (var i = 0; i < fields.length; i++) {
            if (!payload.hasOwnProperty(fields[i]) || payload[fields[i]] === null || payload[fields[i]] === undefined) {
                missing.push(fields[i]);
            }
        }
        return { valid: missing.length === 0, missing: missing };
    }
    RpcHelpers.validatePayload = validatePayload;
    function safeJsonParse(payload) {
        try {
            var data = JSON.parse(payload);
            return { success: true, data: data, error: null };
        }
        catch (err) {
            return { success: false, data: null, error: err.message || "Invalid JSON" };
        }
    }
    RpcHelpers.safeJsonParse = safeJsonParse;
    function successResponse(data) {
        return JSON.stringify({ success: true, data: data });
    }
    RpcHelpers.successResponse = successResponse;
    function errorResponse(message, code) {
        return JSON.stringify({ success: false, error: message, code: code || 0 });
    }
    RpcHelpers.errorResponse = errorResponse;
    function parseRpcPayload(payload) {
        if (!payload || payload === "") {
            return {};
        }
        var result = safeJsonParse(payload);
        if (!result.success) {
            throw new Error("Invalid JSON payload: " + result.error);
        }
        return result.data;
    }
    RpcHelpers.parseRpcPayload = parseRpcPayload;
    function logRpcError(nk, logger, rpcName, errorMessage, userId, gameId) {
        try {
            var now = new Date();
            var key = "err_" + rpcName + "_" + (userId || "system") + "_" + Date.now();
            nk.storageWrite([{
                    collection: Constants.ANALYTICS_COLLECTION,
                    key: key,
                    userId: Constants.SYSTEM_USER_ID,
                    value: {
                        rpc_name: rpcName,
                        error_message: errorMessage,
                        user_id: userId || null,
                        game_id: gameId || null,
                        timestamp: now.toISOString(),
                        date: now.toISOString().slice(0, 10)
                    },
                    permissionRead: 0,
                    permissionWrite: 0
                }]);
        }
        catch (_) {
            // Silently ignore logging failures
        }
    }
    RpcHelpers.logRpcError = logRpcError;
    function requireUserId(ctx) {
        if (!ctx.userId) {
            throw new Error("User ID is required");
        }
        return ctx.userId;
    }
    RpcHelpers.requireUserId = requireUserId;
    function requireAdmin(ctx, nk) {
        if (!ctx.userId)
            throw new Error("Authentication required");
        try {
            var accounts = nk.accountsGetId([ctx.userId]);
            if (accounts && accounts.length > 0) {
                var metadata = accounts[0].user.metadata;
                if (metadata && metadata.admin === true)
                    return;
            }
        }
        catch (_) { }
        // For development, allow all authenticated users admin access
        // In production, uncomment the line below:
        // throw new Error("Admin access required");
    }
    RpcHelpers.requireAdmin = requireAdmin;
})(RpcHelpers || (RpcHelpers = {}));
var Storage;
(function (Storage) {
    function readJson(nk, collection, key, userId) {
        var records = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
        return null;
    }
    Storage.readJson = readJson;
    function writeJson(nk, collection, key, userId, value, permissionRead, permissionWrite) {
        nk.storageWrite([{
                collection: collection,
                key: key,
                userId: userId,
                value: value,
                permissionRead: permissionRead !== undefined ? permissionRead : 1,
                permissionWrite: permissionWrite !== undefined ? permissionWrite : 1
            }]);
    }
    Storage.writeJson = writeJson;
    function writeSystemJson(nk, collection, key, value) {
        nk.storageWrite([{
                collection: collection,
                key: key,
                userId: Constants.SYSTEM_USER_ID,
                value: value,
                permissionRead: 2,
                permissionWrite: 0
            }]);
    }
    Storage.writeSystemJson = writeSystemJson;
    function readSystemJson(nk, collection, key) {
        return readJson(nk, collection, key, Constants.SYSTEM_USER_ID);
    }
    Storage.readSystemJson = readSystemJson;
    function deleteRecord(nk, collection, key, userId) {
        nk.storageDelete([{ collection: collection, key: key, userId: userId }]);
    }
    Storage.deleteRecord = deleteRecord;
    function readMultiple(nk, reads) {
        return nk.storageRead(reads) || [];
    }
    Storage.readMultiple = readMultiple;
    function writeMultiple(nk, writes) {
        if (writes.length > 0) {
            nk.storageWrite(writes);
        }
    }
    Storage.writeMultiple = writeMultiple;
    function listUserRecords(nk, collection, userId, limit, cursor) {
        var result = nk.storageList(userId, collection, limit || 100, cursor);
        return {
            records: result.objects || [],
            cursor: result.cursor || ""
        };
    }
    Storage.listUserRecords = listUserRecords;
})(Storage || (Storage = {}));
var WalletHelpers;
(function (WalletHelpers) {
    function getGameWallet(nk, userId, gameId) {
        var key = "wallet_" + userId + "_" + gameId;
        var wallet = Storage.readJson(nk, Constants.WALLETS_COLLECTION, key, userId);
        if (!wallet) {
            return {
                userId: userId,
                gameId: gameId,
                currencies: { game: 0, tokens: 0, xp: 0 },
                items: {}
            };
        }
        if (wallet.currencies) {
            if (wallet.currencies.game === undefined)
                wallet.currencies.game = wallet.currencies.tokens || 0;
            if (wallet.currencies.tokens === undefined)
                wallet.currencies.tokens = wallet.currencies.game || 0;
        }
        return wallet;
    }
    WalletHelpers.getGameWallet = getGameWallet;
    function saveGameWallet(nk, wallet) {
        var key = "wallet_" + wallet.userId + "_" + wallet.gameId;
        Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, wallet.userId, wallet, 1, 1);
    }
    WalletHelpers.saveGameWallet = saveGameWallet;
    function addCurrency(nk, logger, ctx, userId, gameId, currencyId, amount) {
        var wallet = getGameWallet(nk, userId, gameId);
        if (!wallet.currencies[currencyId]) {
            wallet.currencies[currencyId] = 0;
        }
        wallet.currencies[currencyId] += amount;
        saveGameWallet(nk, wallet);
        EventBus.emit(nk, logger, ctx, EventBus.Events.CURRENCY_EARNED, {
            userId: userId, gameId: gameId, currencyId: currencyId, amount: amount, newBalance: wallet.currencies[currencyId]
        });
        return wallet;
    }
    WalletHelpers.addCurrency = addCurrency;
    function spendCurrency(nk, logger, ctx, userId, gameId, currencyId, amount) {
        var wallet = getGameWallet(nk, userId, gameId);
        var balance = wallet.currencies[currencyId] || 0;
        if (balance < amount) {
            throw new Error("Insufficient " + currencyId + ": have " + balance + ", need " + amount);
        }
        wallet.currencies[currencyId] = balance - amount;
        saveGameWallet(nk, wallet);
        EventBus.emit(nk, logger, ctx, EventBus.Events.CURRENCY_SPENT, {
            userId: userId, gameId: gameId, currencyId: currencyId, amount: amount, newBalance: wallet.currencies[currencyId]
        });
        return wallet;
    }
    WalletHelpers.spendCurrency = spendCurrency;
    function hasCurrency(nk, userId, gameId, currencyId, amount) {
        var wallet = getGameWallet(nk, userId, gameId);
        return (wallet.currencies[currencyId] || 0) >= amount;
    }
    WalletHelpers.hasCurrency = hasCurrency;
})(WalletHelpers || (WalletHelpers = {}));
