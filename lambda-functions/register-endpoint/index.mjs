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

    const { userId, gameId, platform, platformType, deviceToken, isSandbox, fcmProjectId } = body;

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

    const tokenPrefix = deviceToken.substring(0, Math.min(30, deviceToken.length));
    const tokenSuffix = deviceToken.length > 10 ? deviceToken.substring(deviceToken.length - 10) : "";
    console.log(`[register-endpoint] ════ TOKEN ROUTING ════════════════════════════════`);
    console.log(`[register-endpoint] userId=${userId} | platform=${platform} | platformType=${platformType}`);
    console.log(`[register-endpoint] tokenLen=${deviceToken.length} | tokenPrefix=${tokenPrefix}...${tokenSuffix}`);
    console.log(`[register-endpoint] detectedFormat=${detectedFormat} | declaredFormat=${declaredFormat} | wantSandbox=${wantSandbox}`);

    let platformApplicationArn;
    if (effectiveFormat === 'APNS') {
        platformApplicationArn = wantSandbox
            ? SNS_PLATFORM_APPLICATION_ARN_IOS_SANDBOX
            : SNS_PLATFORM_APPLICATION_ARN_IOS;
        console.log(`[register-endpoint] → ROUTING to APNS (native hex token) | sandbox=${wantSandbox} | arn=${platformApplicationArn}`);
    } else if (effectiveFormat === 'FCM') {
        platformApplicationArn = platform === 'web' && SNS_PLATFORM_APPLICATION_ARN_WEB
            ? SNS_PLATFORM_APPLICATION_ARN_WEB
            : SNS_PLATFORM_APPLICATION_ARN_ANDROID;
        console.log(`[register-endpoint] → ROUTING to GCM/FCM platform app (FCM-shaped token) | platform=${platform}`);
        console.log(`[register-endpoint]   iOS-via-FCM: Firebase will bridge to APNs internally using .p8 uploaded in Firebase Console.`);
        console.log(`[register-endpoint]   arn=${platformApplicationArn}`);
        if (platform === 'ios') {
            console.log(`[register-endpoint]   ⚠ iOS using FCM token: ensure APNs Auth Key (.p8) is uploaded in Firebase Console → Project Settings → Cloud Messaging → iOS App Config.`);
        }
    } else if (platformType === 'WNS') {
        platformApplicationArn = SNS_PLATFORM_APPLICATION_ARN_WINDOWS;
        console.log(`[register-endpoint] → ROUTING to WNS | arn=${platformApplicationArn}`);
    } else {
        console.error(`[register-endpoint] FAIL — unsupported platform type: ${platformType} | declared=${declaredFormat} | detected=${detectedFormat}`);
        return response(400, { success: false, error: `Unsupported platform type: ${platformType}` });
    }

    if (declaredFormat !== effectiveFormat) {
        console.warn(`[register-endpoint] ⚠ TOKEN FORMAT OVERRIDE: SDK declared ${declaredFormat} but token shape is ${effectiveFormat}. ` +
            `Routing to ${platformApplicationArn}. This is expected for iOS+Firebase (FCM token routed via GCM Platform App).`);
    }

    if (!platformApplicationArn) {
        console.error(`[register-endpoint] FAIL — no Platform Application ARN configured for platformType=${platformType}. ` +
            `Check Lambda env vars: SNS_PLATFORM_APP_ARN_IOS, SNS_PLATFORM_APP_ARN_ANDROID, etc.`);
        return response(500, {
            success: false,
            error: `Platform application ARN not configured for ${platformType}`
        });
    }

    try {
        // CustomUserData carries the metadata the send-push Lambda needs at
        // delivery time — most importantly `fcmProjectId`, which tells us
        // which Firebase service-account JSON to use for FCM HTTP v1 sends.
        // Without this, FCM rejects every delivery with a SenderId mismatch
        // when the device's project ≠ SNS GCM Platform App's auth project.
        const customUserData = JSON.stringify({
            userId,
            gameId,
            platform,
            declaredFormat,
            effectiveFormat,
            isSandbox: !!wantSandbox,
            fcmProjectId: effectiveFormat === 'FCM' ? (fcmProjectId || '') : ''
        });
        const createEndpointParams = {
            PlatformApplicationArn: platformApplicationArn,
            Token: deviceToken,
            CustomUserData: customUserData,
            Attributes: { Enabled: 'true' }
        };

        console.log(`[register-endpoint] → calling SNS CreatePlatformEndpoint | platformAppArn=${platformApplicationArn} | tokenLen=${deviceToken.length}`);
        let endpointArn;
        try {
            const createResult = await sns.send(new CreatePlatformEndpointCommand(createEndpointParams));
            endpointArn = createResult.EndpointArn;
            console.log(`[register-endpoint] ✓ SNS endpoint CREATED | arn=${endpointArn}`);
        } catch (createError) {
            console.warn(`[register-endpoint] SNS CreatePlatformEndpoint threw: ${createError.name}: ${createError.message}`);
            // Token already exists for a different endpoint → reuse it.
            if (createError.name === 'InvalidParameterException' && createError.message.includes('already exists')) {
                const arnMatch = createError.message.match(/arn:aws:sns:[^:]+:[^:]+:[^:]+:[^:]+:[^:]+/);
                if (arnMatch) {
                    endpointArn = arnMatch[0];
                    console.log(`[register-endpoint] ✓ Recovered existing SNS endpoint | arn=${endpointArn} | re-enabling + refreshing token...`);
                    // Re-enable + refresh token in case it was disabled by APNS feedback.
                    await sns.send(new SetEndpointAttributesCommand({
                        EndpointArn: endpointArn,
                        Attributes: {
                            Token: deviceToken,
                            Enabled: 'true',
                            CustomUserData: customUserData
                        }
                    }));
                    console.log(`[register-endpoint] ✓ Endpoint re-enabled and token refreshed | arn=${endpointArn}`);
                } else {
                    console.error(`[register-endpoint] FAIL — InvalidParameterException but could not extract ARN from message: ${createError.message}`);
                    throw createError;
                }
            } else {
                console.error(`[register-endpoint] FAIL — SNS error: ${createError.name}: ${createError.message}` +
                    ` | Possible causes: (1) Platform App ARN is wrong/deleted (2) APNs .p8 key expired (3) FCM server key revoked`);
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
            fcmProjectId: effectiveFormat === 'FCM' ? (fcmProjectId || '') : '',
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
