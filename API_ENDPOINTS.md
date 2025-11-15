# Push Notifications API Endpoints

## Base URL
```
http://your-nakama-server:7350/v2/rpc/{rpc_id}
```

## Authentication
```
Authorization: Bearer {session_token}
```

---

## 1. Register Push Token

**Endpoint:** `POST /v2/rpc/push_register_token`

**Description:** Register a device push token for receiving push notifications. Unity clients send raw device tokens, Nakama forwards to AWS Lambda to create SNS endpoints.

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer {session_token}
```

**Request Body:**
```json
{
  "gameId": "123e4567-e89b-12d3-a456-426614174000",
  "platform": "ios",
  "token": "apns_device_token_here"
}
```

**Platform Values:**
- `ios` - iOS devices (APNS)
- `android` - Android devices (FCM)
- `web` - Web/PWA (FCM)
- `windows` - Windows devices (WNS)

**Success Response (200):**
```json
{
  "success": true,
  "userId": "user-uuid",
  "gameId": "123e4567-e89b-12d3-a456-426614174000",
  "platform": "ios",
  "endpointArn": "arn:aws:sns:us-east-1:123456789012:endpoint/APNS/myapp/abc123",
  "registeredAt": "2024-11-14T17:00:00Z"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error message here"
}
```

**cURL Example:**
```bash
curl -X POST "http://your-nakama-server:7350/v2/rpc/push_register_token" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -d '{
    "gameId": "123e4567-e89b-12d3-a456-426614174000",
    "platform": "ios",
    "token": "your_device_token"
  }'
```

---

## 2. Send Push Notification

**Endpoint:** `POST /v2/rpc/push_send_event`

**Description:** Send a push notification to a user's registered devices. Server-side triggered notifications.

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer {session_token}
```

**Request Body:**
```json
{
  "targetUserId": "123e4567-e89b-12d3-a456-426614174000",
  "gameId": "123e4567-e89b-12d3-a456-426614174001",
  "eventType": "daily_reward_available",
  "title": "Daily Reward Available!",
  "body": "Claim your daily login bonus now!",
  "data": {
    "rewardType": "coins",
    "amount": 100
  }
}
```

**Event Types:**
- `daily_reward_available` - Daily login bonus available
- `mission_completed` - Mission/objective completed
- `streak_warning` - Streak about to expire
- `friend_request` - New friend request
- `friend_online` - Friend came online
- `challenge_invite` - Friend challenged you
- `match_ready` - Matchmaking found opponents
- `wallet_reward_drop` - Currency/items received
- `new_season` - New season/quiz pack available

**Success Response (200):**
```json
{
  "success": true,
  "targetUserId": "123e4567-e89b-12d3-a456-426614174000",
  "gameId": "123e4567-e89b-12d3-a456-426614174001",
  "eventType": "daily_reward_available",
  "sentCount": 2,
  "totalEndpoints": 2,
  "timestamp": "2024-11-14T17:00:00Z"
}
```

**Partial Success Response:**
```json
{
  "success": true,
  "sentCount": 1,
  "totalEndpoints": 2,
  "errors": [
    {
      "platform": "ios",
      "error": "Lambda returned code 500"
    }
  ]
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "No registered push endpoints for user"
}
```

**cURL Example:**
```bash
curl -X POST "http://your-nakama-server:7350/v2/rpc/push_send_event" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -d '{
    "targetUserId": "123e4567-e89b-12d3-a456-426614174000",
    "gameId": "123e4567-e89b-12d3-a456-426614174001",
    "eventType": "daily_reward_available",
    "title": "Daily Reward Available!",
    "body": "Claim your daily login bonus now!",
    "data": {}
  }'
```

---

## 3. Get Registered Endpoints

**Endpoint:** `POST /v2/rpc/push_get_endpoints`

**Description:** Get all registered push notification endpoints for the authenticated user.

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer {session_token}
```

**Request Body:**
```json
{
  "gameId": "123e4567-e89b-12d3-a456-426614174000"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "userId": "user-uuid",
  "gameId": "123e4567-e89b-12d3-a456-426614174000",
  "endpoints": [
    {
      "userId": "user-uuid",
      "gameId": "123e4567-e89b-12d3-a456-426614174000",
      "platform": "ios",
      "endpointArn": "arn:aws:sns:us-east-1:123456789012:endpoint/APNS/myapp/abc123",
      "createdAt": "2024-11-14T16:00:00Z",
      "updatedAt": "2024-11-14T16:00:00Z"
    },
    {
      "userId": "user-uuid",
      "gameId": "123e4567-e89b-12d3-a456-426614174000",
      "platform": "android",
      "endpointArn": "arn:aws:sns:us-east-1:123456789012:endpoint/GCM/myapp/def456",
      "createdAt": "2024-11-14T15:00:00Z",
      "updatedAt": "2024-11-14T15:00:00Z"
    }
  ],
  "count": 2,
  "timestamp": "2024-11-14T17:00:00Z"
}
```

**cURL Example:**
```bash
curl -X POST "http://your-nakama-server:7350/v2/rpc/push_get_endpoints" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -d '{
    "gameId": "123e4567-e89b-12d3-a456-426614174000"
  }'
```

---

## Error Codes

- `400 Bad Request` - Invalid request payload or missing required fields
- `401 Unauthorized` - Authentication required or invalid token
- `404 Not Found` - RPC endpoint not found
- `500 Internal Server Error` - Server error

## Notes

- All `gameId` and `userId` fields must be valid UUID v4 format
- Users can register multiple devices (e.g., iPhone + iPad + Android)
- The `push_send_event` endpoint sends notifications to all registered devices for the user
- Lambda Function URLs must be configured in Nakama environment variables:
  - `PUSH_LAMBDA_URL` - For endpoint registration
  - `PUSH_SEND_URL` - For sending notifications

