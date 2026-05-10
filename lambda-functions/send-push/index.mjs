import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const sns = new SNSClient({});

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

    const { endpointArn, platform, title, body: messageBody, data, gameId, eventType } = body || {};

    if (!endpointArn || !platform || !title || !messageBody) {
        return response(400, {
            success: false,
            error: "Missing required fields: endpointArn, platform, title, body"
        });
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
