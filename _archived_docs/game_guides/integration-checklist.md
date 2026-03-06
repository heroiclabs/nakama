# Unity Developer Integration Checklist

## Prerequisites

- [ ] Unity 2020.3 or later installed
- [ ] Your **Game ID** (UUID) obtained from the platform
- [ ] Nakama server URL and port
- [ ] Server key (default: "defaultkey")

## Step 1: Install Nakama SDK

- [ ] Open Unity Package Manager (Window > Package Manager)
- [ ] Add Nakama package via Git URL: `https://github.com/heroiclabs/nakama-unity.git?path=/Packages/Nakama`
- [ ] Verify package imported successfully
- [ ] Check for any errors in the Console

## Step 2: Configure Nakama Connection

- [ ] Create `NakamaConnection.cs` script
- [ ] Set server host (e.g., "localhost" or "your-server.com")
- [ ] Set server port (default: 7350)
- [ ] Set server key
- [ ] **IMPORTANT**: Set your Game ID: `private const string GameId = "your-game-uuid";`
- [ ] Test connection in Unity Editor

## Step 3: Implement Device ID

- [ ] Create device ID generation system
- [ ] Choose method:
  - [ ] Option A: Use `SystemInfo.deviceUniqueIdentifier`
  - [ ] Option B: Generate custom GUID and store in PlayerPrefs
- [ ] Verify device ID persists between sessions
- [ ] Test on multiple devices/platforms

## Step 4: Implement Authentication

- [ ] Create authentication function using device ID
- [ ] Handle authentication success
- [ ] Handle authentication errors
- [ ] Store session token
- [ ] Test authentication flow

## Step 5: Create or Sync User Identity

- [ ] Create `PlayerIdentity.cs` script
- [ ] Implement `create_or_sync_user` RPC call
- [ ] Collect username from player (UI input or default)
- [ ] Call RPC with:
  - [ ] username
  - [ ] device_id
  - [ ] game_id
- [ ] Handle response and store wallet IDs
- [ ] Test with new user (should return `created: true`)
- [ ] Test with existing user (should return `created: false`)

## Step 6: Implement Wallet System

- [ ] Create `WalletManager.cs` script
- [ ] Implement `create_or_get_wallet` RPC call
- [ ] Display game wallet balance in UI
- [ ] Display global wallet balance in UI
- [ ] Add wallet refresh functionality
- [ ] Test wallet creation
- [ ] Test wallet retrieval

## Step 7: Implement Score Submission

- [ ] Create `ScoreManager.cs` script
- [ ] Implement `submit_score_and_sync` RPC call
- [ ] Call RPC at appropriate time (e.g., end of game)
- [ ] Handle response:
  - [ ] Display updated score
  - [ ] Display updated wallet balance
  - [ ] Log leaderboards updated
- [ ] Test score submission with different values
- [ ] Verify wallet balance updates to match score

## Step 8: Implement Leaderboard Display

- [ ] Create `LeaderboardManager.cs` script
- [ ] Create UI for leaderboard display
- [ ] Implement leaderboard fetching:
  - [ ] Game leaderboard (`leaderboard_<game_id>`)
  - [ ] Daily leaderboard (`leaderboard_<game_id>_daily`)
  - [ ] Weekly leaderboard (`leaderboard_<game_id>_weekly`)
  - [ ] Monthly leaderboard (`leaderboard_<game_id>_monthly`)
  - [ ] Global leaderboard (`leaderboard_global`)
- [ ] Display player rankings
- [ ] Highlight current player
- [ ] Implement leaderboard refresh
- [ ] Add leaderboard type selector (dropdown/tabs)

## Step 9: Implement UI/UX

- [ ] Create main menu scene
- [ ] Create game scene
- [ ] Create leaderboard scene
- [ ] Add username input field
- [ ] Add score display
- [ ] Add wallet balance display
- [ ] Add loading indicators
- [ ] Add error message dialogs
- [ ] Test navigation between scenes

## Step 10: Error Handling

- [ ] Implement try-catch blocks for all RPC calls
- [ ] Display user-friendly error messages
- [ ] Handle network errors
- [ ] Handle "identity not found" error
- [ ] Handle "invalid JSON" error
- [ ] Test offline behavior
- [ ] Add retry mechanisms

## Step 11: Caching and Performance

- [ ] Implement leaderboard caching
- [ ] Implement wallet data caching
- [ ] Set appropriate cache durations
- [ ] Add manual refresh options
- [ ] Test cache invalidation

## Step 12: Testing

