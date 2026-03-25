#!/usr/bin/env node
/**
 * League Season Cron Script
 * 
 * Run via system cron every Monday at 00:01 UTC:
 *   0 1 * * 1 node /path/to/league_season_cron.js
 * 
 * Calls the league_process_season RPC via Nakama HTTP API.
 * Requires NAKAMA_URL and NAKAMA_SERVER_KEY environment variables.
 */

const http = require('http');
const https = require('https');

const NAKAMA_URL = process.env.NAKAMA_URL || 'http://localhost:7350';
const SERVER_KEY = process.env.NAKAMA_SERVER_KEY || 'defaultkey';
const ADMIN_KEY = 'quizverse_season_cron_2026';

async function callRpc() {
    const url = new URL('/v2/rpc/league_process_season', NAKAMA_URL);
    const payload = JSON.stringify({
        gameId: 'quizverse',
        adminKey: ADMIN_KEY
    });

    const options = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + '?http_key=' + SERVER_KEY,
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    return new Promise((resolve, reject) => {
        const protocol = url.protocol === 'https:' ? https : http;
        const req = protocol.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.payload) {
                        const inner = JSON.parse(result.payload);
                        console.log('[LeagueCron] Season processed:', JSON.stringify(inner, null, 2));
                        if (inner.success) {
                            console.log('[LeagueCron] Stats:', JSON.stringify(inner.stats));
                            resolve(inner);
                        } else {
                            console.error('[LeagueCron] RPC returned error:', inner.error);
                            reject(new Error(inner.error));
                        }
                    } else {
                        console.error('[LeagueCron] Unexpected response:', data);
                        reject(new Error('Unexpected response'));
                    }
                } catch (e) {
                    console.error('[LeagueCron] Parse error:', e.message, 'Raw:', data);
                    reject(e);
                }
            });
        });

        req.on('error', (err) => {
            console.error('[LeagueCron] Request failed:', err.message);
            reject(err);
        });

        req.write(payload);
        req.end();
    });
}

// Main
console.log('[LeagueCron] Starting season processing at', new Date().toISOString());
console.log('[LeagueCron] Nakama URL:', NAKAMA_URL);

callRpc()
    .then(() => {
        console.log('[LeagueCron] Complete.');
        process.exit(0);
    })
    .catch((err) => {
        console.error('[LeagueCron] Failed:', err.message);
        process.exit(1);
    });
