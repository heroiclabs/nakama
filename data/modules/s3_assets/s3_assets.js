/**
 * s3_assets.js - AWS S3 Asset Management Module for Nakama
 * 
 * Provides secure asset delivery via pre-signed S3 URLs.
 * Assets remain private in S3; clients get temporary download links.
 * 
 * RPCs:
 *   - s3_asset_download: Get pre-signed URL for a single asset
 *   - s3_asset_list: List all assets in a category with download URLs
 *   - s3_asset_upload: Upload asset to S3 (admin only)
 *   - s3_asset_manifest: Get cached asset manifest (no S3 round-trip)
 * 
 * Environment Variables Required:
 *   - AWS_ACCESS_KEY_ID
 *   - AWS_SECRET_ACCESS_KEY
 *   - AWS_REGION (default: us-east-1)
 *   - AWS_S3_BUCKET
 *   - AWS_PRESIGNED_URL_EXPIRY (default: 3600 seconds)
 */

// AWS Signature Version 4 implementation for S3 pre-signed URLs
var ALGORITHM = 'AWS4-HMAC-SHA256';

/**
 * Get AWS configuration from environment
 */
function getAwsConfig(ctx) {
    const accessKeyId = ctx.env['AWS_ACCESS_KEY_ID'];
    const secretAccessKey = ctx.env['AWS_SECRET_ACCESS_KEY'];
    const region = ctx.env['AWS_REGION'] || 'us-east-1';
    const bucket = ctx.env['AWS_S3_BUCKET'];
    const expirySeconds = parseInt(ctx.env['AWS_PRESIGNED_URL_EXPIRY'] || '3600', 10);

    if (!accessKeyId || !secretAccessKey || !bucket) {
        return null;
    }

    return { accessKeyId, secretAccessKey, region, bucket, expirySeconds };
}

/**
 * HMAC-SHA256 using Nakama's built-in crypto
 */
function hmacSha256(key, message) {
    // Nakama's nk.hmacSha256Hash returns hex string
    // For AWS Sig v4, we need binary for chaining
    return nk.hmacSha256Hash(key, message);
}

/**
 * Create hex-encoded SHA256 hash
 */
function sha256Hex(str) {
    return nk.sha256Hash(str);
}

/**
 * Get AWS4 signing key
 */
function getSigningKey(secretKey, dateStamp, region, service) {
    const kDate = hmacSha256('AWS4' + secretKey, dateStamp);
    const kRegion = hmacSha256(hexToBytes(kDate), region);
    const kService = hmacSha256(hexToBytes(kRegion), service);
    const kSigning = hmacSha256(hexToBytes(kService), 'aws4_request');
    return kSigning;
}

/**
 * Convert hex string to byte array for HMAC chaining
 */
function hexToBytes(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return String.fromCharCode.apply(null, bytes);
}

/**
 * URL encode per AWS requirements (RFC 3986)
 */
function awsUriEncode(str, encodeSlash) {
    if (!str) return '';
    let encoded = '';
    for (let i = 0; i < str.length; i++) {
        const ch = str.charAt(i);
        if ((ch >= 'A' && ch <= 'Z') ||
            (ch >= 'a' && ch <= 'z') ||
            (ch >= '0' && ch <= '9') ||
            ch === '_' || ch === '-' || ch === '~' || ch === '.') {
            encoded += ch;
        } else if (ch === '/') {
            encoded += encodeSlash ? '%2F' : ch;
        } else {
            encoded += '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
        }
    }
    return encoded;
}

/**
 * Generate pre-signed S3 URL using AWS Signature Version 4
 */
