/**
 * Caching Layer for Multi-Game Platform
 * Improve performance for frequently accessed data
 */

// In-memory cache (use Redis in production)
var cache = {};

/**
 * Cache configuration
 */
var CacheConfig = {
    // TTL in seconds for different data types
    LEADERBOARD: 60,           // 1 minute
    PROFILE: 300,              // 5 minutes
    ACHIEVEMENT_DEFINITIONS: 600, // 10 minutes
    WALLET: 30,                // 30 seconds
    TOURNAMENT_LIST: 120,      // 2 minutes
    DAILY_REWARDS: 300         // 5 minutes
};

/**
 * Set cache value with TTL
 */
var cacheSet = function(key, value, ttlSeconds) {
    var now = Math.floor(Date.now() / 1000);
    
    cache[key] = {
        value: value,
        expires_at: now + ttlSeconds,
        created_at: now
    };
};

/**
 * Get cache value if not expired
 */
var cacheGet = function(key) {
    var now = Math.floor(Date.now() / 1000);
    
    if (!cache[key]) {
        return null;
    }
    
    var entry = cache[key];
    
    // Check if expired
    if (entry.expires_at < now) {
        delete cache[key];
        return null;
    }
    
    return entry.value;
};

/**
 * Delete cache entry
 */
var cacheDelete = function(key) {
    delete cache[key];
};

/**
 * Clear cache by pattern
 */
var cacheClearByPattern = function(pattern) {
    var regex = new RegExp(pattern);
    var keys = Object.keys(cache);
    
    for (var i = 0; i < keys.length; i++) {
        if (regex.test(keys[i])) {
            delete cache[keys[i]];
        }
    }
};

/**
 * Clear all expired entries (cleanup)
 */
var cacheCleanup = function() {
    var now = Math.floor(Date.now() / 1000);
    var keys = Object.keys(cache);
    var cleaned = 0;
    
    for (var i = 0; i < keys.length; i++) {
        if (cache[keys[i]].expires_at < now) {
            delete cache[keys[i]];
            cleaned++;
        }
    }
    
    return cleaned;
};

/**
 * Wrapper to add caching to any RPC
 */
var withCache = function(rpcFunction, rpcName, ttlSeconds, cacheKeyGenerator) {
    return function(ctx, logger, nk, payload) {
        // Generate cache key
        var cacheKey = cacheKeyGenerator(ctx, payload);
        
        // Check cache
        var cached = cacheGet(cacheKey);
        
        if (cached !== null) {
            logger.debug("[Cache] Hit for " + rpcName + ": " + cacheKey);
            return JSON.stringify({
                success: true,
                cached: true,
                data: cached
            });
        }
        
        logger.debug("[Cache] Miss for " + rpcName + ": " + cacheKey);
        
        // Call original function
        var response = rpcFunction(ctx, logger, nk, payload);
        var parsed = JSON.parse(response);
        
        // Cache successful responses
        if (parsed.success) {
            cacheSet(cacheKey, parsed, ttlSeconds);
        }
        
        return response;
    };
};

/**
 * Example cache key generators
 */
var CacheKeyGenerators = {
    // User-specific data
    userGameKey: function(ctx, payload) {
        var data = JSON.parse(payload || '{}');
        return ctx.userId + "_" + data.game_id;
    },
    
    // Leaderboard data
    leaderboardKey: function(ctx, payload) {
        var data = JSON.parse(payload || '{}');
        return "leaderboard_" + data.game_id + "_" + data.period;
    },
    
    // Achievement definitions (game-wide)
    achievementDefsKey: function(ctx, payload) {
        var data = JSON.parse(payload || '{}');
        return "achievements_" + data.game_id;
    },
    
    // Tournament list
    tournamentListKey: function(ctx, payload) {
        var data = JSON.parse(payload || '{}');
        return "tournaments_" + data.game_id;
    }
};

/**
 * RPC: cache_stats
 * Get cache statistics
 */
var rpcCacheStats = function(ctx, logger, nk, payload) {
    try {
        var now = Math.floor(Date.now() / 1000);
        var keys = Object.keys(cache);
        
        var totalEntries = keys.length;
        var expiredEntries = 0;
        var totalSize = 0;
        
        for (var i = 0; i < keys.length; i++) {
            var entry = cache[keys[i]];
            
            if (entry.expires_at < now) {
                expiredEntries++;
            }
            
            // Rough size estimate
            totalSize += JSON.stringify(entry.value).length;
        }
        
        return JSON.stringify({
            success: true,
            cache_stats: {
                total_entries: totalEntries,
                expired_entries: expiredEntries,
                active_entries: totalEntries - expiredEntries,
                estimated_size_bytes: totalSize
            }
        });
        
    } catch (err) {
        logger.error("[Cache] Stats error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: cache_clear (Admin only)
 * Clear cache entries
 */
var rpcCacheClear = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        var pattern = data.pattern;
        
        if (pattern) {
            cacheClearByPattern(pattern);
            logger.info("[Cache] Cleared entries matching pattern: " + pattern);
        } else {
            cache = {};
            logger.info("[Cache] Cleared all entries");
        }
        
        return JSON.stringify({
            success: true,
            message: pattern ? "Cleared entries matching pattern" : "Cleared all cache"
        });
        
    } catch (err) {
        logger.error("[Cache] Clear error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

// Auto-cleanup expired entries every 5 minutes
// In production, use Nakama scheduler or external cron
// setInterval(cacheCleanup, 300000);
