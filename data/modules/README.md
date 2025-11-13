# Nakama Modules - IntelliVerse X Integration

## Overview

This directory contains all JavaScript runtime modules for the Nakama game server, providing backend services for IntelliVerse X games.

## Main Entry Point

**`index.js`** - The single entry point for all JavaScript runtime modules. This file:
- Initializes all RPC functions
- Loads Copilot wallet mapping modules
- Registers leaderboard creation services
- Provides centralized module management

## Available Features

All features are accessible through RPC (Remote Procedure Call) functions from your game client.

### 1. Wallet Mapping (Cognito Integration)
Located in: `copilot/` directory

**Purpose:** Create a one-to-one mapping between AWS Cognito users and global wallets shared across all IntelliVerse X games.

**RPCs:**
- `get_user_wallet` - Retrieve or create a wallet for a Cognito user
- `link_wallet_to_game` - Link a wallet to a specific game
- `get_wallet_registry` - Admin function to view all wallets

**Files:**
- `copilot/cognito_wallet_mapper.js` - RPC implementations
- `copilot/wallet_registry.js` - Storage operations
- `copilot/wallet_utils.js` - JWT utilities
- `copilot/README.md` - Technical documentation

### 2. Leaderboards
Located in: `index.js` (main entry point)

**Purpose:** Dynamically create and manage leaderboards for all onboarded games in the IntelliVerse ecosystem.

**RPCs:**
- `create_all_leaderboards_persistent` - Creates global and per-game leaderboards

**Documentation:**
- `README_LEADERBOARD_RPC.md` - Leaderboard technical documentation

### 3. Legacy Lua Modules
Various Lua modules for testing and examples:
- `clientrpc.lua` - Test RPC functions
- `leaderboards.lua` - Simple leaderboard implementation
- `tournament.lua` - Tournament callbacks
- `match.lua` - Realtime match handling
- `iap_verifier.lua` - In-app purchase verification
- Additional helper modules

## For Game Developers

📖 **See [NAKAMA_FEATURES_GUIDE.md](./NAKAMA_FEATURES_GUIDE.md)** for complete Unity integration guide with code examples.

The guide includes:
- ✅ Quick setup instructions
- ✅ Complete C# examples for Unity
- ✅ Authentication flows
- ✅ Wallet integration examples
- ✅ Leaderboard usage
- ✅ Error handling best practices
- ✅ Production-ready code templates

## Module Architecture

```
data/modules/
├── index.js                          # Main entry point (ALL RPCs registered here)
├── NAKAMA_FEATURES_GUIDE.md         # Unity developer guide
├── README.md                         # This file
├── README_LEADERBOARD_RPC.md        # Leaderboard technical docs
│
├── copilot/                          # Wallet mapping module
│   ├── cognito_wallet_mapper.js     # RPC implementations
│   ├── wallet_registry.js           # Storage operations
│   ├── wallet_utils.js              # JWT utilities
│   ├── test_wallet_mapping.js       # Test suite
│   └── README.md                    # Technical documentation
│
└── *.lua                             # Legacy Lua modules
```

## Registered RPCs

When Nakama starts, these RPCs are automatically registered:

| RPC Name | Module | Description |
|----------|--------|-------------|
| `get_user_wallet` | Copilot | Get or create user wallet |
| `link_wallet_to_game` | Copilot | Link wallet to game |
| `get_wallet_registry` | Copilot | Admin: list all wallets |
| `create_all_leaderboards_persistent` | Leaderboards | Setup game leaderboards |

## Quick Start for Developers

### 1. Unity Developer
See [NAKAMA_FEATURES_GUIDE.md](./NAKAMA_FEATURES_GUIDE.md) for complete examples.

### 2. Add New RPC Function

To add a new RPC function:

1. Create your function in `index.js`:
```javascript
function myNewRpc(ctx, logger, nk, payload) {
    logger.info('My new RPC called');
    return JSON.stringify({ success: true });
}
```

2. Register it in the `InitModule` function:
```javascript
initializer.registerRpc('my_new_rpc', myNewRpc);
logger.info('Registered RPC: my_new_rpc');
```

3. Restart Nakama to load changes

### 3. Test Your RPC

Using curl:
```bash
curl -X POST "http://127.0.0.1:7350/v2/rpc/my_new_rpc" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Using Unity:
```csharp
var result = await client.RpcAsync(session, "my_new_rpc", "{}");
Debug.Log(result.Payload);
```

## Storage Collections

The modules use these Nakama storage collections:

| Collection | Key | Purpose |
|------------|-----|---------|
| `wallet_registry` | `{user_id}` | User wallet records |
| `leaderboards_registry` | `all_created` | Tracks created leaderboards |

## Deployment

1. Ensure all files are in `/data/modules/` directory
2. Restart Nakama server:
   ```bash
   docker-compose restart nakama
   ```
3. Check logs for successful initialization:
   ```
   [INFO] JavaScript Runtime Initialization Complete
   [INFO] Total RPCs Registered: 4 (3 Wallet + 1 Leaderboard)
   ```

## Development

### Adding New Features
1. Implement RPC function in `index.js` or create new module file
2. Import dependencies at top of `index.js`
3. Register RPC in `InitModule` function
4. Update this README
5. Add examples to `NAKAMA_FEATURES_GUIDE.md`

### Testing
- Use `copilot/test_wallet_mapping.js` as reference for testing patterns
- Test with Nakama console at http://127.0.0.1:7351

## Documentation

- **For Game Developers:** [NAKAMA_FEATURES_GUIDE.md](./NAKAMA_FEATURES_GUIDE.md)
- **Wallet System:** [copilot/README.md](./copilot/README.md)
- **Leaderboards:** [README_LEADERBOARD_RPC.md](./README_LEADERBOARD_RPC.md)
- **Nakama Docs:** https://heroiclabs.com/docs

## Support

For issues or questions:
- Check the documentation in this directory
- Review [Nakama documentation](https://heroiclabs.com/docs)
- Contact IntelliVerse X development team

---

**Last Updated:** 2025-11-13  
**Module Version:** 1.0  
**Nakama Version:** 3.x
