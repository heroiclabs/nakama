/**
 * Rate Limiting System for Multi-Game Platform
 * Prevent RPC abuse and spam
 */

// In-memory rate limit store (use Redis in production for distributed systems)
var rateLimits = {};

/**
 * Check rate limit for user/RPC combination
 */
var checkRateLimit = function(userId, rpcName, maxCalls, windowSeconds) {
    var key = userId + "_" + rpcName;
    var now = Math.floor(Date.now() / 1000);
    
    // Initialize if doesn't exist
    if (!rateLimits[key]) {
        rateLimits[key] = {
            calls: [],
            window_start: now
        };
    }
    
    var record = rateLimits[key];
    
    // Remove calls outside window
    record.calls = record.calls.filter(function(timestamp) {
        return timestamp > now - windowSeconds;
    });
    
    // Check if limit exceeded
    if (record.calls.length >= maxCalls) {
        var oldestCall = record.calls[0];
        var retryAfter = Math.ceil(oldestCall + windowSeconds - now);
        
        return {
            allowed: false,
            retry_after: retryAfter,
            calls_remaining: 0,
            reset_at: oldestCall + windowSeconds
        };
    }
    
    // Add current call
    record.calls.push(now);
    
    return {
        allowed: true,
        retry_after: 0,
        calls_remaining: maxCalls - record.calls.length,
        reset_at: now + windowSeconds
    };
};

/**
 * Wrapper function to add rate limiting to any RPC
 */
var withRateLimit = function(rpcFunction, rpcName, maxCalls, windowSeconds) {
    return function(ctx, logger, nk, payload) {
        var limit = checkRateLimit(ctx.userId, rpcName, maxCalls, windowSeconds);
        
        if (!limit.allowed) {
            logger.warn("[RateLimit] User " + ctx.userId + " exceeded limit for " + rpcName);
            
            return JSON.stringify({
                success: false,
                error: "Rate limit exceeded. Try again in " + limit.retry_after + " seconds.",
                retry_after: limit.retry_after,
                reset_at: limit.reset_at,
                rate_limit_info: {
                    max_calls: maxCalls,
                    window_seconds: windowSeconds
                }
            });
        }
        
        // Add rate limit headers to response
        var response = rpcFunction(ctx, logger, nk, payload);
        var parsed = JSON.parse(response);
        
        parsed.rate_limit_info = {
            calls_remaining: limit.calls_remaining,
            reset_at: limit.reset_at
        };
        
        return JSON.stringify(parsed);
    };
};

/**
 * RPC: rate_limit_status
 * Check current rate limit status for user
 */
var rpcRateLimitStatus = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        var userId = ctx.userId;
        var rpcName = data.rpc_name;
        
        if (!rpcName) {
            throw Error("rpc_name is required");
        }
        
        var key = userId + "_" + rpcName;
        var now = Math.floor(Date.now() / 1000);
        
        if (!rateLimits[key]) {
            return JSON.stringify({
                success: true,
                rpc_name: rpcName,
                calls_made: 0,
                calls_remaining: "N/A",
                message: "No rate limit data for this RPC"
            });
        }
        
        var record = rateLimits[key];
        
        // Clean old calls
        record.calls = record.calls.filter(function(timestamp) {
            return timestamp > now - 60; // Assume 60 second window
        });
        
        return JSON.stringify({
            success: true,
            rpc_name: rpcName,
            calls_made: record.calls.length,
            oldest_call: record.calls.length > 0 ? record.calls[0] : null
        });
        
    } catch (err) {
        logger.error("[RateLimit] Status check error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * Rate limit presets for different RPC categories
 */
var RateLimitPresets = {
    // Standard operations
    STANDARD: { maxCalls: 100, windowSeconds: 60 },
    
    // Write operations (wallet, score submission)
    WRITE: { maxCalls: 30, windowSeconds: 60 },
    
    // Read operations (leaderboards, profiles)
    READ: { maxCalls: 200, windowSeconds: 60 },
    
    // Authentication operations
    AUTH: { maxCalls: 10, windowSeconds: 60 },
    
    // Social operations (friend requests, chat)
    SOCIAL: { maxCalls: 50, windowSeconds: 60 },
    
    // Admin operations
    ADMIN: { maxCalls: 1000, windowSeconds: 60 },
    
    // Expensive operations (matchmaking, tournaments)
    EXPENSIVE: { maxCalls: 20, windowSeconds: 60 }
};

/**
 * Apply rate limit preset to RPC
 */
var withPresetRateLimit = function(rpcFunction, rpcName, preset) {
    var config = RateLimitPresets[preset] || RateLimitPresets.STANDARD;
    return withRateLimit(rpcFunction, rpcName, config.maxCalls, config.windowSeconds);
};

// Example usage in index.js:
// initializer.registerRpc("submit_score", withPresetRateLimit(rpcSubmitScore, "submit_score", "WRITE"));
