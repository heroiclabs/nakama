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

### 1. Copilot Module (Advanced Leaderboards & Social)
Located in: `copilot/` directory

**Purpose:** Advanced leaderboard synchronization, aggregate scoring, friend leaderboards, and social features for multi-game ecosystems.

**Leaderboard RPCs:**
- `submit_score_sync` - Submit score to game and global leaderboards
- `submit_score_with_aggregate` - Calculate and update Global Power Rank
- `create_all_leaderboards_with_friends` - Create friend-specific leaderboards
- `submit_score_with_friends_sync` - Submit to regular and friend leaderboards
- `get_friend_leaderboard` - Get leaderboard filtered by friends

**Social RPCs:**
- `send_friend_invite` - Send friend invite with notification
- `accept_friend_invite` - Accept pending friend invite
- `decline_friend_invite` - Decline pending friend invite
- `get_notifications` - Get user notifications

**Wallet RPCs:**
- `get_user_wallet` - Get or create user wallet (Cognito integration)
- `link_wallet_to_game` - Link wallet to specific game
- `get_wallet_registry` - Admin function to view all wallets

**Documentation:**
- `copilot/README.md` - Module overview and API reference
- `copilot/UNITY_INTEGRATION_GUIDE.md` - Complete Unity C# implementation guide
- `copilot/QUICK_REFERENCE.md` - Developer quick reference card
- `copilot/IMPLEMENTATION_STATUS.md` - Feature verification report
- `copilot/SECURITY_SUMMARY.md` - Security features

**Files:**
- `copilot/index.js` - Module initialization and RPC registration
- `copilot/leaderboard_sync.js` - Score synchronization
- `copilot/leaderboard_aggregate.js` - Aggregate scoring
- `copilot/leaderboard_friends.js` - Friend leaderboards
- `copilot/social_features.js` - Social graph and notifications
- `copilot/cognito_wallet_mapper.js` - Wallet mapping
- `copilot/wallet_registry.js` - Wallet storage
- `copilot/wallet_utils.js` - JWT utilities
- `copilot/utils.js` - Shared helper functions

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
| **Copilot Leaderboards** | | |
| `submit_score_sync` | Copilot | Submit score to game & global leaderboards |
| `submit_score_with_aggregate` | Copilot | Calculate Global Power Rank |
| `create_all_leaderboards_with_friends` | Copilot | Create friend leaderboards |
| `submit_score_with_friends_sync` | Copilot | Submit to regular & friend boards |
| `get_friend_leaderboard` | Copilot | Get friend-filtered leaderboard |
| **Copilot Social** | | |
| `send_friend_invite` | Copilot | Send friend invite |
| `accept_friend_invite` | Copilot | Accept friend invite |
| `decline_friend_invite` | Copilot | Decline friend invite |
| `get_notifications` | Copilot | Get user notifications |
| **Copilot Wallet** | | |
| `get_user_wallet` | Copilot | Get or create user wallet |
| `link_wallet_to_game` | Copilot | Link wallet to game |
| `get_wallet_registry` | Copilot | Admin: list all wallets |
| **Base Leaderboards** | | |
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
| `friend_invites` | `{invite_id}` | Friend invite data |

## Deployment

1. Ensure all files are in `/data/modules/` directory
2. Restart Nakama server:
   ```bash
   docker-compose restart nakama
   ```
3. Check logs for successful initialization:
   ```
   [INFO] JavaScript Runtime Initialization Complete
   [INFO] Copilot Leaderboard Modules Loaded Successfully
   [INFO] Total RPCs Registered: 35+ (including Copilot features)
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
- **For Unity Developers (Copilot Features):** [copilot/UNITY_INTEGRATION_GUIDE.md](./copilot/UNITY_INTEGRATION_GUIDE.md)
- **Copilot Module:** [copilot/README.md](./copilot/README.md)
- **Copilot Quick Reference:** [copilot/QUICK_REFERENCE.md](./copilot/QUICK_REFERENCE.md)
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
