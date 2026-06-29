// ═══════════════════════════════════════════════════════════════════════════
//  send-push Lambda
//  -------------------------------------------------------------------------
//  Sends a push notification to a registered device. Two delivery paths:
//
//   1. APNs endpoints  → SNS Publish to the SNS APNs Platform App
//                        (works fine — one Apple Team owns one APNs key,
//                        no project mismatch possible)
//
//   2. FCM endpoints   → Direct FCM HTTP v1 call (NOT SNS Publish)
//                        Uses a Firebase service-account JSON pulled from
//                        Secrets Manager keyed by the endpoint's
//                        fcmProjectId. Lets us authenticate as ANY
//                        Firebase project per-request, which is the only
//                        architecture that survives mixed iOS/Android/Web
//                        builds living in different Firebase projects.
//
//  Endpoint → Project mapping is stored in the SNS endpoint's
//  CustomUserData JSON at registration time:
//      { userId, gameId, platform, fcmProjectId? }
//
//  If a legacy endpoint has no fcmProjectId, we fall back to the
//  DEFAULT_FCM_PROJECT_ID env var so existing tokens keep working through
//  the migration.
// ═══════════════════════════════════════════════════════════════════════════

import { SNSClient, PublishCommand, GetEndpointAttributesCommand, DeleteEndpointCommand } from "@aws-sdk/client-sns";
import { sendFcmDirect } from "./fcm-direct.mjs";

const sns = new SNSClient({});

// Permanently remove a dead SNS endpoint. Called whenever the downstream
// provider (FCM/APNs) reports the token is gone (UNREGISTERED / NOT_FOUND /
// endpoint disabled). This is the single most important cleanup in the push
// pipeline: without it, every caller that iterates SNS endpoints keeps
// re-publishing to dead ARNs forever (observed: ~177k FCM 404s / 72h, ~96%
// of all sends, growing daily). DeleteEndpoint is idempotent — deleting an
// already-deleted ARN is a no-op success — so this is safe to call blindly.
async function deleteDeadEndpoint(endpointArn, reason) {
    if (!endpointArn) return;
    try {
        await sns.send(new DeleteEndpointCommand({ EndpointArn: endpointArn }));
        console.log(`[send-push] 🧹 Deleted dead SNS endpoint (${reason}) | arn=${endpointArn}`);
    } catch (e) {
        console.warn(`[send-push] ⚠ Failed to delete dead SNS endpoint | arn=${endpointArn} | ${e?.name}: ${e?.message}`);
    }
}

const DEFAULT_FCM_PROJECT_ID = process.env.DEFAULT_FCM_PROJECT_ID || "";

// ─── Discord delivery-failure alerting ──────────────────────────────────────
// This Lambda is invoked once per endpoint, so a single invocation can't see a
// "failure rate". Instead we keep a rolling tally in the warm-container module
// scope and post ONE Discord alert when, over a window, the failure rate or
// dead-endpoint deletions spike. Rate-limited per container; best-effort and
// fully wrapped so alerting can never affect a send.
const ALERT_WEBHOOK = process.env.DISCORD_PUSH_WEBHOOK_URL || process.env.DISCORD_NAKAMA_WEBHOOK_URL || "";
const ALERT_WINDOW_MS = intEnv("PUSH_ALERTS_WINDOW_MS", 15 * 60 * 1000, 60 * 1000);
const ALERT_MIN = intEnv("PUSH_ALERTS_MIN_ATTEMPTS", 50, 1);
const ALERT_DEAD_SPIKE = intEnv("PUSH_ALERTS_DEAD_SPIKE", 200, 1);
const ALERT_COOLDOWN_MS = intEnv("PUSH_ALERTS_COOLDOWN_MS", 30 * 60 * 1000, 60 * 1000);
const ALERT_FAIL_RATE = floatEnv("PUSH_ALERTS_FAIL_RATE", 0.5);
const ALERT_LABEL = process.env.AWS_LAMBDA_FUNCTION_NAME || "send-push";

let aWinStart = Date.now();
let aSent = 0;
let aFailed = 0;
let aDead = 0;
let aCodes = {};
let aLastAlertMs = 0;

