// characters.js - Character System for QuizVerse v3.0
// RPCs: character_get_state, character_unlock, character_set_active

/**
 * Character System — Production-Ready
 *
 * Characters are cosmetic companions with XP bonuses.
 * Rule#7: Unlocking characters awards XP ONLY, never currency.
 *
 * Storage: collection="player_data", key="characters_{userId}_{gameId}"
 */

// ─── CHARACTER DEFINITIONS ──────────────────────────────────────────────────

var CHARACTER_DEFS = {
    quizzy: {
        id: 'quizzy',
        name: 'Quizzy',
        description: 'Your first quiz companion!',
        rarity: 'common',
        xpBonus: 0,
        unlockCondition: 'default',
        introVideoPath: 'Characters/Quizzy/intro.mp4',
        xpRewardOnUnlock: 0
    },
    autocurio: {
        id: 'autocurio',
        name: 'AUTOcurio',
        description: 'A charming, hyper-curious bot who awakens in the human world with an insatiable desire to understand everything.',
        rarity: 'common',
        xpBonus: 0,
        unlockCondition: 'default',
        introVideoPath: 'Characters/AUTOcurio/intro.mp4',
        xpRewardOnUnlock: 0
    },
    atlas: {
        id: 'atlas',
        name: 'Atlas',
        description: 'The world explorer who loves geography.',
        rarity: 'rare',
        xpBonus: 5,
        unlockCondition: 'badge_explorer_tier3',
        introVideoPath: 'Characters/Atlas/intro.mp4',
        xpRewardOnUnlock: 100
    },
    nova: {
        id: 'nova',
        name: 'Nova',
        description: 'A science genius from the stars.',
        rarity: 'rare',
        xpBonus: 5,
        unlockCondition: 'badge_science_tier3',
        introVideoPath: 'Characters/Nova/intro.mp4',
        xpRewardOnUnlock: 100
    },
    dog: {
        id: 'dog',
        name: 'Dog',
        description: 'A cute, loyal puppy character with floppy ears and a wagging tail.',
        rarity: 'rare',
        xpBonus: 5,
        unlockCondition: 'install_donut_disturb',
        introVideoPath: 'Characters/Dog/intro.mp4',
        xpRewardOnUnlock: 100
    },
    sparky: {
        id: 'sparky',
        name: 'Sparky',
        description: 'An energetic lightning-bolt character radiating electric energy.',
        rarity: 'rare',
        xpBonus: 5,
        unlockCondition: 'badge_speed_demon_gold',
        introVideoPath: 'Characters/Sparky/intro.mp4',
        xpRewardOnUnlock: 100
    },
    echo: {
        id: 'echo',
        name: 'Echo',
        description: 'A musical character with oversized headphones and sound wave aura.',
        rarity: 'rare',
        xpBonus: 5,
        unlockCondition: 'audio_review_10',
        introVideoPath: 'Characters/Echo/intro.mp4',
        xpRewardOnUnlock: 100
    },
    professor: {
        id: 'professor',
        name: 'Professor',
        description: 'A wise owl professor with round glasses and a book.',
        rarity: 'rare',
        xpBonus: 5,
        unlockCondition: 'smart_review_10',
        introVideoPath: 'Characters/Professor/intro.mp4',
        xpRewardOnUnlock: 100
    },
    pixel: {
        id: 'pixel',
        name: 'Pixel',
        description: 'A retro pixel-art character made of visible square pixels.',
        rarity: 'rare',
        xpBonus: 5,
        unlockCondition: 'badge_social_butterfly_day14',
        introVideoPath: 'Characters/Pixel/intro.mp4',
        xpRewardOnUnlock: 100
    },
    chronos: {
        id: 'chronos',
        name: 'Chronos',
        description: 'The timekeeper who knows all history.',
        rarity: 'epic',
        xpBonus: 10,
        unlockCondition: 'streak_30',
        introVideoPath: 'Characters/Chronos/intro.mp4',
        xpRewardOnUnlock: 250
    },
    phoenix: {
        id: 'phoenix',
        name: 'Phoenix',
        description: 'Reborn from the ashes of defeat.',
        rarity: 'epic',
        xpBonus: 10,
        unlockCondition: 'league_gold',
        introVideoPath: 'Characters/Phoenix/intro.mp4',
        xpRewardOnUnlock: 250
    },
    bear: {
        id: 'bear',
        name: 'Bear',
        description: 'A strong, friendly bear character representing dedication.',
        rarity: 'epic',
        xpBonus: 10,
        unlockCondition: 'donut_disturb_level_25',
        introVideoPath: 'Characters/Bear/intro.mp4',
        xpRewardOnUnlock: 250
    },
    duck: {
        id: 'duck',
        name: 'Duck',
        description: 'A cute rubber duck character with a quirky personality.',
        rarity: 'epic',
        xpBonus: 10,
        unlockCondition: 'donut_disturb_level_10',
        introVideoPath: 'Characters/Duck/intro.mp4',
        xpRewardOnUnlock: 250
    },
    luna: {
        id: 'luna',
        name: 'Luna',
        description: 'A mystical crescent moon character with a starry aura.',
        rarity: 'epic',
        xpBonus: 10,
        unlockCondition: 'badge_night_owl',
        introVideoPath: 'Characters/Luna/intro.mp4',
        xpRewardOnUnlock: 250
    },
    sage: {
        id: 'sage',
        name: 'Sage',
        description: 'The ultimate quiz master.',
        rarity: 'legendary',
        xpBonus: 15,
        unlockCondition: 'league_diamond',
        introVideoPath: 'Characters/Sage/intro.mp4',
        xpRewardOnUnlock: 500
    },
    ix: {
        id: 'ix',
        name: 'IX',
        description: 'IntelliVerse X ultimate character — futuristic AI entity.',
        rarity: 'legendary',
        xpBonus: 15,
        unlockCondition: 'ecosystem_points_2500',
        introVideoPath: 'Characters/IX/intro.mp4',
        xpRewardOnUnlock: 500
    }
};

