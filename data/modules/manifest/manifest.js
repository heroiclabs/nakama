// manifest.js - Asset Manifest Version Check for QuizVerse v3.0
// RPC: manifest_get_version

/**
 * Asset Manifest System — Production-Ready
 *
 * Provides CDN asset manifest version to clients at startup.
 * Lightweight single-read RPC — no writes on normal requests.
 *
 * Storage: collection="game_config", key="manifest_{gameId}"
 */

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

var MANIFEST_STORAGE_COLLECTION = 'game_config';

// ─── HELPERS ────────────────────────────────────────────────────────────────

function manifestErrorResponse(msg) {
    return JSON.stringify({ success: false, error: msg });
}

function manifestValidatePayload(payload) {
    if (!payload || payload === '') return {};
    try {
        return JSON.parse(payload);
    } catch (err) {
        return null;
    }
}

// ─── RPC: manifest_get_version ──────────────────────────────────────────────

function rpcManifestGetVersion(ctx, logger, nk, payload) {
    // No auth required for manifest check (can be called pre-login)
    var data = manifestValidatePayload(payload);
    if (data === null) return manifestErrorResponse('Invalid JSON payload');

    var gameId = data.gameId || 'quizverse';
    var manifestKey = 'manifest_' + gameId;

    try {
        // System-owned storage (userId = null for system reads, but Nakama requires
        // a userId for storageRead, so we use a well-known system user or empty string)
        var records = nk.storageRead([{
            collection: MANIFEST_STORAGE_COLLECTION,
            key: manifestKey,
            userId: '00000000-0000-0000-0000-000000000000'
        }]);

        if (records && records.length > 0 && records[0].value) {
            var manifest = records[0].value;

            return JSON.stringify({
                success: true,
                gameId: gameId,
                version: manifest.version || '1.0.0',
                cdnBaseUrl: manifest.cdnBaseUrl || '',
                manifestUrl: manifest.manifestUrl || '',
                minAppVersion: manifest.minAppVersion || '1.0.0',
                forceUpdate: manifest.forceUpdate || false,
                maintenanceMode: manifest.maintenanceMode || false,
                maintenanceMessage: manifest.maintenanceMessage || '',
                lastUpdatedAt: manifest.lastUpdatedAt || null,
                features: manifest.features || {},
                timestamp: new Date().toISOString()
            });
        }

        // No manifest found — return defaults (don't block the client)
        logger.warn('[Manifest] No manifest found for ' + gameId + ', returning defaults');

        return JSON.stringify({
            success: true,
            gameId: gameId,
            version: '1.0.0',
            cdnBaseUrl: '',
            manifestUrl: '',
            minAppVersion: '1.0.0',
            forceUpdate: false,
            maintenanceMode: false,
            maintenanceMessage: '',
            lastUpdatedAt: null,
            features: {},
            isDefault: true,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error('[Manifest] Storage read failed: ' + err.message);
        // Never block client on manifest failure
        return JSON.stringify({
            success: true,
            gameId: gameId,
            version: '1.0.0',
            cdnBaseUrl: '',
            manifestUrl: '',
            minAppVersion: '1.0.0',
            forceUpdate: false,
            maintenanceMode: false,
            maintenanceMessage: '',
            lastUpdatedAt: null,
            features: {},
            isDefault: true,
            fallback: true,
            timestamp: new Date().toISOString()
        });
    }
}
