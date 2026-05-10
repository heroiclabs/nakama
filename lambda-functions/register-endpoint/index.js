const AWS = require('aws-sdk');
const sns = new AWS.SNS();
const pinpoint = new AWS.Pinpoint();

// ─── Production hardcoded SNS Platform Application ARNs ────────────────────
// Single source of truth. The Lambda works even when SNS_PLATFORM_APP_ARN_*
// env vars are missing (e.g. on a fresh deploy or after an env-var wipe).
// Env vars still take precedence so ops can rotate ARNs without redeploying.
//
// Update these values if the SNS Platform App is ever recreated.
const SNS_ARN_IOS_DEFAULT     = "arn:aws:sns:us-east-1:970547373533:app/APNS/intelliverse-ios";
const SNS_ARN_ANDROID_DEFAULT = "arn:aws:sns:us-east-1:970547373533:app/GCM/IntelliVerseX-Android";

const SNS_PLATFORM_APPLICATION_ARN_IOS     = process.env.SNS_PLATFORM_APP_ARN_IOS     || SNS_ARN_IOS_DEFAULT;
const SNS_PLATFORM_APPLICATION_ARN_ANDROID = process.env.SNS_PLATFORM_APP_ARN_ANDROID || SNS_ARN_ANDROID_DEFAULT;
const SNS_PLATFORM_APPLICATION_ARN_WEB     = process.env.SNS_PLATFORM_APP_ARN_WEB; // optional (no default yet)
const SNS_PLATFORM_APPLICATION_ARN_WINDOWS = process.env.SNS_PLATFORM_APP_ARN_WINDOWS; // optional (no default yet)
const PINPOINT_APPLICATION_ID              = process.env.PINPOINT_APPLICATION_ID;

exports.handler = async (event) => {
    console.log('Register endpoint request:', JSON.stringify(event, null, 2));
    
    let body;
    try {
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (e) {
        return {
            statusCode: 400,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                error: 'Invalid JSON in request body'
            })
        };
    }
    
    const { userId, gameId, platform, platformType, deviceToken } = body;
    
    if (!userId || !gameId || !platform || !platformType || !deviceToken) {
        return {
            statusCode: 400,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                error: 'Missing required fields: userId, gameId, platform, platformType, deviceToken'
            })
        };
    }
    
    let platformApplicationArn;
    switch (platformType) {
        case 'APNS':
            platformApplicationArn = SNS_PLATFORM_APPLICATION_ARN_IOS;
            break;
        case 'FCM':
            platformApplicationArn = platform === 'web' 
                ? SNS_PLATFORM_APPLICATION_ARN_WEB 
                : SNS_PLATFORM_APPLICATION_ARN_ANDROID;
            break;
        case 'WNS':
            platformApplicationArn = SNS_PLATFORM_APPLICATION_ARN_WINDOWS;
            break;
        default:
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    success: false,
                    error: `Unsupported platform type: ${platformType}`
                })
            };
    }
    
    if (!platformApplicationArn) {
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                error: `Platform application ARN not configured for ${platformType}`
            })
        };
    }
    
    try {
        const createEndpointParams = {
            PlatformApplicationArn: platformApplicationArn,
            Token: deviceToken,
            CustomUserData: JSON.stringify({ userId, gameId, platform }),
            Attributes: {
                Token: deviceToken,
                Enabled: 'true',
                CustomUserData: JSON.stringify({ userId, gameId, platform })
            }
        };
        
        let endpointArn;
        try {
            const createResult = await sns.createPlatformEndpoint(createEndpointParams).promise();
            endpointArn = createResult.EndpointArn;
            console.log(`Created new SNS endpoint: ${endpointArn}`);
        } catch (createError) {
            if (createError.code === 'InvalidParameter' && createError.message.includes('already exists')) {
                const arnMatch = createError.message.match(/arn:aws:sns:[^:]+:[^:]+:[^:]+:[^:]+:[^:]+/);
                if (arnMatch) {
                    endpointArn = arnMatch[0];
                    console.log(`Using existing SNS endpoint: ${endpointArn}`);
                    await sns.setEndpointAttributes({
                        EndpointArn: endpointArn,
                        Attributes: {
                            Token: deviceToken,
                            Enabled: 'true',
                            CustomUserData: JSON.stringify({ userId, gameId, platform })
                        }
                    }).promise();
                } else {
                    throw createError;
                }
            } else {
                throw createError;
            }
        }
        
        if (PINPOINT_APPLICATION_ID) {
            try {
                const pinpointEndpointId = `${userId}_${gameId}_${platform}`;
                await pinpoint.updateEndpoint({
                    ApplicationId: PINPOINT_APPLICATION_ID,
                    EndpointId: pinpointEndpointId,
                    EndpointRequest: {
                        Address: deviceToken,
                        ChannelType: platformType === 'APNS' ? 'APNS' : 
                                    platformType === 'FCM' ? 'GCM' : 
                                    platformType === 'WNS' ? 'ADM' : 'APNS',
                        User: { UserId: userId },
                        Attributes: {
                            gameId: [gameId],
                            platform: [platform]
                        },
                        OptOut: 'NONE'
                    }
                }).promise();
                console.log(`Registered with Pinpoint: ${pinpointEndpointId}`);
            } catch (pinpointError) {
                console.warn('Pinpoint registration failed:', pinpointError.message);
            }
        }
        
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: true,
                snsEndpointArn: endpointArn,
                userId: userId,
                gameId: gameId,
                platform: platform,
                platformType: platformType
            })
        };
        
    } catch (error) {
        console.error('Error registering endpoint:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                error: error.message || 'Failed to register endpoint'
            })
        };
    }
};


