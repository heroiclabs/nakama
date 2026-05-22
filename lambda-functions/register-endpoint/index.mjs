// ═══════════════════════════════════════════════════════════════════════════
//  Register Endpoint Lambda  (AWS SDK v3, ESM)
//  Receives a device token from Nakama, creates an SNS Platform Endpoint,
//  returns the endpoint ARN. Hardcoded SNS Platform App ARNs as fallbacks
//  so the Lambda works even if env vars are missing on a fresh deploy.
// ═══════════════════════════════════════════════════════════════════════════

import {
    SNSClient,
    CreatePlatformEndpointCommand,
    SetEndpointAttributesCommand
} from "@aws-sdk/client-sns";
import { PinpointClient, UpdateEndpointCommand } from "@aws-sdk/client-pinpoint";

const sns = new SNSClient({});
const pinpoint = new PinpointClient({});

// ─── Production hardcoded SNS Platform Application ARNs ───────────────────
// Single source of truth. Lambda works even when SNS_PLATFORM_APP_ARN_*
// env vars are missing. Env vars still take precedence so ops can rotate
// ARNs without redeploying. Update these if SNS apps are recreated.
const SNS_ARN_IOS_DEFAULT         = "arn:aws:sns:us-east-1:970547373533:app/APNS/intelliverse-ios";
const SNS_ARN_IOS_SANDBOX_DEFAULT = "arn:aws:sns:us-east-1:970547373533:app/APNS_SANDBOX/intelliverse-ios-sandbox";
const SNS_ARN_ANDROID_DEFAULT     = "arn:aws:sns:us-east-1:970547373533:app/GCM/IntelliVerseX-Android";

const SNS_PLATFORM_APPLICATION_ARN_IOS         = process.env.SNS_PLATFORM_APP_ARN_IOS         || SNS_ARN_IOS_DEFAULT;
const SNS_PLATFORM_APPLICATION_ARN_IOS_SANDBOX = process.env.SNS_PLATFORM_APP_ARN_IOS_SANDBOX || SNS_ARN_IOS_SANDBOX_DEFAULT;
const SNS_PLATFORM_APPLICATION_ARN_ANDROID     = process.env.SNS_PLATFORM_APP_ARN_ANDROID     || SNS_ARN_ANDROID_DEFAULT;
const SNS_PLATFORM_APPLICATION_ARN_WEB         = process.env.SNS_PLATFORM_APP_ARN_WEB;     // optional
const SNS_PLATFORM_APPLICATION_ARN_WINDOWS     = process.env.SNS_PLATFORM_APP_ARN_WINDOWS; // optional
const PINPOINT_APPLICATION_ID                  = process.env.PINPOINT_APPLICATION_ID;

// Native APNs device tokens are hex-encoded 32 bytes (64 chars) or, for
// newer devices, hex-encoded 80 bytes (160 chars). FCM/Firebase tokens
// are base64url-ish strings, usually 140+ chars, often containing ":".
// We trust the token shape over what the SDK *claims* the platform is.
const HEX_TOKEN_RE = /^[0-9a-fA-F]+$/;
function detectTokenFormat(token) {
    const t = (token || "").trim();
    if (HEX_TOKEN_RE.test(t) && (t.length === 64 || t.length === 160)) return "APNS";
    return "FCM";
}

