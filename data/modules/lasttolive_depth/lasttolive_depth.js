// lasttolive_depth.js - Deep LastToLive RPCs: Weapon Mastery, Nemesis, Bounties, and more
// Nakama V8 JavaScript runtime (No ES Modules)

// ============================================================================
// UTILITY HELPERS
// ============================================================================

function ltlParsePayload(payload, requiredFields) {
    var data = {};
    try {
        data = JSON.parse(payload || "{}");
    } catch (e) {
        throw Error("Invalid JSON payload");
    }
    for (var i = 0; i < requiredFields.length; i++) {
        if (data[requiredFields[i]] === undefined || data[requiredFields[i]] === null) {
            throw Error("Missing required field: " + requiredFields[i]);
        }
    }
    return data;
}

function ltlStorageRead(nk, collection, key, userId) {
    var records = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
    if (records && records.length > 0 && records[0].value) {
        return records[0].value;
    }
    return null;
}

function ltlStorageWrite(nk, collection, key, userId, value) {
    nk.storageWrite([{
        collection: collection,
        key: key,
        userId: userId,
        value: value,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function ltlGetMasteryTier(kills) {
    if (kills >= 500) return { tier: "Master", next: null, progress: 100 };
    if (kills >= 200) return { tier: "Expert", next: 500, progress: Math.round(((kills - 200) / 300) * 100) };
    if (kills >= 50) return { tier: "Apprentice", next: 200, progress: Math.round(((kills - 50) / 150) * 100) };
    return { tier: "Novice", next: 50, progress: Math.round((kills / 50) * 100) };
}

// ============================================================================
// 1. WEAPON MASTERY
// ============================================================================

function rpcLasttoliveWeaponMastery(ctx, logger, nk, payload) {
    try {
        var data = ltlParsePayload(payload, ["game_id", "action"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collection = gameId + "_weapon_mastery";

        var mastery = ltlStorageRead(nk, collection, "weapons", userId) || { weapons: {} };

        if (data.action === "get") {
            var weaponList = [];
            var wKeys = Object.keys(mastery.weapons);
            for (var i = 0; i < wKeys.length; i++) {
                var w = mastery.weapons[wKeys[i]];
                var tierInfo = ltlGetMasteryTier(w.kills);
                weaponList.push({
                    weapon_id: wKeys[i],
                    kills: w.kills,
                    damage: w.damage,
                    headshots: w.headshots || 0,
                    tier: tierInfo.tier,
                    progress_to_next: tierInfo.progress
                });
            }

            return JSON.stringify({
                success: true,
                weapons: weaponList
            });

        } else if (data.action === "update") {
            if (!data.weapon_id) {
                return JSON.stringify({ success: false, error: "weapon_id required" });
            }
            var wid = data.weapon_id;
            if (!mastery.weapons[wid]) {
                mastery.weapons[wid] = { kills: 0, damage: 0, headshots: 0 };
            }

            var oldKills = mastery.weapons[wid].kills;
            mastery.weapons[wid].kills += (data.kills || 0);
            mastery.weapons[wid].damage += (data.damage || 0);
            mastery.weapons[wid].headshots += (data.headshots || 0);
            var newKills = mastery.weapons[wid].kills;

            var oldTier = ltlGetMasteryTier(oldKills);
            var newTier = ltlGetMasteryTier(newKills);

            var tierUpReward = null;
            if (oldTier.tier !== newTier.tier) {
                var rewardCoins = 0;
                if (newTier.tier === "Apprentice") rewardCoins = 100;
                else if (newTier.tier === "Expert") rewardCoins = 250;
                else if (newTier.tier === "Master") rewardCoins = 500;

                if (rewardCoins > 0) {
                    nk.walletUpdate(userId, { coins: rewardCoins }, {
                        reason: "weapon_mastery_tier_up",
                        weapon_id: wid,
                        new_tier: newTier.tier
                    }, true);
                    tierUpReward = { coins: rewardCoins, new_tier: newTier.tier };
                }
            }

            ltlStorageWrite(nk, collection, "weapons", userId, mastery);

            var updatedList = [];
            var allKeys = Object.keys(mastery.weapons);
            for (var u = 0; u < allKeys.length; u++) {
                var uw = mastery.weapons[allKeys[u]];
                var uTier = ltlGetMasteryTier(uw.kills);
                updatedList.push({
                    weapon_id: allKeys[u],
                    kills: uw.kills,
                    damage: uw.damage,
                    headshots: uw.headshots || 0,
                    tier: uTier.tier,
                    progress_to_next: uTier.progress
                });
            }

            return JSON.stringify({
                success: true,
                weapons: updatedList,
                tier_up: tierUpReward
            });

        } else {
            return JSON.stringify({ success: false, error: "Invalid action. Use get or update" });
        }

    } catch (err) {
        logger.error("rpcLasttoliveWeaponMastery error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 2. NEMESIS
// ============================================================================

function rpcLasttoliveNemesisGet(ctx, logger, nk, payload) {
    try {
        var data = ltlParsePayload(payload, ["game_id"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collection = gameId + "_nemesis_data";

        var nemesisData = ltlStorageRead(nk, collection, "nemesis", userId);

        if (!nemesisData) {
            return JSON.stringify({
                success: true,
                nemesis: null,
                your_nemesis_of: []
            });
        }

        return JSON.stringify({
            success: true,
            nemesis: nemesisData.nemesis || null,
            your_nemesis_of: nemesisData.your_nemesis_of || []
        });

    } catch (err) {
        logger.error("rpcLasttoliveNemesisGet error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 3. HIGHLIGHT REEL
// ============================================================================

function rpcLasttoliveHighlightReel(ctx, logger, nk, payload) {
    try {
        var data = ltlParsePayload(payload, ["game_id"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collection = gameId + "_player_highlights";

        var highlightData = ltlStorageRead(nk, collection, "highlights", userId);

        if (!highlightData || !highlightData.highlights) {
            return JSON.stringify({
                success: true,
                highlights: []
            });
        }

        return JSON.stringify({
            success: true,
            highlights: highlightData.highlights
        });

    } catch (err) {
        logger.error("rpcLasttoliveHighlightReel error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 4. REVENGE MATCH
// ============================================================================

function rpcLasttoliveRevengeMatch(ctx, logger, nk, payload) {
    try {
        var data = ltlParsePayload(payload, ["game_id", "target_user_id"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collection = gameId + "_revenge_matches";

        var matchId = gameId + "_revenge_" + userId.substring(0, 8) + "_" + Date.now();
        var revengeData = {
            match_id: matchId,
            challenger: userId,
            challenger_name: ctx.username || "Unknown",
            target: data.target_user_id,
            status: "pending",
            created_at: Date.now(),
            expires_at: Date.now() + 3600000
        };

        ltlStorageWrite(nk, collection, matchId, userId, revengeData);

        try {
            nk.notificationSend(
                data.target_user_id,
                "Revenge Match Challenge",
                2,
                {
                    match_id: matchId,
                    challenger: userId,
                    challenger_name: ctx.username || "Unknown"
                },
                userId
            );
        } catch (notifErr) {
            logger.warn("Could not send revenge notification: " + notifErr.message);
        }

        return JSON.stringify({
            success: true,
            match_id: matchId,
            status: "pending"
        });

    } catch (err) {
        logger.error("rpcLasttoliveRevengeMatch error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 5. BOUNTY CREATE
// ============================================================================

function rpcLasttoliveBountyCreate(ctx, logger, nk, payload) {
    try {
        var data = ltlParsePayload(payload, ["game_id", "target_user_id", "reward_amount"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collection = gameId + "_bounties";
        var rewardAmount = data.reward_amount;

        if (rewardAmount <= 0) {
            return JSON.stringify({ success: false, error: "reward_amount must be positive" });
        }
        if (data.target_user_id === userId) {
            return JSON.stringify({ success: false, error: "Cannot place a bounty on yourself" });
        }

        nk.walletUpdate(userId, { coins: -rewardAmount }, {
            reason: "bounty_placement",
            target: data.target_user_id
        }, true);

        var bountyId = gameId + "_bounty_" + userId.substring(0, 8) + "_" + Date.now();
        var bountyData = {
            bounty_id: bountyId,
            target: data.target_user_id,
            reward: rewardAmount,
            created_by: userId,
            created_by_name: ctx.username || "Unknown",
            status: "active",
            created_at: Date.now(),
            expires_at: Date.now() + 86400000
        };

        ltlStorageWrite(nk, collection, bountyId, userId, bountyData);

        var indexData = ltlStorageRead(nk, collection, "active_index", "00000000-0000-0000-0000-000000000000") || { bounties: [] };
        indexData.bounties.push({
            bounty_id: bountyId,
            target: data.target_user_id,
            reward: rewardAmount,
            created_by: userId,
            expires_at: bountyData.expires_at
        });
        ltlStorageWrite(nk, collection, "active_index", "00000000-0000-0000-0000-000000000000", indexData);

        return JSON.stringify({
            success: true,
            bounty_id: bountyId,
            target: data.target_user_id,
            reward: rewardAmount,
            expires_at: bountyData.expires_at
        });

    } catch (err) {
        logger.error("rpcLasttoliveBountyCreate error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 6. BOUNTY LIST
// ============================================================================

function rpcLasttoliveBountyList(ctx, logger, nk, payload) {
    try {
        var data = ltlParsePayload(payload, ["game_id"]);
        var gameId = data.game_id;
        var collection = gameId + "_bounties";

        var indexData = ltlStorageRead(nk, collection, "active_index", "00000000-0000-0000-0000-000000000000");
        if (!indexData || !indexData.bounties) {
            return JSON.stringify({ success: true, bounties: [] });
        }

        var now = Date.now();
        var activeBounties = [];
        for (var i = 0; i < indexData.bounties.length; i++) {
            var b = indexData.bounties[i];
            if (b.expires_at > now) {
                activeBounties.push({
                    id: b.bounty_id,
                    target: b.target,
                    reward: b.reward,
                    created_by: b.created_by,
                    expires_at: b.expires_at
                });
            }
        }

        return JSON.stringify({
            success: true,
            bounties: activeBounties
        });

    } catch (err) {
        logger.error("rpcLasttoliveBountyList error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 7. LOADOUT SAVE
// ============================================================================

function rpcLasttoliveLoadoutSave(ctx, logger, nk, payload) {
    try {
        var data = ltlParsePayload(payload, ["game_id", "loadout_name", "weapons"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collection = gameId + "_loadouts";

        var allLoadouts = ltlStorageRead(nk, collection, "loadouts", userId) || { loadouts: [] };

        if (allLoadouts.loadouts.length >= 5) {
            return JSON.stringify({ success: false, error: "Maximum 5 loadouts allowed. Delete one first." });
        }

        var loadoutId = gameId + "_loadout_" + userId.substring(0, 8) + "_" + Date.now();
        var newLoadout = {
            id: loadoutId,
            name: data.loadout_name,
            weapons: data.weapons,
            attachments: data.attachments || [],
            created_at: Date.now()
        };

        allLoadouts.loadouts.push(newLoadout);
        ltlStorageWrite(nk, collection, "loadouts", userId, allLoadouts);

        return JSON.stringify({
            success: true,
            loadout_id: loadoutId
        });

    } catch (err) {
        logger.error("rpcLasttoliveLoadoutSave error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 8. LOADOUT LIST
// ============================================================================

function rpcLasttoliveLoadoutList(ctx, logger, nk, payload) {
    try {
        var data = ltlParsePayload(payload, ["game_id"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collection = gameId + "_loadouts";

        var allLoadouts = ltlStorageRead(nk, collection, "loadouts", userId) || { loadouts: [] };

        return JSON.stringify({
            success: true,
            loadouts: allLoadouts.loadouts
        });

    } catch (err) {
        logger.error("rpcLasttoliveLoadoutList error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// REGISTRATION
// ============================================================================

function registerLasttoliveDepthRPCs(initializer, logger) {
    logger.info("[LasttoliveDepth] Initializing LastToLive Depth RPCs...");

    if (!globalThis.__registeredRPCs) {
        globalThis.__registeredRPCs = new Set();
    }

    var rpcs = [
        { id: "lasttolive_weapon_mastery", handler: rpcLasttoliveWeaponMastery },
        { id: "lasttolive_nemesis_get", handler: rpcLasttoliveNemesisGet },
        { id: "lasttolive_highlight_reel", handler: rpcLasttoliveHighlightReel },
        { id: "lasttolive_revenge_match", handler: rpcLasttoliveRevengeMatch },
        { id: "lasttolive_bounty_create", handler: rpcLasttoliveBountyCreate },
        { id: "lasttolive_bounty_list", handler: rpcLasttoliveBountyList },
        { id: "lasttolive_loadout_save", handler: rpcLasttoliveLoadoutSave },
        { id: "lasttolive_loadout_list", handler: rpcLasttoliveLoadoutList }
    ];

    var registered = 0;
    var skipped = 0;

    for (var i = 0; i < rpcs.length; i++) {
        var rpc = rpcs[i];
        if (!globalThis.__registeredRPCs.has(rpc.id)) {
            try {
                initializer.registerRpc(rpc.id, rpc.handler);
                globalThis.__registeredRPCs.add(rpc.id);
                logger.info("[LasttoliveDepth] Registered RPC: " + rpc.id);
                registered++;
            } catch (err) {
                logger.error("[LasttoliveDepth] Failed to register " + rpc.id + ": " + err.message);
            }
        } else {
            logger.info("[LasttoliveDepth] Skipped (already registered): " + rpc.id);
            skipped++;
        }
    }

    logger.info("[LasttoliveDepth] Registration complete: " + registered + " registered, " + skipped + " skipped");
}