function generatePresignedUrl(config, objectKey, expiresIn) {
    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '').substring(0, 8);
    const amzDate = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    const host = config.bucket + '.s3.' + config.region + '.amazonaws.com';
    const canonicalUri = '/' + awsUriEncode(objectKey, false);
    const credentialScope = dateStamp + '/' + config.region + '/s3/aws4_request';
    
    // Query parameters for pre-signed URL
    const queryParams = {
        'X-Amz-Algorithm': ALGORITHM,
        'X-Amz-Credential': awsUriEncode(config.accessKeyId + '/' + credentialScope, true),
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': expiresIn.toString(),
        'X-Amz-SignedHeaders': 'host'
    };
    
    // Build canonical query string (sorted)
    const sortedKeys = Object.keys(queryParams).sort();
    const canonicalQueryString = sortedKeys.map(k => k + '=' + queryParams[k]).join('&');
    
    // Canonical headers
    const canonicalHeaders = 'host:' + host + '\n';
    const signedHeaders = 'host';
    
    // Canonical request
    const canonicalRequest = [
        'GET',
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders,
        signedHeaders,
        'UNSIGNED-PAYLOAD'
    ].join('\n');
    
    // String to sign
    const stringToSign = [
        ALGORITHM,
        amzDate,
        credentialScope,
        sha256Hex(canonicalRequest)
    ].join('\n');
    
    // Signing key and signature
    const signingKey = getSigningKey(config.secretAccessKey, dateStamp, config.region, 's3');
    const signature = hmacSha256(hexToBytes(signingKey), stringToSign);
    
    // Build final URL
    const presignedUrl = 'https://' + host + canonicalUri + '?' + 
        canonicalQueryString + '&X-Amz-Signature=' + signature;
    
    return presignedUrl;
}

/**
 * RPC: Download single asset - returns pre-signed URL
 * 
 * Request: { category: string, name: string }
 * Response: { name: string, downloadUrl: string, expiresAt: number }
 */
function rpcAssetDownload(ctx, logger, nk, payload) {
    const config = getAwsConfig(ctx);
    if (!config) {
        throw new Error('AWS S3 not configured. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET.');
    }

    let request;
    try {
        request = JSON.parse(payload);
    } catch (e) {
        throw new Error('Invalid JSON payload');
    }

    if (!request.category || !request.name) {
        throw new Error('category and name are required');
    }

    const objectKey = request.category + '/' + request.name;
    const downloadUrl = generatePresignedUrl(config, objectKey, config.expirySeconds);
    const expiresAt = Math.floor(Date.now() / 1000) + config.expirySeconds;

    logger.info('Generated pre-signed URL for: %s', objectKey);

    return JSON.stringify({
        name: request.name,
        category: request.category,
        downloadUrl: downloadUrl,
        expiresAt: expiresAt
    });
}

/**
 * RPC: List assets in category - returns array of pre-signed URLs
 * 
 * This uses Nakama storage to cache the asset manifest, avoiding S3 ListObjects calls.
 * Upload script should update the manifest when assets change.
 * 
 * Request: { category: string }
 * Response: { assets: [{ name, downloadUrl, expiresAt }], count: number }
 */