function intEnv(key, fallback, min) {
    const v = process.env[key];
    if (v === undefined || v === "") return fallback;
    const n = parseInt(v, 10);
    return Number.isNaN(n) || n < min ? fallback : n;
}
function floatEnv(key, fallback) {
    const v = process.env[key];
    if (v === undefined || v === "") return fallback;
    const n = parseFloat(v);
    return Number.isNaN(n) || n <= 0 || n > 1 ? fallback : n;
}

// Inspect the handler's response, update the rolling window, and emit a Discord
// alert if the window is unhealthy. Awaited before the Lambda returns so the
// post completes before the execution environment is frozen.
async function recordAndMaybeAlert(res) {
    try {
        let parsed = {};
        try { parsed = typeof res?.body === "string" ? JSON.parse(res.body) : (res?.body || {}); } catch (_) {}
        const ok = res && res.statusCode >= 200 && res.statusCode < 300 && parsed.success !== false;
        if (ok) {
            aSent++;
        } else {
            aFailed++;
            const code = parsed.code || `HTTP_${res ? res.statusCode : "?"}`;
            aCodes[code] = (aCodes[code] || 0) + 1;
            if (parsed.endpointDeleted || parsed.shouldRemoveToken) aDead++;
        }

        const now = Date.now();
        if ((now - aWinStart) < ALERT_WINDOW_MS) return;

        const attempts = aSent + aFailed;
        const failRate = attempts > 0 ? aFailed / attempts : 0;
        const bad = attempts >= ALERT_MIN && (failRate >= ALERT_FAIL_RATE || aDead >= ALERT_DEAD_SPIKE);
        if (bad && ALERT_WEBHOOK && (now - aLastAlertMs) >= ALERT_COOLDOWN_MS) {
            const snapshot = { attempts, sent: aSent, failed: aFailed, dead: aDead, failRate, codes: aCodes };
            await postDiscordAlert(snapshot);
            aLastAlertMs = now;
        }
        // Reset the window whether or not we alerted, to keep counters bounded.
        aWinStart = now; aSent = 0; aFailed = 0; aDead = 0; aCodes = {};
    } catch (e) {
        console.warn(`[send-push] alert bookkeeping failed: ${e?.name}: ${e?.message}`);
    }
}

async function postDiscordAlert(s) {
    const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "0%");
    const codeLines = Object.keys(s.codes)
        .sort((a, b) => s.codes[b] - s.codes[a])
        .slice(0, 6)
        .map((c) => `\`${c}\` ×${s.codes[c]}`)
        .join("\n") || "—";
    const embed = {
        title: "🔴 send-push: high push delivery failure rate",
        description:
            `Device-push failure rate **${pct(s.failed, s.attempts)}** over the last window ` +
            `(threshold ${Math.round(ALERT_FAIL_RATE * 100)}%). Source: \`${ALERT_LABEL}\` Lambda (FCM/APNs sender).`,
        color: 0xe74c3c,
        timestamp: new Date().toISOString(),
        fields: [
            {
                name: "📉 Window",
                value:
                    `Attempts: **${s.attempts}**\n` +
                    `Delivered: **${s.sent}** (${pct(s.sent, s.attempts)})\n` +
                    `Failed: **${s.failed}** (${pct(s.failed, s.attempts)})\n` +
                    `Dead endpoints deleted: **${s.dead}**`,
                inline: false,
            },
            { name: "🧨 Top failure reasons", value: codeLines, inline: false },
            {
                name: "🛠️ Likely action",
                value:
                    "• UNREGISTERED/NOT_FOUND → dead tokens (auto-deleted; should fall)\n" +
                    "• Sustained high rate → verify Firebase project match " +
                    "(`DEFAULT_FCM_PROJECT_ID` vs token-minting project) + Secrets Manager service-account",
                inline: false,
            },
        ],
        footer: { text: `nakama-push-alerts • ${ALERT_LABEL}` },
    };
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const r = await fetch(ALERT_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "Nakama Push Watchdog", embeds: [embed] }),
            signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (!r.ok) {
            console.warn(`[send-push] discord alert non-2xx: ${r.status}`);
        } else {
            console.log(`[send-push] 🚨 posted push-failure Discord alert | failRate=${pct(s.failed, s.attempts)} dead=${s.dead}`);
        }
    } catch (e) {
        console.warn(`[send-push] discord alert post failed: ${e?.name}: ${e?.message}`);
    }
}

