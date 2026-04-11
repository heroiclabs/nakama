#!/usr/bin/env node
/**
 * Apple App Store Connect Data Fetcher
 *
 * This script generates an ES256 JWT, calls the App Store Connect API
 * for analytics/sales data, and writes the results to Nakama storage
 * via the Nakama HTTP API so the analytics_apple_appstore RPC can serve it.
 *
 * Usage:
 *   node scripts/apple_data_fetcher.js
 *
 * Environment variables (or pass via CLI):
 *   APPLE_KEY_ID       - App Store Connect API Key ID
 *   APPLE_ISSUER_ID    - App Store Connect Issuer ID
 *   APPLE_PRIVATE_KEY  - Base64-encoded ECDSA P-256 private key (PEM)
 *   NAKAMA_URL         - Nakama server URL (default: http://localhost:7350)
 *   NAKAMA_SERVER_KEY  - Nakama server key (default: defaultkey)
 *   VENDOR_NUMBER      - Your Apple vendor number (for sales reports)
 *
 * Install dependencies:
 *   npm install jsonwebtoken node-fetch@2
 */

var jwt = require('jsonwebtoken');
var https = require('https');
var http = require('http');

// ─── Configuration ────────────────────────────────────────

var APPLE_KEY_ID = process.env.APPLE_KEY_ID || '';
var APPLE_ISSUER_ID = process.env.APPLE_ISSUER_ID || '';
var APPLE_PRIVATE_KEY_B64 = process.env.APPLE_PRIVATE_KEY || '';
var NAKAMA_URL = process.env.NAKAMA_URL || 'http://localhost:7350';
var NAKAMA_SERVER_KEY = process.env.NAKAMA_SERVER_KEY || 'defaultkey';
var VENDOR_NUMBER = process.env.VENDOR_NUMBER || '';

// ─── JWT Generation ───────────────────────────────────────

function generateAppleJWT() {
    var privateKey = APPLE_PRIVATE_KEY_B64;
    // If not already in PEM format, wrap the base64 DER key
    if (privateKey.indexOf('-----BEGIN') === -1) {
        // Try decoding as base64 first to check if it's raw DER
        var keyB64 = privateKey.replace(/\s+/g, '');
        privateKey = '-----BEGIN PRIVATE KEY-----\n' +
            keyB64.match(/.{1,64}/g).join('\n') +
            '\n-----END PRIVATE KEY-----';
    }

    var now = Math.floor(Date.now() / 1000);
    var token = jwt.sign({}, privateKey, {
        algorithm: 'ES256',
        keyid: APPLE_KEY_ID,
        issuer: APPLE_ISSUER_ID,
        audience: 'appstoreconnect-v1',
        expiresIn: '20m',
        header: {
            alg: 'ES256',
            kid: APPLE_KEY_ID,
            typ: 'JWT'
        }
    });
    return token;
}

// ─── HTTP Helper ──────────────────────────────────────────

function httpRequest(url, method, headers, body) {
    return new Promise(function(resolve, reject) {
        var parsed = new URL(url);
        var lib = parsed.protocol === 'https:' ? https : http;
        var options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: method,
            headers: headers
        };

        var req = lib.request(options, function(res) {
            var chunks = [];
            res.on('data', function(chunk) { chunks.push(chunk); });
            res.on('end', function() {
                var data = Buffer.concat(chunks).toString();
                resolve({ statusCode: res.statusCode, body: data, headers: res.headers });
            });
        });
        req.on('error', reject);
        if (body) { req.write(body); }
        req.end();
    });
}

// ─── Fetch App Store Analytics ────────────────────────────

