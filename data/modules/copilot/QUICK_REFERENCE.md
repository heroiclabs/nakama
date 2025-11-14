# Copilot Module - Quick Reference Card

## 🚀 RPC Quick Reference

### Score Submission

```javascript
// Basic score sync (game + global)
await client.rpc(session, "submit_score_sync", JSON.stringify({
  gameId: "your-game-id",
  score: 4200
}));

// Aggregate score (includes power rank calculation)
await client.rpc(session, "submit_score_with_aggregate", JSON.stringify({
  gameId: "your-game-id",
  score: 4200
}));

// Submit to friend leaderboards too
await client.rpc(session, "submit_score_with_friends_sync", JSON.stringify({
  gameId: "your-game-id",
  score: 4200
}));
```

### Leaderboards

```javascript
// Get friend leaderboard
await client.rpc(session, "get_friend_leaderboard", JSON.stringify({
  leaderboardId: "leaderboard_your-game-id",
  limit: 50
}));

// Create friend leaderboards (admin/setup)
await client.rpc(session, "create_all_leaderboards_with_friends", "{}");
```

### Social Features

```javascript
// Send friend invite
await client.rpc(session, "send_friend_invite", JSON.stringify({
  targetUserId: "friend-uuid",
  message: "Let's play together!"
}));

// Accept invite
await client.rpc(session, "accept_friend_invite", JSON.stringify({
  inviteId: "invite-uuid"
}));

// Decline invite
await client.rpc(session, "decline_friend_invite", JSON.stringify({
  inviteId: "invite-uuid"
}));

// Get notifications
await client.rpc(session, "get_notifications", JSON.stringify({
  limit: 20
}));
```

---

## 📋 Response Formats

### submit_score_sync
```json
{
  "success": true,
  "gameId": "abc-123",
  "score": 4200,
  "userId": "user-uuid",
  "submittedAt": "2025-11-14T01:00:00.000Z"
}
```

### submit_score_with_aggregate
```json
{
  "success": true,
  "gameId": "abc-123",
  "individualScore": 4200,
  "aggregateScore": 12500,
  "leaderboardsProcessed": 3
}
```

### get_friend_leaderboard
```json
{
  "success": true,
  "leaderboardId": "leaderboard_abc-123",
  "records": [
    {
      "ownerId": "user-uuid",
      "username": "player1",
      "score": 5000,
      "rank": 1
    }
  ],
  "totalFriends": 10
}
```

---

## 🔗 Leaderboard IDs

| Type | Format | Example |
|------|--------|---------|
| Per-game | `leaderboard_{gameId}` | `leaderboard_abc-123` |
| Global | `leaderboard_global` | `leaderboard_global` |
| Friends per-game | `leaderboard_friends_{gameId}` | `leaderboard_friends_abc-123` |
| Friends global | `leaderboard_friends_global` | `leaderboard_friends_global` |

---

## ⚡ Common Patterns

### Complete Score Flow
```javascript
// 1. Submit score with aggregate
const scoreRes = await client.rpc(session, "submit_score_with_aggregate", 
  JSON.stringify({ gameId: gameId, score: finalScore }));

// 2. Also sync to friend leaderboards
await client.rpc(session, "submit_score_with_friends_sync",
  JSON.stringify({ gameId: gameId, score: finalScore }));

// 3. Show power rank to player
console.log(`Power Rank: ${scoreRes.aggregateScore}`);
```

### Friend Leaderboard Display
```javascript
// 1. Get friend leaderboard
const friendBoard = await client.rpc(session, "get_friend_leaderboard",
  JSON.stringify({ leaderboardId: `leaderboard_${gameId}`, limit: 50 }));

// 2. Display to player
friendBoard.records.forEach(record => {
  console.log(`#${record.rank} ${record.username}: ${record.score}`);
});
```

### Social Workflow
```javascript
// 1. Send invite
const invite = await client.rpc(session, "send_friend_invite",
  JSON.stringify({ targetUserId: friendId, message: "Join me!" }));

// 2. Friend accepts (on their client)
await client.rpc(session, "accept_friend_invite",
  JSON.stringify({ inviteId: invite.inviteId }));

// 3. Both can now see each other on friend leaderboards
```

---

## 🛠️ Unity C# Snippets

### Basic Setup
```csharp
// Initialize
var client = new Client("http", "127.0.0.1", 7350, "defaultkey");
var session = await client.AuthenticateDeviceAsync(SystemInfo.deviceUniqueIdentifier);

// Submit score
var payload = new { gameId = "your-game-id", score = 4200 };
var result = await client.RpcAsync(session, "submit_score_sync", 
  JsonUtility.ToJson(payload));
```

### With Error Handling
```csharp
try 
{
    var result = await client.RpcAsync(session, "submit_score_with_aggregate",
        JsonUtility.ToJson(new { gameId = gameId, score = score }));
    
    var response = JsonUtility.FromJson<AggregateResponse>(result.Payload);
    Debug.Log($"Power Rank: {response.aggregateScore}");
}
catch (ApiResponseException ex)
{
    Debug.LogError($"Score submission failed: {ex.Message}");
}
```

---

## 📖 Documentation Links

| Document | Purpose |
|----------|---------|
| [README.md](README.md) | Overview and API reference |
| [UNITY_INTEGRATION_GUIDE.md](UNITY_INTEGRATION_GUIDE.md) | Complete Unity implementation guide |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | Feature implementation status |
| [SECURITY_SUMMARY.md](SECURITY_SUMMARY.md) | Security features and practices |

---

## 🔍 Troubleshooting Quick Fixes

| Issue | Solution |
|-------|----------|
| "Authentication required" | Session expired - refresh or re-authenticate |
| Empty friend leaderboard | Add friends first, friends need scores |
| Aggregate is 0 | Submit scores to at least one game first |
| RPC not found | Check server logs, ensure module loaded |
| Invalid payload | Check JSON structure matches examples |

---

## 💡 Pro Tips

1. **Cache friend lists** - Don't query on every leaderboard load
2. **Batch operations** - Use `Task.WhenAll()` for parallel requests
3. **Show loading states** - Async operations can take time
4. **Handle errors gracefully** - Always try/catch RPC calls
5. **Use aggregate for rankings** - Shows player's total ecosystem performance
6. **Limit leaderboard queries** - Use pagination (50-100 items max)
7. **Test locally first** - Use docker-compose for local Nakama instance

---

## 🎯 Most Common Use Cases

### 1. Submit Score After Game
```javascript
await client.rpc(session, "submit_score_with_aggregate", 
  JSON.stringify({ gameId: gameId, score: finalScore }));
```

### 2. Show Friend Rankings
```javascript
const board = await client.rpc(session, "get_friend_leaderboard",
  JSON.stringify({ leaderboardId: `leaderboard_${gameId}`, limit: 50 }));
```

### 3. Social Integration
```javascript
// Send invite
await client.rpc(session, "send_friend_invite",
  JSON.stringify({ targetUserId: userId, message: msg }));

// Check notifications
const notifs = await client.rpc(session, "get_notifications",
  JSON.stringify({ limit: 20 }));
```

---

**Quick Access**: Keep this card handy for rapid development!

**Last Updated**: 2025-11-14  
**Version**: 1.0.0
