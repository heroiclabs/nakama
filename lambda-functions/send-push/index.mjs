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

import { SNSClient, PublishCommand, GetEndpointAttributesCommand } from "@aws-sdk/client-sns";
import { sendFcmDirect } from "./fcm-direct.mjs";

const sns = new SNSClient({});

const DEFAULT_FCM_PROJECT_ID = process.env.DEFAULT_FCM_PROJECT_ID || "";

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

export const handler = async (event) => {
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
    if (arnPlatform && requestedPlatform && arnPlatform !== String(requestedPlatform).toLowerCase()) {
        console.warn(
            `[send-push] caller said platform=${requestedPlatform} but ARN resolves to ${arnPlatform}. ` +
            `Trusting ARN. arn=${endpointArn}`
        );
    }

    try {
        // ─── Path 1: native APNs token via SNS Publish ─────────────────────
        // SNS APNs auth uses our .p8 key (one Team owns one APNs cert/key,
        // no project mismatch possible) so this path is reliable.
        if (platform === "ios") {
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
            const result = await sns.send(new PublishCommand({
                TargetArn: endpointArn,
                Message: message,
                MessageStructure: "json",
                MessageAttributes: {
                    gameId: { DataType: "String", StringValue: gameId || "" },
                    eventType: { DataType: "String", StringValue: eventType || "" },
                },
            }));
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
            const attrs = await readEndpointAttrs(endpointArn);
            if (!attrs.token) {
                return response(400, {
                    success: false,
                    error: "Endpoint has no Token attribute — re-register the device",
                    code: "ENDPOINT_TOKEN_MISSING",
                });
            }
            if (!attrs.enabled) {
                console.warn(`[send-push] endpoint disabled, attempting send anyway. arn=${endpointArn}`);
            }
            const projectId = attrs.userData.fcmProjectId || DEFAULT_FCM_PROJECT_ID;
            if (!projectId) {
                return response(400, {
                    success: false,
                    error: "No fcmProjectId on endpoint and no DEFAULT_FCM_PROJECT_ID env var. " +
                           "Re-register the device with fcmProjectId, or set the env var to the canonical project.",
                    code: "FCM_PROJECT_ID_MISSING",
                });
            }
            const fcmResult = await sendFcmDirect({
                projectId,
                deviceToken: attrs.token,
                title,
                body: messageBody,
                data: Object.assign({}, data || {}, { gameId: gameId || "" }),
                eventType,
            });
            if (!fcmResult.success) {
                return response(fcmResult.httpStatus >= 500 ? 502 : 400, {
                    success: false,
                    provider: "fcm-v1",
                    projectId,
                    error: fcmResult.error,
                    code: fcmResult.errorCode,
                    shouldRemoveToken: !!fcmResult.shouldRemoveToken,
                });
            }
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
        console.error("[send-push] Error:", error);
        if (error.name === "EndpointDisabledException") {
            return response(400, { success: false, error: "Endpoint is disabled", code: "ENDPOINT_DISABLED" });
        }
        if (error.name === "InvalidParameterException") {
            return response(400, { success: false, error: "Invalid endpoint ARN or parameters", code: "INVALID_PARAMETER" });
        }
        return response(500, { success: false, error: error.message || "Failed to send push notification" });
    }
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
