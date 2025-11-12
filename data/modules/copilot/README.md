# Copilot Wallet Mapping Module

## Overview

The Copilot Wallet Mapping module provides a **one-to-one, permanent mapping** between AWS Cognito users and global wallets shared across all IntelliVerse X games. Each Cognito user's `sub` (UUID) serves as the unique wallet ID reference.

## Architecture

### Single Source of Truth
- Each Cognito user corresponds to **exactly one wallet**
- Wallet ID = Cognito `sub` claim from JWT token
- Mapping stored in Nakama storage under `wallet_registry` collection

### Global Wallet System
- Shared wallet accessible from all IntelliVerse X games
- Games retrieve wallets via Cognito-authenticated JWT
- No duplicate wallets - registry ensures uniqueness

## File Structure

```
copilot/
├── index.js                      # Module initialization and RPC registration
├── cognito_wallet_mapper.js      # Core RPC implementations
├── wallet_registry.js            # CRUD operations for wallet storage
├── wallet_utils.js               # JWT decoding and validation utilities
└── test_wallet_mapping.js        # Automated test suite
```

## Registered RPCs

### 1. `get_user_wallet`

Retrieves or creates a wallet for a Cognito user.

**Request:**
```json
{
  "token": "<cognito_jwt>"
}
```

**Response:**
```json
{
  "success": true,
  "walletId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "active",
  "gamesLinked": ["game1", "game2"],
  "createdAt": "2025-11-12T15:30:00Z"
}
```

**Behavior:**
- Decodes Cognito JWT and extracts `sub` and `email`
- Queries wallet registry by `walletId = sub`
- Creates new wallet if not found
- Returns wallet information

### 2. `link_wallet_to_game`

Links a wallet to a specific game context.

**Request:**
```json
{
  "token": "<cognito_jwt>",
  "gameId": "fc3db911-42e8-4f95-96d1-41c3e7b9812d"
}
```

**Response:**
```json
{
  "success": true,
  "walletId": "550e8400-e29b-41d4-a716-446655440000",
  "gameId": "fc3db911-42e8-4f95-96d1-41c3e7b9812d",
  "gamesLinked": ["game1", "game2", "fc3db911-42e8-4f95-96d1-41c3e7b9812d"],
  "message": "Game successfully linked to wallet"
}
```

**Behavior:**
- Ensures wallet exists for the user
- Adds game to `gamesLinked` array (if not already present)
- Updates wallet record in storage

### 3. `get_wallet_registry`

Returns all wallets in the registry (admin function).

**Request:**
```json
{
  "limit": 100
}
```

**Response:**
```json
{
  "success": true,
  "wallets": [
    {
      "walletId": "550e8400-e29b-41d4-a716-446655440000",
      "userId": "550e8400-e29b-41d4-a716-446655440000",
      "username": "user@example.com",
      "createdAt": "2025-11-12T15:30:00Z",
      "gamesLinked": ["game1", "game2"],
      "status": "active"
    }
  ],
  "count": 1
}
```

## Wallet Storage Schema

Wallets are stored in Nakama storage with the following structure:

```json
{
  "walletId": "uuid-from-cognito",
  "userId": "uuid-from-cognito",
  "username": "player@example.com",
  "createdAt": "2025-11-12T15:30:00Z",
  "gamesLinked": ["game1", "game2", "game3"],
  "status": "active"
}
```

**Storage Details:**
- **Collection:** `wallet_registry`
- **Key:** User's Cognito `sub` (UUID)
- **User ID:** System user (`00000000-0000-0000-0000-000000000000`)
- **Permissions:** Public read (1), No public write (0)

## Usage Example

### Game Client Integration

1. **User authenticates via Cognito** and obtains JWT token
2. **Client sends request** to Nakama:

```javascript
// Using Nakama JavaScript client
const payload = {
  token: "<cognito_jwt>",
  gameId: "fc3db911-42e8-4f95-96d1-41c3e7b9812d"
};

// Get or create wallet
const walletResponse = await client.rpc(
  session,
  "get_user_wallet",
  JSON.stringify(payload)
);

console.log("Wallet ID:", walletResponse.walletId);

// Link wallet to current game
const linkResponse = await client.rpc(
  session,
  "link_wallet_to_game",
  JSON.stringify(payload)
);

console.log("Games linked:", linkResponse.gamesLinked);
```

### Using Nakama Context (Alternative)

If the user is already authenticated with Nakama, the RPCs can use `ctx.userId` instead of requiring a JWT token:

```javascript
// No token needed if user is authenticated with Nakama
const payload = {
  gameId: "fc3db911-42e8-4f95-96d1-41c3e7b9812d"
};

const response = await client.rpc(
  session,
  "get_user_wallet",
  JSON.stringify(payload)
);
```

## Security Features

### JWT Validation
- Validates JWT structure (header.payload.signature)
- Extracts and validates required claims (`sub`, `email`)
- Error handling for invalid tokens

### Storage Security
- Wallets stored with system user ID for centralized management
- Public read permissions allow games to query wallets
- No public write permissions prevent unauthorized modifications
- One-wallet-per-user invariant enforced

### Audit Logging
- All wallet operations logged with context
- Creates audit trail for wallet creation and game linkage
- Error logging for debugging and security monitoring

## Testing

Run automated tests:

```bash
cd /home/runner/work/nakama/nakama/data/modules/copilot
node test_wallet_mapping.js
```

**Test Coverage:**
- Mock Cognito token generation
- JWT decoding and validation
- Wallet creation for new users
- Wallet reuse on re-login
- Multiple game linkage
- One-to-one mapping validation
- Error handling for invalid tokens

## Integration with IntelliVerse X

The central wallet enables:
- **Cross-game tokens and rewards** - Shared currency across all games
- **Unified inventory & NFTs** - Items accessible in multiple games
- **Global player profile** - Single identity across ecosystem
- **Blockchain sync layer** - Future-ready for token integration

## Module Initialization

The module is automatically initialized when Nakama starts via the main `index.js`:

```javascript
// Main index.js loads copilot module
var CopilotModule = require('./copilot/index.js').CopilotModule;

function InitModule(ctx, logger, nk, initializer) {
    // Initialize Copilot Wallet Mapping Module
    CopilotModule.init(ctx, logger, nk, initializer);
    // ... rest of initialization
}
```

The module registers all RPCs and logs successful initialization.

## Error Handling

All RPCs return standardized error responses:

```json
{
  "success": false,
  "error": "Error message description",
  "operation": "operation_name"
}
```

Common error scenarios:
- Invalid JWT format
- Missing required fields
- Storage operation failures
- Missing authentication context

## Future Enhancements

- JWT signature verification with Cognito public keys
- Wallet balance tracking
- Transaction history
- Integration with blockchain wallets
- Multi-signature support for high-value operations
- Rate limiting and abuse prevention

## Support

For issues or questions about the wallet mapping system, refer to:
- Nakama documentation: https://heroiclabs.com/docs
- IntelliVerse X API documentation
- Module source code in `/data/modules/copilot/`
