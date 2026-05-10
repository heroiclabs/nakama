const AWS = require('aws-sdk');
const sns = new AWS.SNS();

exports.handler = async (event) => {
    console.log('Send push request:', JSON.stringify(event, null, 2));
    
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
    
    const { endpointArn, platform, title, body: messageBody, data, gameId, eventType } = body;
    
    if (!endpointArn || !platform || !title || !messageBody) {
        return {
            statusCode: 400,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                error: 'Missing required fields: endpointArn, platform, title, body'
            })
        };
    }
    
    try {
        let message;
        let messageStructure = 'json';

        // Always merge gameId + eventType into the custom data dict that the
        // device receives. The Unity FCMManager / iOS handler reads eventType
        // from this dict to route deep-links correctly.
        const customData = Object.assign({}, data || {}, {
            gameId: gameId || '',
            eventType: eventType || ''
        });

        if (platform === 'ios') {
            // Mirrors the deployed Lambda (see index.mjs). Custom keys
            // (gameId, eventType, ...) live at the TOP level of the APNS
            // dict — that's where iOS delivers them to the app.
            const apnsPayload = Object.assign({
                aps: {
                    alert: { title: title, body: messageBody },
                    sound: 'default',
                    badge: 1,
                    'mutable-content': 1,
                    'content-available': 1,
                    'thread-id': eventType || 'general'
                }
            }, customData);

            message = JSON.stringify({
                default: `${title}: ${messageBody}`,
                APNS: JSON.stringify(apnsPayload),
                APNS_SANDBOX: JSON.stringify(apnsPayload)
            });

        } else if (platform === 'android' || platform === 'web') {
            // Mirrors the deployed Lambda (see index.mjs). Custom keys live
            // in `data:` per FCM contract — Unity reads them via
            // `MessageReceivedEventArgs.Message.Data`.
            const fcmPayload = {
                notification: {
                    title: title,
                    body: messageBody,
                    tag: eventType || 'general'
                },
                data: customData,
                priority: 'high',
                time_to_live: 3600
            };

            message = JSON.stringify({
                default: `${title}: ${messageBody}`,
                GCM: JSON.stringify(fcmPayload)
            });

        } else if (platform === 'windows') {
            const wnsPayload = {
                notification: {
                    title: title,
                    body: messageBody
                },
                data: data || {}
            };
            
            message = JSON.stringify({
                default: `${title}: ${messageBody}`,
                WNS: JSON.stringify(wnsPayload)
            });
            
        } else {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    success: false,
                    error: `Unsupported platform: ${platform}`
                })
            };
        }
        
        const publishParams = {
            TargetArn: endpointArn,
            Message: message,
            MessageStructure: messageStructure,
            MessageAttributes: {
                gameId: {
                    DataType: 'String',
                    StringValue: gameId || ''
                },
                eventType: {
                    DataType: 'String',
                    StringValue: eventType || ''
                }
            }
        };
        
        const result = await sns.publish(publishParams).promise();
        
        console.log(`Push notification sent. MessageId: ${result.MessageId}`);
        
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: true,
                messageId: result.MessageId,
                endpointArn: endpointArn,
                platform: platform
            })
        };
        
    } catch (error) {
        console.error('Error sending push notification:', error);
        
        if (error.code === 'EndpointDisabled') {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    success: false,
                    error: 'Endpoint is disabled',
                    code: 'ENDPOINT_DISABLED'
                })
            };
        } else if (error.code === 'InvalidParameter') {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid endpoint ARN or parameters',
                    code: 'INVALID_PARAMETER'
                })
            };
        }
        
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: false,
                error: error.message || 'Failed to send push notification'
            })
        };
    }
};


