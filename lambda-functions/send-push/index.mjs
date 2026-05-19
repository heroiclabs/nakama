import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const sns = new SNSClient({});

// Derive the real platform from the SNS endpoint ARN. The ARN is the only
// source of truth for which Platform Application a device actually lives in
// (and therefore which envelope shape SNS will deliver). Callers sometimes
// pass `platform: "ios"` for an Android endpoint (legacy bug), and if we
// trusted them we'd build {default, APNS, APNS_SANDBOX}, SNS would forward
// `default` plain text to FCM, and the Android device would render nothing.
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

export const handler = async (event) => {
    console.log("Send push request:", JSON.stringify(event, null, 2));
    
    let body;
    try {
        body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    } catch (e) {
        return response(400, {
            success: false,
            error: "Invalid JSON in request body"
        });
    }

    const { endpointArn, platform: requestedPlatform, title, body: messageBody, data, gameId, eventType } = body || {};

    if (!endpointArn || !requestedPlatform || !title || !messageBody) {
        return response(400, {
            success: false,
            error: "Missing required fields: endpointArn, platform, title, body"
        });
    }

    // Trust the ARN over the caller's `platform` claim. If they disagree, log
    // it loudly so the upstream registration bug stays visible until fixed.
    const arnPlatform = platformFromArn(endpointArn);
    const platform = arnPlatform || String(requestedPlatform || "").toLowerCase();
    if (arnPlatform && arnPlatform !== String(requestedPlatform || "").toLowerCase()) {
        console.warn(
            `[send-push] caller said platform=${requestedPlatform} but ARN resolves to ${arnPlatform}. ` +
            `Trusting ARN. arn=${endpointArn} — fix push_register_token to use the ARN-derived platform.`
        );
    }

    try {
        let message;
        
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
                ...data
            };
            message = JSON.stringify({
                default: `${title}: ${messageBody}`,
                APNS: JSON.stringify(apnsPayload),
                APNS_SANDBOX: JSON.stringify(apnsPayload)
            });
        } else if (platform === "android" || platform === "web") {
            const fcmPayload = {
                notification: { title, body: messageBody, tag: eventType || "general" },
                data: {
                    ...(data || {}),
                    gameId: gameId || "",
                    eventType: eventType || ""
                },
                priority: "high",
                time_to_live: 3600
            };
            message = JSON.stringify({
                default: `${title}: ${messageBody}`,
                GCM: JSON.stringify(fcmPayload)
            });
        } else if (platform === "windows") {
            const wnsPayload = {
                notification: { title, body: messageBody },
                data: data || {}
            };
            message = JSON.stringify({
                default: `${title}: ${messageBody}`,
                WNS: JSON.stringify(wnsPayload)
            });
        } else {
            return response(400, {
                success: false,
                error: `Unsupported platform: ${platform}`
            });
        }

        const publishParams = {
            TargetArn: endpointArn,
            Message: message,
            MessageStructure: "json",
            MessageAttributes: {
                gameId: { DataType: "String", StringValue: gameId || "" },
                eventType: { DataType: "String", StringValue: eventType || "" }
            }
        };

        const result = await sns.send(new PublishCommand(publishParams));
        console.log("Push sent:", result.MessageId);

        return response(200, {
            success: true,
            messageId: result.MessageId,
            endpointArn,
            platform
        });
    } catch (error) {
        console.error("SNS Error:", error);
        
        if (error.name === "EndpointDisabledException") {
            return response(400, {
                success: false,
                error: "Endpoint is disabled",
                code: "ENDPOINT_DISABLED"
            });
        }
        
        if (error.name === "InvalidParameterException") {
            return response(400, {
                success: false,
                error: "Invalid endpoint ARN or parameters",
                code: "INVALID_PARAMETER"
            });
        }
        
        return response(500, {
            success: false,
            error: error.message || "Failed to send push notification"
        });
    }
};

function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify(body)
    };
}
