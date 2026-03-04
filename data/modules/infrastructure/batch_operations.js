/**
 * Batch Operations for Multi-Game Platform
 * Execute multiple RPCs in a single call for improved performance
 */

/**
 * RPC: batch_execute
 * Execute multiple RPCs in one call
 */
var rpcBatchExecute = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.operations || !Array.isArray(data.operations)) {
            throw Error("operations array is required");
        }
        
        var operations = data.operations;
        var atomic = data.atomic || false; // All or nothing
        
        logger.info("[Batch] Executing " + operations.length + " operations, atomic: " + atomic);
        
        var results = [];
        var allSuccessful = true;
        
        for (var i = 0; i < operations.length; i++) {
            var op = operations[i];
            
            try {
                if (!op.rpc_id || !op.payload) {
                    throw Error("Each operation must have rpc_id and payload");
                }
                
                var result = nk.rpcHttp(ctx, op.rpc_id, JSON.stringify(op.payload));
                var parsedResult = JSON.parse(result);
                
                results.push({
                    success: true,
                    operation_index: i,
                    rpc_id: op.rpc_id,
                    data: parsedResult
                });
                
            } catch (err) {
                allSuccessful = false;
                
                results.push({
                    success: false,
                    operation_index: i,
                    rpc_id: op.rpc_id,
                    error: err.message
                });
                
                // If atomic, stop on first error
                if (atomic) {
                    logger.error("[Batch] Atomic batch failed at operation " + i);
                    break;
                }
            }
        }
        
        return JSON.stringify({
            success: !atomic || allSuccessful,
            atomic: atomic,
            total_operations: operations.length,
            successful_operations: results.filter(function(r) { return r.success; }).length,
            failed_operations: results.filter(function(r) { return !r.success; }).length,
            results: results
        });
        
    } catch (err) {
        logger.error("[Batch] Execute error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: batch_wallet_operations
 * Optimized batch operations for wallet transactions
 */
var rpcBatchWalletOperations = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.operations || !Array.isArray(data.operations)) {
            throw Error("game_id and operations array are required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        var operations = data.operations;
        
        logger.info("[Batch] Processing " + operations.length + " wallet operations");
        
        // Get wallet once
        var walletKey = "wallet_" + userId + "_" + gameId;
        var wallet = { balance: 0 };
        
        try {
            var walletRecords = nk.storageRead([{
                collection: gameId + "_wallets",
                key: walletKey,
                userId: userId
            }]);
            
            if (walletRecords && walletRecords.length > 0 && walletRecords[0].value) {
                wallet = walletRecords[0].value;
            }
        } catch (err) {
            logger.debug("[Batch] Creating new wallet");
        }
        
        var initialBalance = wallet.balance;
        var results = [];
        
        // Apply all operations
        for (var i = 0; i < operations.length; i++) {
            var op = operations[i];
            
            try {
                if (!op.operation || !op.amount) {
                    throw Error("Each operation must have operation and amount");
                }
                
                if (op.operation === "add") {
                    wallet.balance += op.amount;
                } else if (op.operation === "subtract") {
                    if (wallet.balance < op.amount) {
                        throw Error("Insufficient balance for operation " + i);
                    }
                    wallet.balance -= op.amount;
                } else {
                    throw Error("Invalid operation: " + op.operation);
                }
                
                results.push({
                    success: true,
                    operation_index: i,
                    operation: op.operation,
                    amount: op.amount,
                    balance_after: wallet.balance
                });
                
            } catch (err) {
                results.push({
                    success: false,
                    operation_index: i,
                    error: err.message
                });
                
                // Rollback
                wallet.balance = initialBalance;
                throw Error("Batch wallet operation failed at index " + i + ": " + err.message);
            }
        }
        
        // Save wallet
        wallet.updated_at = new Date().toISOString();
        
        nk.storageWrite([{
            collection: gameId + "_wallets",
            key: walletKey,
            userId: userId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        return JSON.stringify({
            success: true,
            initial_balance: initialBalance,
            final_balance: wallet.balance,
            operations_completed: results.length,
            results: results
        });
        
    } catch (err) {
        logger.error("[Batch] Wallet operations error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: batch_achievement_progress
 * Update progress for multiple achievements in one call
 */
var rpcBatchAchievementProgress = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.achievements || !Array.isArray(data.achievements)) {
            throw Error("game_id and achievements array are required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        var achievements = data.achievements;
        
        logger.info("[Batch] Updating " + achievements.length + " achievement progress");
        
        var results = [];
        var unlocked = [];
        
        for (var i = 0; i < achievements.length; i++) {
            var ach = achievements[i];
            
            try {
                // Call individual achievement update RPC
                var updatePayload = {
                    game_id: gameId,
                    achievement_id: ach.achievement_id,
                    progress: ach.progress,
                    increment: ach.increment || false
                };
                
                var result = nk.rpcHttp(ctx, "achievements_update_progress", JSON.stringify(updatePayload));
                var parsedResult = JSON.parse(result);
                
                results.push({
                    success: parsedResult.success,
                    achievement_id: ach.achievement_id,
                    data: parsedResult
                });
                
                if (parsedResult.achievement && parsedResult.achievement.just_unlocked) {
                    unlocked.push(ach.achievement_id);
                }
                
            } catch (err) {
                results.push({
                    success: false,
                    achievement_id: ach.achievement_id,
                    error: err.message
                });
            }
        }
        
        return JSON.stringify({
            success: true,
            total_updated: results.filter(function(r) { return r.success; }).length,
            total_unlocked: unlocked.length,
            unlocked_achievements: unlocked,
            results: results
        });
        
    } catch (err) {
        logger.error("[Batch] Achievement progress error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};