var CHAR_STORAGE_COLLECTION = 'player_data';

// ─── HELPERS ────────────────────────────────────────────────────────────────

function charStorageKey(userId, gameId) {
    return 'characters_' + userId + '_' + gameId;
}

function readCharacterData(nk, logger, userId, gameId) {
    try {
        var records = nk.storageRead([{
            collection: CHAR_STORAGE_COLLECTION,
            key: charStorageKey(userId, gameId),
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (err) {
        logger.warn('[Characters] Storage read failed: ' + err.message);
    }
    return null;
}

function writeCharacterData(nk, logger, userId, gameId, data) {
    try {
        nk.storageWrite([{
            collection: CHAR_STORAGE_COLLECTION,
            key: charStorageKey(userId, gameId),
            userId: userId,
            value: data,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        logger.error('[Characters] Storage write failed: ' + err.message);
        return false;
    }
}

function initCharacterData(userId) {
    var now = new Date().toISOString();
    return {
        activeCharacter: 'quizzy',
        unlockedCharacters: {
            quizzy: { unlockedAt: now }
        },
        totalXpFromUnlocks: 0,
        createdAt: now,
        updatedAt: now
    };
}

function charErrorResponse(msg) {
    return JSON.stringify({ success: false, error: msg });
}

function charValidatePayload(payload) {
    if (!payload || payload === '') return {};
    try {
        return JSON.parse(payload);
    } catch (err) {
        return null;
    }
}

// ─── RPC: character_get_state ───────────────────────────────────────────────

function rpcCharacterGetState(ctx, logger, nk, payload) {
    if (!ctx.userId) return charErrorResponse('User not authenticated');

    var data = charValidatePayload(payload);
    if (data === null) return charErrorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var charData = readCharacterData(nk, logger, ctx.userId, gameId);

    if (!charData) {
        charData = initCharacterData(ctx.userId);
        writeCharacterData(nk, logger, ctx.userId, gameId, charData);
    }

    // Build characters array with unlock status
    var characters = [];
    for (var charId in CHARACTER_DEFS) {
        var def = CHARACTER_DEFS[charId];
        var isUnlocked = charData.unlockedCharacters && charData.unlockedCharacters[charId];

        characters.push({
            id: def.id,
            name: def.name,
            description: def.description,
            rarity: def.rarity,
            xpBonus: def.xpBonus,
            unlocked: !!isUnlocked,
            unlockedAt: isUnlocked ? charData.unlockedCharacters[charId].unlockedAt : null,
            unlockCondition: isUnlocked ? null : def.unlockCondition,
            introVideoPath: def.introVideoPath
        });
    }

    return JSON.stringify({
        success: true,
        userId: ctx.userId,
        gameId: gameId,
        activeCharacter: charData.activeCharacter,
        characters: characters,
        totalUnlocked: Object.keys(charData.unlockedCharacters || {}).length,
        totalCharacters: Object.keys(CHARACTER_DEFS).length,
        totalXpFromUnlocks: charData.totalXpFromUnlocks || 0,
        timestamp: new Date().toISOString()
    });
}

// ─── RPC: character_unlock ──────────────────────────────────────────────────

function rpcCharacterUnlock(ctx, logger, nk, payload) {
    if (!ctx.userId) return charErrorResponse('User not authenticated');

    var data = charValidatePayload(payload);
    if (data === null) return charErrorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var characterId = data.characterId;

    if (!characterId) return charErrorResponse('Missing required field: characterId');

    var def = CHARACTER_DEFS[characterId];
    if (!def) return charErrorResponse('Character not found: ' + characterId);

    var charData = readCharacterData(nk, logger, ctx.userId, gameId);
    if (!charData) {
        charData = initCharacterData(ctx.userId);
    }

    // Check if already unlocked
    if (charData.unlockedCharacters && charData.unlockedCharacters[characterId]) {
        return JSON.stringify({
            success: false,
            error: 'already_unlocked',
            characterId: characterId,
            unlockedAt: charData.unlockedCharacters[characterId].unlockedAt
        });
    }

    // NOTE: Unlock condition validation should be done client-side or via a separate check.
    // The server trusts that the client has verified the condition (badges, league tier, streak).
    // For critical conditions, add server-side validation here by reading badge/league/streak storage.

    var now = new Date().toISOString();
    var xpAwarded = def.xpRewardOnUnlock || 0;

    // Unlock character
    if (!charData.unlockedCharacters) charData.unlockedCharacters = {};
    charData.unlockedCharacters[characterId] = { unlockedAt: now };
    charData.totalXpFromUnlocks = (charData.totalXpFromUnlocks || 0) + xpAwarded;
    charData.updatedAt = now;

    // Rule#7: Award XP ONLY, never currency
    // XP is tracked in metadata, not wallet
    if (xpAwarded > 0) {
        try {
            // Update player metadata with XP
            var account = nk.accountGetId(ctx.userId);
            if (account) {
                var metadata = {};
                try {
                    metadata = JSON.parse(account.user.metadata || '{}');
                } catch (e) { metadata = {}; }

                metadata.totalXp = (metadata.totalXp || 0) + xpAwarded;
                metadata.lastXpSource = 'character_unlock_' + characterId;
                metadata.lastXpAt = now;

                nk.accountUpdateId(ctx.userId, null, null, null, null, null, null, null, JSON.stringify(metadata));
            }
        } catch (xpErr) {
            logger.warn('[Characters] XP update failed for ' + ctx.userId + ': ' + xpErr.message);
            // Non-critical — character is still unlocked
        }
    }

    if (!writeCharacterData(nk, logger, ctx.userId, gameId, charData)) {
        return charErrorResponse('Failed to save character data');
    }

    logger.info('[Characters] ' + characterId + ' unlocked for ' + ctx.userId + ' (+' + xpAwarded + ' XP)');

    return JSON.stringify({
        success: true,
        characterId: characterId,
        name: def.name,
        rarity: def.rarity,
        xpBonus: def.xpBonus,
        xpAwarded: xpAwarded,
        introVideoPath: def.introVideoPath,
        totalUnlocked: Object.keys(charData.unlockedCharacters).length,
        totalCharacters: Object.keys(CHARACTER_DEFS).length,
        timestamp: now
    });
}

// ─── RPC: character_set_active ──────────────────────────────────────────────

function rpcCharacterSetActive(ctx, logger, nk, payload) {
    if (!ctx.userId) return charErrorResponse('User not authenticated');

    var data = charValidatePayload(payload);
    if (data === null) return charErrorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var characterId = data.characterId;

    if (!characterId) return charErrorResponse('Missing required field: characterId');

    var def = CHARACTER_DEFS[characterId];
    if (!def) return charErrorResponse('Character not found: ' + characterId);

    var charData = readCharacterData(nk, logger, ctx.userId, gameId);
    if (!charData) {
        charData = initCharacterData(ctx.userId);
    }

    // Must be unlocked
    if (!charData.unlockedCharacters || !charData.unlockedCharacters[characterId]) {
        return charErrorResponse('Character not unlocked: ' + characterId);
    }

    // Already active?
    if (charData.activeCharacter === characterId) {
        return JSON.stringify({
            success: true,
            activeCharacter: characterId,
            alreadyActive: true
        });
    }

    var previousCharacter = charData.activeCharacter;
    charData.activeCharacter = characterId;
    charData.updatedAt = new Date().toISOString();

    if (!writeCharacterData(nk, logger, ctx.userId, gameId, charData)) {
        return charErrorResponse('Failed to save character data');
    }

    // Also update player metadata for quick access
    try {
        var account = nk.accountGetId(ctx.userId);
        if (account) {
            var metadata = {};
            try {
                metadata = JSON.parse(account.user.metadata || '{}');
            } catch (e) { metadata = {}; }
            metadata.activeCharacter = characterId;
            metadata.activeCharacterXpBonus = def.xpBonus;
            nk.accountUpdateId(ctx.userId, null, null, null, null, null, null, null, JSON.stringify(metadata));
        }
    } catch (metaErr) {
        logger.warn('[Characters] Metadata update failed: ' + metaErr.message);
    }

    logger.info('[Characters] ' + ctx.userId + ' switched character: ' + previousCharacter + ' → ' + characterId);

    return JSON.stringify({
        success: true,
        activeCharacter: characterId,
        previousCharacter: previousCharacter,
        xpBonus: def.xpBonus,
        timestamp: new Date().toISOString()
    });
}