// Derive the real platform from the SNS endpoint ARN. The ARN is the only
// source of truth for which Platform Application a device actually lives in.
function platformFromArn(arn) {
    if (!arn || typeof arn !== "string") return "";
    const seg = arn.split(":endpoint/")[1];
    if (!seg) return "";
    const type = (seg.split("/")[0] || "").toUpperCase();
    if (type === "APNS" || type === "APNS_SANDBOX" || type === "APNS_VOIP" || type === "APNS_VOIP_SANDBOX") return "ios";
    if (type === "GCM" || type === "FCM" || type === "ADM" || type === "BAIDU") return "android";
    if (type === "WNS" || type === "MPNS") return "windows";
    return "";
}

// Pull the device token + CustomUserData (which carries fcmProjectId) off
// the SNS endpoint. We need this to pick the right Firebase project for
// FCM v1 sends. SNS keeps the original Token field even after disabling.
async function readEndpointAttrs(endpointArn) {
    const r = await sns.send(new GetEndpointAttributesCommand({ EndpointArn: endpointArn }));
    const attrs = r.Attributes || {};
    let userData = {};
    if (attrs.CustomUserData) {
        try { userData = JSON.parse(attrs.CustomUserData); } catch (_) { userData = {}; }
    }
    return {
        token: attrs.Token || "",
        enabled: attrs.Enabled === "true",
        userData,
    };
}

