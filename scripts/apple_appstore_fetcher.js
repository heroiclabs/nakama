#!/usr/bin/env node
/**
 * apple_appstore_fetcher.js — Fetch App Store Connect stats and push to Nakama
 *
 * Uses App Store Connect API v1 with ES256 JWT (via jose/jsonwebtoken).
 * Fetches: downloads (units), sales, active devices, crashes.
 *
 * SETUP:
 *   1. App Store Connect → Users → Integrations → Keys → Create API Key
 *      Role: Finance or Admin  (needs App Analytics)
 *   2. Download the .p8 private key file
 *   3. Note your Key ID and Issuer ID
 *   4. npm install node-fetch jsonwebtoken fs dotenv
 *
 * USAGE:
 *   APPLE_KEY_ID=ABCD123456 \
 *   APPLE_ISSUER_ID=your-issuer-uuid \
 *   APPLE_PRIVATE_KEY="$(cat AuthKey_ABCD123456.p8)" \
 *   APPLE_BUNDLE_ID=com.intelliversex.quizverse \
 *   NAKAMA_URL=http://localhost:7350 \
 *   NAKAMA_HTTP_KEY=defaultkey \
 *   node scripts/apple_appstore_fetcher.js
 */

'use strict';
require('dotenv').config();

const fetch = require('node-fetch');
const jwt   = require('jsonwebtoken');

const KEY_ID      = process.env.APPLE_KEY_ID;
const ISSUER_ID   = process.env.APPLE_ISSUER_ID;
const PRIVATE_KEY = (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const BUNDLE_ID   = process.env.APPLE_BUNDLE_ID || 'com.intelliversex.quizverse';
const NAKAMA_URL  = process.env.NAKAMA_URL    || 'http://localhost:7350';
const HTTP_KEY    = process.env.NAKAMA_HTTP_KEY || process.env.HTTP_KEY || 'defaultkey';
const DASH_SECRET = process.env.DASHBOARD_SECRET || '';
const VENDOR_NUMBER = process.env.APPLE_VENDOR_NUMBER || '';

if (!KEY_ID || !ISSUER_ID || !PRIVATE_KEY) {
    console.error('[apple_fetcher] Missing APPLE_KEY_ID, APPLE_ISSUER_ID, or APPLE_PRIVATE_KEY');
    process.exit(1);
}

function makeJwt() {
    return jwt.sign({}, PRIVATE_KEY, {
        algorithm:  'ES256',
        expiresIn:  '5m',
        issuer:     ISSUER_ID,
        header:     { kid: KEY_ID, alg: 'ES256' },
        audience:   'appstoreconnect-v1'
    });
}

async function apiFetch(path) {
    const token = makeJwt();
    const url = `https://api.appstoreconnect.apple.com/v1${path}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`ASC API ${resp.status} at ${path}: ${text.slice(0, 200)}`);
    }
    return resp.json();
}

/**
 * Fetch Sales & Trends report (type=SALES, subType=SUMMARY, frequency=DAILY).
 * Returns a CSV string. Requires VENDOR_NUMBER.
 */
async function fetchSalesReport(dateStr) {
    if (!VENDOR_NUMBER) return null;
    const token = makeJwt();
    const url = `https://api.appstoreconnect.apple.com/v1/salesReports?filter[frequency]=DAILY&filter[reportDate]=${dateStr}&filter[reportSubType]=SUMMARY&filter[reportType]=SALES&filter[vendorNumber]=${VENDOR_NUMBER}`;
    const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/a-gzip' }
    });
    if (!resp.ok) return null;
    // Decompress gzip
    const zlib = require('zlib');
    const buf = Buffer.from(await resp.arrayBuffer());
    return new Promise((res, rej) => zlib.gunzip(buf, (e, d) => e ? rej(e) : res(d.toString('utf8'))));
}

function parseSalesCsv(csv) {
    if (!csv) return { units: 0, proceeds: 0 };
    const lines = csv.split('\n').filter(Boolean);
    const header = lines[0].split('\t').map(h => h.trim());
    const unitsIdx = header.findIndex(h => /^units$/i.test(h));
    const proceedsIdx = header.findIndex(h => /proceeds/i.test(h));
    let units = 0, proceeds = 0;
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split('\t');
        if (unitsIdx >= 0)    units    += parseInt(cols[unitsIdx]   || '0', 10);
        if (proceedsIdx >= 0) proceeds += parseFloat(cols[proceedsIdx] || '0');
    }
    return { units, proceeds };
}

async function pushToNakama(data) {
    const url = `${NAKAMA_URL}/v2/rpc/apple_appstore_import?http_key=${HTTP_KEY}&unwrap=true`;
    const payload = { data, source: 'apple_appstore_fetcher', dashboard_secret: DASH_SECRET };
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`Nakama push ${resp.status}: ${text}`);
    console.log('[apple_fetcher] Nakama response:', text);
}

async function main() {
    console.log('[apple_fetcher] Fetching App Store Connect data for', BUNDLE_ID);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10).replace(/-/g, '-');

    let units = 0, proceeds = 0;
    try {
        const csv = await fetchSalesReport(yesterday);
        const parsed = parseSalesCsv(csv);
        units    = parsed.units;
        proceeds = parsed.proceeds;
        console.log(`[apple_fetcher] Sales report: units=${units} proceeds=${proceeds}`);
    } catch (e) {
        console.warn('[apple_fetcher] Sales report failed:', e.message, '(continuing)');
    }

    // App metrics (crashes, active devices)
    let crashes7d = 0;
    try {
        const apps = await apiFetch('/apps?filter[bundleId]=' + BUNDLE_ID);
        const appId = apps.data && apps.data[0] && apps.data[0].id;
        if (appId) {
            const endDate = yesterday;
            const startDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
            const crashes = await apiFetch(
                `/apps/${appId}/diagnosticSignatures?filter[diagnosticType]=CRASH&filter[signatureType]=CRASH_RATE&limit=25`
            ).catch(() => null);
            if (crashes && crashes.data) {
                crashes7d = crashes.data.reduce((s, sig) => {
                    const attr = sig.attributes || {};
                    return s + (parseInt(attr.weight, 10) || 0);
                }, 0);
            }
        }
    } catch (e) {
        console.warn('[apple_fetcher] Crashes fetch failed:', e.message);
    }

    const payload = {
        units,                    // downloads (yesterday)
        proceeds_usd: proceeds,   // net revenue (yesterday)
        crashes_7d: crashes7d,
        date_range: { from: yesterday, to: yesterday },
        fetched_at: new Date().toISOString()
    };

    console.log('[apple_fetcher] Payload:', JSON.stringify(payload, null, 2));
    await pushToNakama(payload);
    console.log('[apple_fetcher] Done.');
}

main().catch(err => { console.error('[apple_fetcher] Fatal:', err.message); process.exit(1); });
