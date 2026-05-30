#!/usr/bin/env node
/**
 * play_data_fetcher.js — Fetch Google Play Console stats and push to Nakama
 *
 * Fetches from Google Play Developer Reporting API v1beta1 using a
 * service account JSON key (RS256 JWT OAuth2).
 *
 * SETUP:
 *   1. Go to Google Play Console → Setup → API access
 *   2. Link to a Google Cloud project
 *   3. Create a Service Account → grant "View app information" role
 *   4. Download the JSON key file → save as .env / env var
 *   5. npm install googleapis node-fetch dotenv
 *
 * USAGE:
 *   GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' \
 *   NAKAMA_URL=http://localhost:7350 \
 *   NAKAMA_HTTP_KEY=defaultkey \
 *   PACKAGE_NAME=com.intelliversex.quizverse \
 *   node scripts/play_data_fetcher.js
 *
 * Or add to .env file and run: node -r dotenv/config scripts/play_data_fetcher.js
 */

'use strict';
require('dotenv').config();

const { google }   = require('googleapis');
const fetch        = require('node-fetch');

const PACKAGE_NAME  = process.env.PACKAGE_NAME  || 'com.intelliversex.quizverse';
const NAKAMA_URL    = process.env.NAKAMA_URL     || 'http://localhost:7350';
const HTTP_KEY      = process.env.NAKAMA_HTTP_KEY || process.env.HTTP_KEY || 'defaultkey';
const DASH_SECRET   = process.env.DASHBOARD_SECRET || '';

async function getGoogleAuth() {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
    const key = JSON.parse(keyJson);
    const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ['https://www.googleapis.com/auth/playdeveloperreporting']
    });
    return auth;
}

async function fetchInstalls(auth) {
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    const url = `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${encodeURIComponent(PACKAGE_NAME)}/installs:query`;
    const body = {
        dimensions: ['date'],
        metrics: ['activeDeviceInstalls', 'deviceInstalls', 'deviceUninstalls'],
        timelineSpec: {
            aggregationPeriod: 'DAILY',
            startTime: { seconds: Math.floor((Date.now() - 30 * 86400 * 1000) / 1000) },
            endTime:   { seconds: Math.floor(Date.now() / 1000) }
        }
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Play API error ${resp.status}: ${text}`);
    }
    return resp.json();
}

async function fetchRatings(auth) {
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();

    const url = `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${encodeURIComponent(PACKAGE_NAME)}/ratings:query`;
    const body = {
        dimensions: ['date'],
        metrics: ['averageRating', 'totalReviews'],
        timelineSpec: {
            aggregationPeriod: 'DAILY',
            startTime: { seconds: Math.floor((Date.now() - 7 * 86400 * 1000) / 1000) },
            endTime:   { seconds: Math.floor(Date.now() / 1000) }
        }
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    if (!resp.ok) return null; // ratings may not be available
    return resp.json();
}

function sumMetric(rows, metricName) {
    if (!rows || !rows.length) return 0;
    return rows.reduce((acc, row) => {
        const m = (row.metrics || []).find(x => x.metric === metricName);
        return acc + (m ? (m.integerValue || m.doubleValue || 0) : 0);
    }, 0);
}

async function pushToNakama(data) {
    const url = `${NAKAMA_URL}/v2/rpc/play_console_import?http_key=${HTTP_KEY}&unwrap=true`;
    const payload = {
        data,
        source: 'play_data_fetcher',
        dashboard_secret: DASH_SECRET
    };

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`Nakama push error ${resp.status}: ${text}`);
    console.log('[play_data_fetcher] Nakama import response:', text);
}

async function main() {
    console.log('[play_data_fetcher] Fetching Google Play Console data for', PACKAGE_NAME);
    const auth = await getGoogleAuth();

    const [installData, ratingData] = await Promise.allSettled([
        fetchInstalls(auth),
        fetchRatings(auth)
    ]);

    const installRows = installData.status === 'fulfilled' ? (installData.value.rows || []) : [];
    const ratingRows  = ratingData.status  === 'fulfilled' ? (ratingData.value.rows  || []) : [];

    const installs_7d      = sumMetric(installRows.slice(-7), 'deviceInstalls');
    const active_users     = sumMetric(installRows.slice(-1), 'activeDeviceInstalls');
    const total_installs   = sumMetric(installRows, 'deviceInstalls');  // 30d sum as proxy
    const rating           = ratingRows.length ? (sumMetric(ratingRows, 'averageRating') / ratingRows.length) : 0;
    const ratings_count    = sumMetric(ratingRows, 'totalReviews');

    const payload = {
        total_installs,
        installs_7d,
        active_users,
        rating: Math.round(rating * 100) / 100,
        ratings_count,
        date_range: {
            from: new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10),
            to:   new Date().toISOString().slice(0, 10)
        }
    };

    console.log('[play_data_fetcher] Payload:', JSON.stringify(payload, null, 2));
    await pushToNakama(payload);
    console.log('[play_data_fetcher] Done.');
}

main().catch(err => { console.error('[play_data_fetcher] Fatal:', err.message); process.exit(1); });
