# Nakama Cognito Auth + Wallet Module

This Go runtime module for Nakama provides:
- AWS Cognito ID token authentication via JWT/JWKS
- Account linking with Cognito IDs
- Nakama wallet operations (read, update, ledger)

## Features

- **Cognito Authentication**: Authenticate users with AWS Cognito ID tokens
- **Account Linking**: Link Cognito IDs to existing Nakama accounts
- **Wallet Management**: Server-authoritative wallet operations with ledger tracking
- **Cross-Platform Identity**: Same Cognito user across multiple games/apps

## Environment Variables

Configure these environment variables before starting Nakama:

```bash
# Required
NAKAMA_COGNITO_ISS="https://cognito-idp.<region>.amazonaws.com/<pool_id>"
NAKAMA_COGNITO_AUDIENCE="<your-cognito-app-client-id>"

# Optional
NAKAMA_JWKS_CACHE_TTL=3600  # JWKS cache TTL in seconds (default: 3600)
```

## Building

Build the plugin as a shared library:

```bash
cd runtime
go mod tidy
go build -buildmode=plugin -trimpath -o runtime.so
```

## Loading into Nakama

### Option 1: Local Development

Run Nakama with the runtime path flag:

```bash
nakama --runtime.path /path/to/runtime
```

### Option 2: Docker

1. Copy the built `runtime.so` to a modules directory
2. Mount it in your Docker compose:

```yaml
services:
  nakama:
    image: heroiclabs/nakama:3.x.x
    volumes:
      - ./runtime/runtime.so:/nakama/data/modules/runtime.so
    environment:
      NAKAMA_COGNITO_ISS: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXX"
      NAKAMA_COGNITO_AUDIENCE: "your-app-client-id"
```

## RPC Endpoints

### 1. `rpc_cognito_login`

Authenticate with a Cognito ID token.

**Request:**
```json
{
  "id_token": "<Cognito ID JWT>",
  "create": true,
  "username": "optional-username"
}
```

**Response:**
```json
{
  "token": "<nakama-session-token>"
}
```

**Example (JavaScript):**
```javascript
const response = await client.rpc(session, "rpc_cognito_login", {
  id_token: cognitoIdToken,
  create: true,
  username: "player123"
});
const nakamaToken = response.token;
```

### 2. `rpc_link_cognito`

Link a Cognito ID to the current authenticated user.

**Request:**
```json
{
  "id_token": "<Cognito ID JWT>"
}
```

**Response:**
```json
{
  "linked": true
}
```

**Example (JavaScript):**
```javascript
// Requires existing Nakama session
const response = await client.rpc(session, "rpc_link_cognito", {
  id_token: cognitoIdToken
});
```

### 3. `rpc_wallet_get`

Get the current wallet balances.

**Request:** Empty or `{}`

**Response:**
```json
{
  "wallet": {
    "gold": 1250,
    "gems": 7
  },
  "updated_at": 1710000000
}
```

**Example (JavaScript):**
```javascript
const response = await client.rpc(session, "rpc_wallet_get", {});
console.log("Gold:", response.wallet.gold);
```

### 4. `rpc_wallet_update`

Update wallet balances (server-authoritative).

**Request:**
```json
{
  "changes": {
    "gold": 100,
    "gems": -1
  },
  "metadata": {
    "reason": "bundle_purchase",
    "orderId": "ORD-123"
  }
}
```

**Response:**
```json
{
  "wallet": {
    "gold": 1350,
    "gems": 6
  },
  "updated_at": 1710000500
}
```

**Example (JavaScript):**
```javascript
const response = await client.rpc(session, "rpc_wallet_update", {
  changes: { gold: 100, gems: -1 },
  metadata: { reason: "shop_purchase", item_id: "bundle_001" }
});
```

**Notes:**
- Positive values increment, negative values decrement
- Cannot decrement below zero (returns error)
- All changes are atomic
- Metadata is optional but recommended for audit trails

### 5. `rpc_wallet_ledger`

List wallet transaction history with pagination.

**Request:**
```json
{
  "limit": 25,
  "cursor": ""
}
```

**Response:**
```json
{
  "items": [
    {
      "changes": {"gold": 100},
      "metadata": {"reason": "level_reward"},
      "create_time": 1710000000
    },
    {
      "changes": {"gems": -1},
      "metadata": {"reason": "reroll"},
      "create_time": 1710000500
    }
  ],
  "cursor": "next-page-cursor"
}
```

**Example (JavaScript):**
```javascript
const response = await client.rpc(session, "rpc_wallet_ledger", {
  limit: 50,
  cursor: ""
});

for (const item of response.items) {
  console.log("Transaction:", item.changes, "at", item.create_time);
}
```

## Security

### Authentication Flow

1. User authenticates with AWS Cognito and receives an ID token
2. Client calls `rpc_cognito_login` with the ID token
3. Server verifies the token signature via JWKS
4. Server validates token claims (issuer, audience, expiration)
5. Server creates/retrieves Nakama account with external ID: `cognito:<sub>`
6. Server returns Nakama session token

### Wallet Security

- All wallet mutations must go through the `rpc_wallet_update` RPC
- Updates are server-authoritative (clients cannot directly modify wallets)
- Negative balances are prevented (validation before update)
- All changes are logged to the wallet ledger with metadata
- Rate limiting should be applied at the Nakama level

### Best Practices

1. **Never expose Cognito credentials** in client code
2. **Use metadata** in wallet updates for audit trails
3. **Implement rate limiting** on wallet RPCs
4. **Validate currency types** (you can add an allowlist in `rpc_wallet_update`)
5. **Monitor ledger** for suspicious activity

## External ID Format

The module uses the format: `cognito:<cognito-sub>`

This ensures:
- Same Cognito user = same Nakama user across all apps
- Support for multiple authentication methods per user
- Compatibility with Nakama's multi-auth system

## Claims Mapping

Cognito claims are mapped to Nakama user metadata:

| Cognito Claim | Nakama Field |
|---------------|--------------|
| `sub` | External ID (cognito:sub) |
| `email` | metadata.email |
| `email_verified` | metadata.email_verified |
| `name` | metadata.name |
| `picture` | metadata.picture |

## Error Handling

Common errors and their meanings:

- `"invalid token"`: JWT signature verification failed or malformed token
- `"token expired"`: Token is past its expiration time
- `"invalid token issuer"`: Token not from configured Cognito pool
- `"invalid token audience"`: Token not for configured app client
- `"insufficient balance"`: Attempted to decrement below zero
- `"unauthorized"`: RPC requires authenticated session

## Dependencies

- `github.com/heroiclabs/nakama-common` v1.42.1
- `github.com/golang-jwt/jwt/v5` v5.3.0
- `github.com/MicahParks/keyfunc/v3` v3.3.7

## License

Copyright 2025 The Nakama Authors

Licensed under the Apache License, Version 2.0.
