// ═══════════════════════════════════════════════════════════════════════════
//  FCM HTTP v1 — direct sender
//  -------------------------------------------------------------------------
//  Bypasses AWS SNS GCM Platform Apps and posts directly to FCM v1 using a
//  Firebase service-account JSON loaded from AWS Secrets Manager. This lets
//  one Lambda authenticate as ANY number of Firebase projects (one secret
//  per project), which is the only architecture that works when iOS, Android
//  and Web devices each live in different Firebase projects.
//
//  Why not SNS GCM Platform App?
//  An SNS GCM Platform App authenticates with FCM as exactly ONE Firebase
//  project. If a token belongs to a different project, FCM rejects every
//  delivery (`SenderId mismatch`) and SNS auto-disables the endpoint after
//  a few rejects → that's the "Endpoint is disabled" error iOS keeps hitting.
//  Per-project routing inside one SNS app is not possible.
//
//  Secrets Manager naming contract:
//    firebase/service-account/<projectId>
//  e.g.  firebase/service-account/quiz-verse-4a475
//  Secret value MUST be the raw JSON downloaded from Firebase Console
//  → Project Settings → Service accounts → Generate new private key.
// ═══════════════════════════════════════════════════════════════════════════

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import crypto from "node:crypto";

const secrets = new SecretsManagerClient({});

// Per-Lambda-invocation cache of service-account JSONs and access tokens.
// Cuts cold-path cost on warm Lambdas and avoids hammering Secrets Manager
// when a burst of pushes lands on the same instance.
const SA_JSON_CACHE = new Map();          // projectId → parsed service-account JSON
const ACCESS_TOKEN_CACHE = new Map();     // projectId → { token, expiresAt }

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const ACCESS_TOKEN_TTL_BUFFER_S = 60;     // refresh ≥ 60s before Google says it expires

async function loadServiceAccount(projectId) {
    if (!projectId) throw new Error("fcm-direct: projectId required");
    const cached = SA_JSON_CACHE.get(projectId);
    if (cached) return cached;
    const secretId = `firebase/service-account/${projectId}`;
    const resp = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!resp.SecretString) {
        throw new Error(`Secret ${secretId} has no SecretString — store the service-account JSON as plaintext`);
    }
    let sa;
    try {
        sa = JSON.parse(resp.SecretString);
    } catch (e) {
        throw new Error(`Secret ${secretId} is not valid JSON`);
    }
    if (sa.project_id !== projectId) {
        // Mismatch between requested projectId and the JSON's own project_id is
        // almost always an ops misconfig that would silently break delivery
        // forever. Fail loud so it surfaces in Lambda logs immediately.
        throw new Error(
            `Secret ${secretId} contains a service account for project_id=${sa.project_id} ` +
            `(expected ${projectId}). Re-download the key from the right Firebase project.`
        );
    }
    if (!sa.private_key || !sa.client_email) {
        throw new Error(`Secret ${secretId} is missing private_key or client_email`);
    }
    SA_JSON_CACHE.set(projectId, sa);
    return sa;
}

// Sign an OAuth2 JWT and exchange it for a Google access token. We do this
// inline (no googleapis SDK dependency) to keep the Lambda zip tiny.
async function getAccessToken(projectId) {
    const cached = ACCESS_TOKEN_CACHE.get(projectId);
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.expiresAt - ACCESS_TOKEN_TTL_BUFFER_S > now) {
        return cached.token;
    }

    const sa = await loadServiceAccount(projectId);
    const iat = now;
    const exp = iat + 3600;
    const header = { alg: "RS256", typ: "JWT", kid: sa.private_key_id };
    const claims = {
        iss: sa.client_email,
        scope: FCM_SCOPE,
        aud: "https://oauth2.googleapis.com/token",
        iat,
        exp,
    };
    const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const signingInput = `${enc(header)}.${enc(claims)}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const sig = signer.sign(sa.private_key).toString("base64url");
    const jwt = `${signingInput}.${sig}`;

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: jwt,
        }),
    });
    const tokenJson = await tokenResp.json();
    if (!tokenResp.ok || !tokenJson.access_token) {
        throw new Error(
            `Google OAuth exchange failed for ${projectId}: ` +
            `${tokenResp.status} ${JSON.stringify(tokenJson).slice(0, 300)}`
        );
    }
    const expiresAt = now + (tokenJson.expires_in || 3600);
    ACCESS_TOKEN_CACHE.set(projectId, { token: tokenJson.access_token, expiresAt });
    return tokenJson.access_token;
}

// Build the FCM v1 message envelope. The spec requires either `token` (single
// device), `topic`, or `condition`. We always use `token`. A top-level
// `notification` block makes the message render in the system tray when the
// app is backgrounded; without it, FCM treats the push as data-only and
// Android/iOS deliver it silently to the in-app handler.
function buildMessage(deviceToken, title, body, data, eventType) {
    const dataDict = Object.assign({}, data || {});
    if (eventType) dataDict.eventType = eventType;
    // FCM v1 requires data values to all be strings.
    const stringifiedData = {};
    for (const [k, v] of Object.entries(dataDict)) {
        stringifiedData[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return {
        message: {
            token: deviceToken,
            notification: { title: title || "", body: body || "" },
            data: stringifiedData,
            android: {
                priority: "high",
                ttl: "3600s",
                notification: { sound: "default", default_sound: true },
            },
            apns: {
                headers: { "apns-priority": "10" },
                payload: {
                    aps: {
                        alert: { title: title || "", body: body || "" },
                        sound: "default",
                        "mutable-content": 1,
                    },
                },
            },
            webpush: {
                notification: { title: title || "", body: body || "", requireInteraction: false },
                fcm_options: stringifiedData.actionUrl ? { link: stringifiedData.actionUrl } : undefined,
            },
        },
    };
}

export async function sendFcmDirect({ projectId, deviceToken, title, body, data, eventType }) {
    if (!projectId) throw new Error("sendFcmDirect: projectId required");
    if (!deviceToken) throw new Error("sendFcmDirect: deviceToken required");

    const accessToken = await getAccessToken(projectId);
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
    const payload = buildMessage(deviceToken, title, body, data, eventType);

    const fcmResp = await fetch(url, {
        method: "POST",
        headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(payload),
    });
    const respJson = await fcmResp.json().catch(() => ({}));

    if (!fcmResp.ok) {
        const errStatus = respJson?.error?.status || `HTTP_${fcmResp.status}`;
        const errMessage = respJson?.error?.message || JSON.stringify(respJson).slice(0, 300);
        // Surface FCM's canonical error codes so callers can decide whether
        // to disable the token (UNREGISTERED / INVALID_ARGUMENT) vs retry
        // (UNAVAILABLE / INTERNAL). See: https://firebase.google.com/docs/cloud-messaging/manage-tokens
        return {
            success: false,
            provider: "fcm-v1",
            projectId,
            errorCode: errStatus,
            error: errMessage,
            httpStatus: fcmResp.status,
            shouldRemoveToken: ["UNREGISTERED", "INVALID_ARGUMENT", "NOT_FOUND"].includes(errStatus),
        };
    }
    return {
        success: true,
        provider: "fcm-v1",
        projectId,
        messageName: respJson.name, // e.g. "projects/quiz-verse-4a475/messages/<id>"
    };
}

// Test helper — only used by smoke scripts, not in the request path.
export async function _resetCachesForTesting() {
    SA_JSON_CACHE.clear();
    ACCESS_TOKEN_CACHE.clear();
}