### Functional Testing
- [ ] Test user creation (first time)
- [ ] Test user sync (returning user)
- [ ] Test wallet creation
- [ ] Test wallet retrieval
- [ ] Test score submission
- [ ] Test leaderboard display
- [ ] Test different score values
- [ ] Test with multiple players

### Edge Case Testing
- [ ] Test with no internet connection
- [ ] Test with slow internet connection
- [ ] Test with invalid game ID
- [ ] Test with very high scores
- [ ] Test with zero score
- [ ] Test with negative score (should fail)
- [ ] Test rapid consecutive score submissions

### Platform Testing
- [ ] Test on Windows
- [ ] Test on macOS
- [ ] Test on Android
- [ ] Test on iOS
- [ ] Test in Unity Editor
- [ ] Test in build

## Step 13: Integration Validation

### Identity System
- [ ] Verify identity is created on first launch
- [ ] Verify identity is retrieved on subsequent launches
- [ ] Verify wallet IDs are generated correctly
- [ ] Verify username is stored correctly

### Wallet System
- [ ] Verify game wallet balance starts at 0
- [ ] Verify global wallet balance starts at 0
- [ ] Verify game wallet updates after score submission
- [ ] Verify global wallet remains unchanged

### Leaderboard System
- [ ] Verify score appears in game leaderboard
- [ ] Verify score appears in daily leaderboard
- [ ] Verify score appears in weekly leaderboard
- [ ] Verify score appears in monthly leaderboard
- [ ] Verify score appears in all-time leaderboard
- [ ] Verify score appears in global leaderboard
- [ ] Verify correct ranking
- [ ] Verify username displayed correctly

## Step 14: Documentation

- [ ] Document your Game ID
- [ ] Document server configuration
- [ ] Document RPC usage in your codebase
- [ ] Create internal integration guide
- [ ] Document any custom modifications

## Step 15: Production Readiness

### Security
- [ ] Never expose server key in client code (use environment variables)
- [ ] Validate all user inputs
- [ ] Implement rate limiting on client side
- [ ] Use HTTPS in production

### Performance
- [ ] Minimize RPC calls
- [ ] Implement proper caching
- [ ] Use async/await properly
- [ ] Test with large leaderboards (100+ entries)

### Monitoring
- [ ] Add logging for all RPC calls
- [ ] Track RPC success/failure rates
- [ ] Monitor network latency
- [ ] Set up error reporting

## Step 16: Launch Preparation

- [ ] Test with production server
- [ ] Verify all features work in production environment
- [ ] Test with multiple concurrent users
- [ ] Prepare rollback plan
- [ ] Document known issues
- [ ] Prepare support documentation

## Common Issues Checklist

If something isn't working, check:

- [ ] Is Nakama server running and accessible?
- [ ] Is the Game ID correct?
- [ ] Did you call `create_or_sync_user` before other RPCs?
- [ ] Are you using the correct server key?
- [ ] Is the session valid (not expired)?
- [ ] Are you handling async operations correctly?
- [ ] Are you parsing JSON responses correctly?
- [ ] Did leaderboards get created (by admin)?

## Quick Reference

### Initialization Order

1. Initialize Nakama Connection
2. Authenticate with device ID
3. Create/Sync User Identity
4. Load Wallets
5. Load Leaderboards

### RPC Call Order

1. `create_or_sync_user` (always first)
2. `create_or_get_wallet` (after identity exists)
3. `submit_score_and_sync` (after identity exists)

### Required Data for Each RPC

**create_or_sync_user**:
- username
- device_id
- game_id

**create_or_get_wallet**:
- device_id
- game_id

**submit_score_and_sync**:
- score
- device_id
- game_id

## Support Resources

- [Unity Quick Start Guide](./unity/Unity-Quick-Start.md)
- [Identity Documentation](./identity.md)
- [Wallet Documentation](./wallets.md)
- [Leaderboard Documentation](./leaderboards.md)
- [API Reference](./api/README.md)
- [Sample Game Tutorial](./sample-game/README.md)

## Final Verification

Before considering integration complete:

- [ ] All three core RPCs working (identity, wallet, score)
- [ ] All required leaderboards displaying correctly
- [ ] Wallets showing correct balances
- [ ] No console errors during normal flow
- [ ] Tested on at least 2 different devices/platforms
- [ ] Error handling implemented and tested
- [ ] Performance acceptable (<1 second for RPC calls)
- [ ] UI/UX polished and user-friendly
- [ ] Documentation complete
- [ ] Ready for production deployment

## Notes

Use this space to document any custom requirements or modifications:

---
---
---
---