function rpcAssetList(ctx, logger, nk, payload) {
    const config = getAwsConfig(ctx);
    if (!config) {
        throw new Error('AWS S3 not configured');
    }

    let request;
    try {
        request = JSON.parse(payload);
    } catch (e) {
        throw new Error('Invalid JSON payload');
    }

    if (!request.category) {
        throw new Error('category is required');
    }

    // Read manifest from Nakama storage
    const collection = 's3_asset_manifests';
    const key = request.category.replace(/\//g, '_');
    
    const objects = nk.storageRead([{
        collection: collection,
        key: key,
        userId: null // System owned
    }]);

    if (!objects || objects.length === 0) {
        return JSON.stringify({ assets: [], count: 0 });
    }

    const manifest = JSON.parse(objects[0].value);
    const assets = [];
    const expiresAt = Math.floor(Date.now() / 1000) + config.expirySeconds;

    for (const assetName of manifest.assets || []) {
        const objectKey = request.category + '/' + assetName;
        assets.push({
            name: assetName,
            downloadUrl: generatePresignedUrl(config, objectKey, config.expirySeconds),
            expiresAt: expiresAt
        });
    }

    logger.info('Listed %d assets in category: %s', assets.length, request.category);

    return JSON.stringify({
        category: request.category,
        assets: assets,
        count: assets.length
    });
}

/**
 * RPC: Update asset manifest (admin only)
 * 
 * Called by upload script to update the list of assets in a category.
 * 
 * Request: { category: string, assets: string[] }
 * Response: { success: true, count: number }
 */
function rpcAssetManifestUpdate(ctx, logger, nk, payload) {
    // Admin-only check: require server-to-server call or specific user
    if (ctx.userId && !isAdmin(ctx, nk)) {
        throw new Error('Unauthorized: admin access required');
    }

    let request;
    try {
        request = JSON.parse(payload);
    } catch (e) {
        throw new Error('Invalid JSON payload');
    }

    if (!request.category || !Array.isArray(request.assets)) {
        throw new Error('category and assets array required');
    }

    const collection = 's3_asset_manifests';
    const key = request.category.replace(/\//g, '_');

    const manifest = {
        category: request.category,
        assets: request.assets,
        updatedAt: Date.now()
    };

    nk.storageWrite([{
        collection: collection,
        key: key,
        userId: null, // System owned
        value: manifest,
        permissionRead: 2, // Public read
        permissionWrite: 0 // Server only
    }]);

    logger.info('Updated manifest for category %s with %d assets', request.category, request.assets.length);

    return JSON.stringify({
        success: true,
        category: request.category,
        count: request.assets.length
    });
}

/**
 * RPC: Get Star Wars character images specifically
 * 
 * Convenience RPC for the Star Wars quiz module.
 * 
 * Request: { characters?: string[] } - optional filter
 * Response: { characters: { [name]: downloadUrl } }
 */
function rpcStarWarsCharacterImages(ctx, logger, nk, payload) {
    const config = getAwsConfig(ctx);
    if (!config) {
        throw new Error('AWS S3 not configured');
    }

    let request = {};
    if (payload) {
        try {
            request = JSON.parse(payload);
        } catch (e) {
            // Empty payload is fine
        }
    }

    const category = 'starwars/characters';
    const collection = 's3_asset_manifests';
    const key = category.replace(/\\//g, '_');

    const objects = nk.storageRead([{
        collection: collection,
        key: key,
        userId: null
    }]);

    const characters = {};
    const expiresAt = Math.floor(Date.now() / 1000) + config.expirySeconds;

    if (objects && objects.length > 0) {
        const manifest = JSON.parse(objects[0].value);
        
        for (const assetName of manifest.assets || []) {
            // Extract character name from filename (e.g., 'luke_skywalker.png' -> 'Luke Skywalker')
            const charName = assetName
                .replace(/\.[^.]+$/, '')
                .replace(/_/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());
            
            // Filter if specific characters requested
            if (request.characters && !request.characters.includes(charName)) {
                continue;
            }

            const objectKey = category + '/' + assetName;
            characters[charName] = {
                downloadUrl: generatePresignedUrl(config, objectKey, config.expirySeconds),
                expiresAt: expiresAt
            };
        }
    }

    return JSON.stringify({
        characters: characters,
        count: Object.keys(characters).length
    });
}

/**
 * Check if user is admin
 */
function isAdmin(ctx, nk) {
    if (!ctx.userId) return true; // Server-to-server
    
    // Check for admin group membership or specific user ID
    // You can customize this logic
    try {
        const account = nk.accountGetId(ctx.userId);
        const metadata = JSON.parse(account.user.metadata || '{}');
        return metadata.isAdmin === true;
    } catch (e) {
        return false;
    }
}

// Register RPCs
function InitModule(ctx, logger, nk, initializer) {
    logger.info('Initializing S3 Assets module...');

    const config = getAwsConfig(ctx);
    if (!config) {
        logger.warn('AWS S3 not configured - s3_assets RPCs will return errors. Set AWS_* env vars.');
    } else {
        logger.info('AWS S3 configured: bucket=%s, region=%s, urlExpiry=%ds', 
            config.bucket, config.region, config.expirySeconds);
    }

    initializer.registerRpc('s3_asset_download', rpcAssetDownload);
    initializer.registerRpc('s3_asset_list', rpcAssetList);
    initializer.registerRpc('s3_asset_manifest_update', rpcAssetManifestUpdate);
    initializer.registerRpc('s3_starwars_character_images', rpcStarWarsCharacterImages);

    logger.info('S3 Assets module initialized with 4 RPCs');
}

!InitModule && InitModule;