export const handler = async (event) => {
    console.log('Register endpoint request:', JSON.stringify(event, null, 2));

    let body;
    try {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (e) {
        return response(400, { success: false, error: 'Invalid JSON in request body' });
    }

    const { userId, gameId, platform, platformType, deviceToken, isSandbox } = body;

    if (!userId || !gameId || !platform || !platformType || !deviceToken) {
        return response(400, {
            success: false,
            error: 'Missing required fields: userId, gameId, platform, platformType, deviceToken'
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // ROUTING: trust the token shape, not the SDK-declared platformType.
    // Unity on iOS often registers via Firebase Messaging (which yields an
    // FCM token, not a raw APNs token). Sending an FCM-shaped token to the
    // APNs Platform App produces a useless endpoint that silently never
    // delivers. Detecting the actual format and routing to the matching
    // Platform App fixes this for free without any SDK change.
    // ─────────────────────────────────────────────────────────────────────
    const detectedFormat = detectTokenFormat(deviceToken);
    const declaredFormat = platformType;
    const effectiveFormat = detectedFormat;
    const wantSandbox = isSandbox === true || isSandbox === "true";

    let platformApplicationArn;
    if (effectiveFormat === 'APNS') {
        // Hex-shaped → native APNs. Sandbox vs prod by explicit flag.
        platformApplicationArn = wantSandbox
            ? SNS_PLATFORM_APPLICATION_ARN_IOS_SANDBOX
            : SNS_PLATFORM_APPLICATION_ARN_IOS;
    } else if (effectiveFormat === 'FCM') {
        // Firebase token (Android, iOS-via-Firebase, Web). Route by hint
        // platform — only Web has its own Platform App; everything else
        // goes through the GCM Platform App (Firebase forwards iOS tokens
        // to APNs internally, using the .p8 uploaded to Firebase Console).
        platformApplicationArn = platform === 'web' && SNS_PLATFORM_APPLICATION_ARN_WEB
            ? SNS_PLATFORM_APPLICATION_ARN_WEB
            : SNS_PLATFORM_APPLICATION_ARN_ANDROID;
    } else if (platformType === 'WNS') {
        platformApplicationArn = SNS_PLATFORM_APPLICATION_ARN_WINDOWS;
    } else {
        return response(400, { success: false, error: `Unsupported platform type: ${platformType}` });
    }

    if (declaredFormat !== effectiveFormat) {
        console.warn(`Token routing override: SDK declared ${declaredFormat} but token shape is ${effectiveFormat}. Routing to ${platformApplicationArn}.`);
    }

    if (!platformApplicationArn) {
        return response(500, {
            success: false,
            error: `Platform application ARN not configured for ${platformType}`
        });
    }

    try {
        const createEndpointParams = {
            PlatformApplicationArn: platformApplicationArn,
            Token: deviceToken,
            CustomUserData: JSON.stringify({ userId, gameId, platform, declaredFormat, effectiveFormat, isSandbox: !!wantSandbox }),
            Attributes: { Enabled: 'true' }
        };

        let endpointArn;
        try {
            const createResult = await sns.send(new CreatePlatformEndpointCommand(createEndpointParams));
            endpointArn = createResult.EndpointArn;
            console.log(`Created new SNS endpoint: ${endpointArn}`);
        } catch (createError) {
            // Token already exists for a different endpoint → reuse it.
            if (createError.name === 'InvalidParameterException' && createError.message.includes('already exists')) {
                const arnMatch = createError.message.match(/arn:aws:sns:[^:]+:[^:]+:[^:]+:[^:]+:[^:]+/);
                if (arnMatch) {
                    endpointArn = arnMatch[0];
                    console.log(`Using existing SNS endpoint: ${endpointArn}`);
                    // Re-enable + refresh token in case it was disabled by APNS feedback.
                    await sns.send(new SetEndpointAttributesCommand({
                        EndpointArn: endpointArn,
                        Attributes: {
                            Token: deviceToken,
                            Enabled: 'true',
                            CustomUserData: JSON.stringify({ userId, gameId, platform, declaredFormat, effectiveFormat, isSandbox: !!wantSandbox })
                        }
                    }));
                } else {
                    throw createError;
                }
            } else {
                throw createError;
            }
        }

        // Pinpoint integration is optional — only runs if PINPOINT_APPLICATION_ID
        // is set. Best-effort; failure here doesn't fail the whole register call.
        if (PINPOINT_APPLICATION_ID) {
            try {
                const pinpointEndpointId = `${userId}_${gameId}_${platform}`;
                await pinpoint.send(new UpdateEndpointCommand({
                    ApplicationId: PINPOINT_APPLICATION_ID,
                    EndpointId: pinpointEndpointId,
                    EndpointRequest: {
                        Address: deviceToken,
                        ChannelType: platformType === 'APNS' ? 'APNS' :
                                    platformType === 'FCM' ? 'GCM' :
                                    platformType === 'WNS' ? 'ADM' : 'APNS',
                        User: { UserId: userId },
                        Attributes: { gameId: [gameId], platform: [platform] },
                        OptOut: 'NONE'
                    }
                }));
                console.log(`Registered with Pinpoint: ${pinpointEndpointId}`);
            } catch (pinpointError) {
                console.warn('Pinpoint registration failed:', pinpointError.message);
            }
        }

        return response(200, {
            success: true,
            // Return both field names: `endpointArn` (canonical, used by
            // Nakama's wrapper and the bridge lambda) and `snsEndpointArn`
            // (legacy, kept for back-compat with older callers/SDK builds).
            endpointArn: endpointArn,
            snsEndpointArn: endpointArn,
            userId: userId,
            gameId: gameId,
            platform: platform,
            platformType: platformType,
            effectiveFormat,
            isSandbox: !!wantSandbox,
            routedTo: platformApplicationArn.split(':app/')[1] || platformApplicationArn
        });

    } catch (error) {
        console.error('Error registering endpoint:', error);
        return response(500, { success: false, error: error.message || 'Failed to register endpoint' });
    }
};

function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify(body)
    };
}