const handlerImpl = async (event) => {
    console.log("Send push request:", JSON.stringify(event, null, 2));

    let body;
    try {
        body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    } catch (e) {
        return response(400, { success: false, error: "Invalid JSON in request body" });
    }

    const { endpointArn, platform: requestedPlatform, title, body: messageBody, data, gameId, eventType } = body || {};

    if (!endpointArn || !title || !messageBody) {
        return response(400, {
            success: false,
            error: "Missing required fields: endpointArn, title, body"
        });
    }

    // Trust the ARN over caller's `platform` claim. If they disagree, log it
    // so the upstream registration bug stays visible until fixed.
    const arnPlatform = platformFromArn(endpointArn);
    const platform = arnPlatform || String(requestedPlatform || "").toLowerCase();
    const arnSegment = endpointArn ? (endpointArn.split(":endpoint/")[1] || "").split("/")[0] : "?";
    console.log(`[send-push] ════ ROUTING ════════════════════════════════════════════`);
    console.log(`[send-push] arn=${endpointArn}`);
    console.log(`[send-push] arnPlatform=${arnPlatform} | requestedPlatform=${requestedPlatform} | effectivePlatform=${platform}`);
    console.log(`[send-push] arnSegment=${arnSegment} | eventType=${eventType} | title='${title}'`);
    if (arnPlatform && requestedPlatform && arnPlatform !== String(requestedPlatform).toLowerCase()) {
        console.warn(
            `[send-push] ⚠ PLATFORM MISMATCH: caller said platform=${requestedPlatform} but ARN segment=${arnSegment} → resolved=${arnPlatform}. ` +
            `Trusting ARN. This usually means Nakama stored the wrong platform when registering.`
        );
    }
    if (!arnPlatform) {
        console.warn(`[send-push] ⚠ Could not derive platform from ARN segment '${arnSegment}' — using caller claim '${requestedPlatform}'. ` +
            `If platform is wrong the message format will be wrong.`);
    }

    try {
        // ─── Path 1: native APNs token via SNS Publish ─────────────────────
        // SNS APNs auth uses our .p8 key (one Team owns one APNs cert/key,
        // no project mismatch possible) so this path is reliable.
        if (platform === "ios") {
            console.log(`[send-push] → Path 1: SNS Publish → APNS | arn=${endpointArn}`);
            const apnsPayload = {
                aps: {
                    alert: { title, body: messageBody },
                    sound: "default",
                    badge: 1,
                    "mutable-content": 1,
                    "content-available": 1,
                    "thread-id": eventType || "general"
                },
                ...(data || {}),
                eventType: eventType || ""
            };
            const message = JSON.stringify({
                default: `${title}: ${messageBody}`,
                APNS: JSON.stringify(apnsPayload),
                APNS_SANDBOX: JSON.stringify(apnsPayload),
            });
            console.log(`[send-push] → calling SNS Publish | arn=${endpointArn} | messageLen=${message.length}`);
            const result = await sns.send(new PublishCommand({
                TargetArn: endpointArn,
                Message: message,
                MessageStructure: "json",
                MessageAttributes: {
                    gameId: { DataType: "String", StringValue: gameId || "" },
                    eventType: { DataType: "String", StringValue: eventType || "" },
                },
            }));
            console.log(`[send-push] ✓ SNS-APNS delivered | messageId=${result.MessageId}`);
            return response(200, {
                success: true,
                provider: "sns-apns",
                messageId: result.MessageId,
                endpointArn,
                platform,
            });
        }

        // ─── Path 2: FCM endpoint via direct FCM v1 HTTP ───────────────────
        // We never use SNS Publish for FCM tokens any more — the GCM Platform
        // App can only auth as ONE project, but our tokens come from many.
        if (platform === "android" || platform === "web") {
            console.log(`[send-push] → Path 2: FCM v1 direct | arn=${endpointArn}`);
            const attrs = await readEndpointAttrs(endpointArn);
            console.log(`[send-push]   SNS endpoint attrs: tokenLen=${attrs.token.length} | enabled=${attrs.enabled} | userData=${JSON.stringify(attrs.userData)}`);
            if (!attrs.token) {
                console.error(`[send-push] FAIL — SNS endpoint has no Token attribute. arn=${endpointArn}` +
                    ` | Fix: device must re-register with a valid FCM token (call push_register_token again).`);
                return response(400, {
                    success: false,
                    error: "Endpoint has no Token attribute — re-register the device",
                    code: "ENDPOINT_TOKEN_MISSING",
                });
            }
            if (!attrs.enabled) {
                console.warn(`[send-push] ⚠ SNS endpoint is DISABLED | arn=${endpointArn}` +
                    ` | Attempting send anyway — FCM may still accept it. If it fails with UNREGISTERED, the app was uninstalled.`);
            }
            const projectId = attrs.userData.fcmProjectId || DEFAULT_FCM_PROJECT_ID;
            console.log(`[send-push]   fcmProjectId=${projectId} | source=${attrs.userData.fcmProjectId ? "endpoint.userData" : "DEFAULT_FCM_PROJECT_ID env"}`);
            if (!projectId) {
                console.error(`[send-push] FAIL — no fcmProjectId available.` +
                    ` | Fix: (1) Re-register device and include fcmProjectId in the registration payload.` +
                    ` | OR: (2) Set DEFAULT_FCM_PROJECT_ID Lambda env var to the Firebase project ID.`);
                return response(400, {
                    success: false,
                    error: "No fcmProjectId on endpoint and no DEFAULT_FCM_PROJECT_ID env var. " +
                           "Re-register the device with fcmProjectId, or set the env var to the canonical project.",
                    code: "FCM_PROJECT_ID_MISSING",
                });
            }
            const fcmDeviceTokenPrefix = attrs.token.substring(0, Math.min(20, attrs.token.length));
            console.log(`[send-push] → calling sendFcmDirect | projectId=${projectId} | tokenPrefix=${fcmDeviceTokenPrefix}...`);
            const fcmResult = await sendFcmDirect({
                projectId,
                deviceToken: attrs.token,
                title,
                body: messageBody,
                data: Object.assign({}, data || {}, { gameId: gameId || "" }),
                eventType,
            });
            console.log(`[send-push] ← FCM result: success=${fcmResult.success} | messageName=${fcmResult.messageName || "?"} | errorCode=${fcmResult.errorCode || "?"} | shouldRemoveToken=${fcmResult.shouldRemoveToken || false}`);
            if (!fcmResult.success) {
                console.error(`[send-push] ✗ FCM delivery FAILED | error=${fcmResult.error} | errorCode=${fcmResult.errorCode}` +
                    ` | shouldRemoveToken=${fcmResult.shouldRemoveToken}` +
                    ` | Possible causes: (1) UNREGISTERED=app uninstalled (2) SENDER_ID_MISMATCH=wrong Firebase project (3) INVALID_ARGUMENT=malformed token`);
                // Token is gone for good — delete the SNS endpoint at the source
                // so no caller resends to it. Stops the dead-token retry storm.
                if (fcmResult.shouldRemoveToken) {
                    await deleteDeadEndpoint(endpointArn, `fcm:${fcmResult.errorCode}`);
                }
                return response(fcmResult.httpStatus >= 500 ? 502 : 400, {
                    success: false,
                    provider: "fcm-v1",
                    projectId,
                    error: fcmResult.error,
                    code: fcmResult.errorCode,
                    shouldRemoveToken: !!fcmResult.shouldRemoveToken,
                    endpointDeleted: !!fcmResult.shouldRemoveToken,
                });
            }
            console.log(`[send-push] ✓ FCM delivered | messageName=${fcmResult.messageName}`);
            return response(200, {
                success: true,
                provider: "fcm-v1",
                projectId,
                messageName: fcmResult.messageName,
                endpointArn,
                platform,
            });
        }

        // ─── Path 3: WNS (Windows) — leaves the SNS path untouched ─────────
        if (platform === "windows") {
            const wnsPayload = {
                notification: { title, body: messageBody },
                data: data || {},
            };
            const message = JSON.stringify({
                default: `${title}: ${messageBody}`,
                WNS: JSON.stringify(wnsPayload),
            });
            const result = await sns.send(new PublishCommand({
                TargetArn: endpointArn,
                Message: message,
                MessageStructure: "json",
            }));
            return response(200, {
                success: true,
                provider: "sns-wns",
                messageId: result.MessageId,
                endpointArn,
                platform,
            });
        }

        return response(400, { success: false, error: `Unsupported platform: ${platform}` });
    } catch (error) {
        console.error(`[send-push] ✗ UNHANDLED EXCEPTION: ${error.name}: ${error.message}`);
        console.error(`[send-push]   arn=${endpointArn} | platform=${platform} | eventType=${eventType}`);
        console.error(`[send-push]   stack=${error.stack}`);
        if (error.name === "EndpointDisabledException") {
            console.error(`[send-push] EndpointDisabledException — SNS permanently disabled this endpoint after repeated delivery failures.` +
                ` | arn=${endpointArn} | shouldRemoveToken=true will be returned to Nakama for cleanup.` +
                ` | Root cause: (1) APNs invalidated device token (app uninstall/reinstall) (2) APNS cert/key expired in SNS Platform App`);
            await deleteDeadEndpoint(endpointArn, "EndpointDisabledException");
            return response(400, { success: false, error: "Endpoint is disabled", code: "ENDPOINT_DISABLED", shouldRemoveToken: true, endpointDeleted: true });
        }
        if (error.name === "InvalidParameterException") {
            console.error(`[send-push] InvalidParameterException — bad ARN or token format.` +
                ` | arn=${endpointArn} | Cause: ARN deleted from SNS console, or account mismatch.`);
            await deleteDeadEndpoint(endpointArn, "InvalidParameterException");
            return response(400, { success: false, error: "Invalid endpoint ARN or parameters", code: "INVALID_PARAMETER", shouldRemoveToken: true, endpointDeleted: true });
        }
        return response(500, { success: false, error: error.message || "Failed to send push notification" });
    }
};

// Public entrypoint: run the real handler, then feed the outcome into the
// rolling delivery-failure alerter before returning. Alerting is best-effort
// and must never change the response the caller receives.
export const handler = async (event) => {
    const res = await handlerImpl(event);
    try { await recordAndMaybeAlert(res); } catch (_) {}
    return res;
};

function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify(body),
    };
}