async function fetchAppStoreData() {
    console.log('[AppleFetcher] Generating JWT...');
    var token = generateAppleJWT();

    var baseUrl = 'https://api.appstoreconnect.apple.com';
    var headers = {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
    };

    var results = {
        fetched_at: new Date().toISOString(),
        metrics: {}
    };

    // Fetch app info first
    console.log('[AppleFetcher] Fetching apps...');
    try {
        var appsResp = await httpRequest(baseUrl + '/v1/apps?limit=10', 'GET', headers);
        if (appsResp.statusCode === 200) {
            var appsData = JSON.parse(appsResp.body);
            results.apps = (appsData.data || []).map(function(app) {
                return {
                    id: app.id,
                    name: app.attributes ? app.attributes.name : 'unknown',
                    bundleId: app.attributes ? app.attributes.bundleId : 'unknown'
                };
            });
            console.log('[AppleFetcher] Found ' + results.apps.length + ' apps');
        } else {
            console.error('[AppleFetcher] Apps API error: ' + appsResp.statusCode + ' ' + appsResp.body);
        }
    } catch (err) {
        console.error('[AppleFetcher] Apps fetch error: ' + err.message);
    }

    // Fetch sales/analytics reports
    var now = new Date();
    var reportDate = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);

    // Sales reports
    console.log('[AppleFetcher] Fetching sales report for ' + reportDate + '...');
    try {
        var salesUrl = baseUrl + '/v1/salesReports?' +
            'filter[reportType]=SALES' +
            '&filter[reportSubType]=SUMMARY' +
            '&filter[frequency]=DAILY' +
            '&filter[reportDate]=' + reportDate;
        if (VENDOR_NUMBER) {
            salesUrl += '&filter[vendorNumber]=' + VENDOR_NUMBER;
        }
        var salesResp = await httpRequest(salesUrl, 'GET', headers);
        if (salesResp.statusCode === 200) {
            // Sales reports come as gzipped TSV - store raw
            results.metrics.sales = {
                date: reportDate,
                raw: salesResp.body.substring(0, 5000) // Truncate for storage
            };
            console.log('[AppleFetcher] Sales report fetched');
        } else {
            console.log('[AppleFetcher] Sales report: ' + salesResp.statusCode);
            results.metrics.sales = { error: 'HTTP ' + salesResp.statusCode, date: reportDate };
        }
    } catch (err) {
        console.error('[AppleFetcher] Sales error: ' + err.message);
        results.metrics.sales = { error: err.message };
    }

    return results;
}

// ─── Write to Nakama Storage ──────────────────────────────

async function writeToNakama(data) {
    var url = NAKAMA_URL + '/v2/rpc/analytics_apple_appstore_ingest?unwrap';
    // Alternatively, write directly to storage via console API
    // We'll use a simpler approach: write via the Nakama Console API

    var storageUrl = NAKAMA_URL + '/v2/console/storage';
    var authHeader = 'Basic ' + Buffer.from(NAKAMA_SERVER_KEY + ':').toString('base64');

    // Use the Nakama Console API to write storage objects
    var writeUrl = NAKAMA_URL + '/v2/console/api/storage';
    var body = JSON.stringify({
        collection: 'external_analytics',
        key: 'apple_latest',
        user_id: '00000000-0000-0000-0000-000000000000',
        value: JSON.stringify(data),
        permission_read: 1,
        permission_write: 0
    });

    console.log('[AppleFetcher] Writing to Nakama storage...');
    try {
        // Try Console API first
        var resp = await httpRequest(
            NAKAMA_URL + '/v2/console/api/accounts/00000000-0000-0000-0000-000000000000/storage',
            'PUT',
            {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            JSON.stringify({
                objects: [{
                    collection: 'external_analytics',
                    key: 'apple_latest',
                    value: JSON.stringify(data)
                }]
            })
        );

        if (resp.statusCode >= 200 && resp.statusCode < 300) {
            console.log('[AppleFetcher] Successfully written to Nakama storage');
        } else {
            console.log('[AppleFetcher] Nakama write response: ' + resp.statusCode + ' ' + resp.body);
            // Fallback: save to local file
            var fs = require('fs');
            var outPath = __dirname + '/apple_data_cache.json';
            fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
            console.log('[AppleFetcher] Saved to local file: ' + outPath);
        }
    } catch (err) {
        console.error('[AppleFetcher] Nakama write error: ' + err.message);
        var fs = require('fs');
        var outPath = __dirname + '/apple_data_cache.json';
        fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
        console.log('[AppleFetcher] Saved to local file: ' + outPath);
    }
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
    if (!APPLE_KEY_ID || !APPLE_ISSUER_ID || !APPLE_PRIVATE_KEY_B64) {
        console.error('Missing required environment variables:');
        console.error('  APPLE_KEY_ID, APPLE_ISSUER_ID, APPLE_PRIVATE_KEY');
        process.exit(1);
    }

    try {
        var data = await fetchAppStoreData();
        await writeToNakama(data);
        console.log('[AppleFetcher] Done!');
    } catch (err) {
        console.error('[AppleFetcher] Fatal error: ' + err.message);
        process.exit(1);
    }
}

main();
