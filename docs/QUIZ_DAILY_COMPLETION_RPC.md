# Quiz Daily Completion RPC

## Overview

The `quiz_check_daily_completion` RPC checks if a user has completed a quiz for a specific game mode (DailyChallenge or DailyPremiumQuiz) on the current day. This is useful for:

- Checking if a user can claim daily rewards
- Determining if a daily quiz is available
- Validating daily streak eligibility
- UI state management (showing/hiding daily quiz buttons)

---

## RPC Details

**RPC Name:** `quiz_check_daily_completion`  
**File:** `nakama/data/modules/index.js` (line 4820)  
**Module:** Quiz Results System

---

## Request Payload

```json
{
  "gameMode": "DailyChallenge"
}
```

**OR with optional gameId:**

```json
{
  "gameMode": "DailyChallenge",
  "gameId": "33b245c8-a23f-4f9c-a06e-189885cc22a1"
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `gameMode` | string | Must be `"DailyChallenge"` or `"DailyPremiumQuiz"` |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `gameId` | string (UUID) | If provided, only checks that specific game's results. If omitted, checks across all games for the user |

---

## Response

### Success Response

```json
{
  "success": true,
  "completed": true,
  "gameMode": "DailyChallenge",
  "date": "2025-01-15"
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` on success |
| `completed` | boolean | `true` if user completed the quiz today, `false` otherwise |
| `gameMode` | string | The game mode that was checked |
| `date` | string | Current date in YYYY-MM-DD format (UTC) |

### Error Response

```json
{
  "success": false,
  "error": "Missing required fields: gameMode",
  "completed": false
}
```

---

## How It Works

1. **Validates Input:**
   - Verifies `gameMode` is either `"DailyChallenge"` or `"DailyPremiumQuiz"`
   - Validates `gameId` (if provided) is a valid UUID
   - Ensures user is authenticated (uses `ctx.userId` from session)

2. **Calculates Date Range:**
   - Gets today's start timestamp (00:00:00 UTC)
   - Calculates end of day (24 hours later)

3. **Queries Quiz Results (User-Based):**
   - **If `gameId` is provided:** Queries `quiz_results_{gameId}` collection for the user
   - **If `gameId` is omitted:** Queries `transaction_logs` collection which stores all quiz results across all games
   - Filters by `gameMode`
   - Checks if any result's `timestamp` falls within today's range

4. **Returns Result:**
   - `completed: true` if a matching result is found for today
   - `completed: false` otherwise

**Note:** The RPC is user-based - it automatically uses the authenticated user's UUID (`ctx.userId`) from the session, so you don't need to pass it in the payload.

---

## Usage Examples

### Unity C# Example

```csharp
using System;
using System.Threading.Tasks;
using Nakama;

public async Task<bool> CheckDailyQuizCompletion(IClient client, ISession session, string gameMode, string gameId = null)
{
    try
    {
        var payload = new Dictionary<string, object>
        {
            { "gameMode", gameMode }
        };
        
        // gameId is optional - only include if provided
        if (!string.IsNullOrEmpty(gameId))
        {
            payload["gameId"] = gameId;
        }
        
        var jsonPayload = JsonConvert.SerializeObject(payload);
        var result = await client.RpcAsync(session, "quiz_check_daily_completion", jsonPayload);
        
        var response = JsonConvert.DeserializeObject<DailyCompletionResponse>(result.Payload);
        
        if (response.success)
        {
            Debug.Log($"Daily quiz completed: {response.completed} for {response.gameMode} on {response.date}");
            return response.completed;
        }
        else
        {
            Debug.LogError($"Error checking daily completion: {response.error}");
            return false;
        }
    }
    catch (Exception ex)
    {
        Debug.LogError($"Failed to check daily completion: {ex.Message}");
        return false;
    }
}

[Serializable]
public class DailyCompletionResponse
{
    public bool success;
    public bool completed;
    public string gameMode;
    public string date;
    public string error;
}

// Usage (without gameId - checks across all games)
var isCompleted = await CheckDailyQuizCompletion(
    client, 
    session, 
    "DailyChallenge"
);

// OR with gameId (only checks that specific game)
var isCompleted = await CheckDailyQuizCompletion(
    client, 
    session, 
    "DailyChallenge",
    "33b245c8-a23f-4f9c-a06e-189885cc22a1"
);

if (isCompleted)
{
    // User already completed today's daily quiz
    dailyQuizButton.interactable = false;
    dailyQuizButton.GetComponentInChildren<Text>().text = "Completed ✓";
}
else
{
    // User can still play today's daily quiz
    dailyQuizButton.interactable = true;
    dailyQuizButton.GetComponentInChildren<Text>().text = "Play Daily Quiz";
}
```

### JavaScript/TypeScript Example

```typescript
interface DailyCompletionPayload {
  gameId: string;
  gameMode: "DailyChallenge" | "DailyPremiumQuiz";
}

interface DailyCompletionResponse {
  success: boolean;
  completed: boolean;
  gameMode: string;
  date: string;
  error?: string;
}

async function checkDailyQuizCompletion(
  client: Client,
  session: Session,
  gameMode: "DailyChallenge" | "DailyPremiumQuiz",
  gameId?: string
): Promise<boolean> {
  try {
    const payload: DailyCompletionPayload = {
      gameMode
    };
    
    // gameId is optional - only include if provided
    if (gameId) {
      payload.gameId = gameId;
    }
    
    const result = await client.rpc(session, "quiz_check_daily_completion", JSON.stringify(payload));
    const response: DailyCompletionResponse = JSON.parse(result.payload);
    
    if (response.success) {
      console.log(`Daily quiz completed: ${response.completed} for ${response.gameMode} on ${response.date}`);
      return response.completed;
    } else {
      console.error(`Error checking daily completion: ${response.error}`);
      return false;
    }
  } catch (error) {
    console.error(`Failed to check daily completion:`, error);
    return false;
  }
}

// Usage (without gameId - checks across all games)
const isCompleted = await checkDailyQuizCompletion(
  client,
  session,
  "DailyChallenge"
);

// OR with gameId (only checks that specific game)
const isCompleted = await checkDailyQuizCompletion(
  client,
  session,
  "DailyChallenge",
  "33b245c8-a23f-4f9c-a06e-189885cc22a1"
);

if (isCompleted) {
  // User already completed today's daily quiz
  dailyQuizButton.disabled = true;
  dailyQuizButton.textContent = "Completed ✓";
} else {
  // User can still play today's daily quiz
  dailyQuizButton.disabled = false;
  dailyQuizButton.textContent = "Play Daily Quiz";
}
```

---

## Integration with Daily Rewards

This RPC can be used in conjunction with the daily rewards system:

```csharp
// Check if user completed daily quiz before allowing reward claim
var dailyQuizCompleted = await CheckDailyQuizCompletion(client, session, gameId, "DailyChallenge");
var canClaimReward = dailyQuizCompleted && !hasClaimedRewardToday;

if (canClaimReward)
{
    // Show claim button
    claimRewardButton.interactable = true;
}
else if (!dailyQuizCompleted)
{
    // Show message: "Complete today's daily quiz to claim reward"
    rewardMessage.text = "Complete today's daily quiz first!";
}
else
{
    // Already claimed
    claimRewardButton.interactable = false;
    rewardMessage.text = "Reward already claimed today";
}
```

---

## Performance Considerations

- **Efficient Querying:** The RPC only checks the last 100 quiz results, which is sufficient for daily checks
- **Caching:** Consider caching the result client-side for a few minutes to reduce RPC calls
- **Rate Limiting:** This RPC is lightweight and can be called frequently without performance impact

---

## Error Handling

Common errors and how to handle them:

| Error | Cause | Solution |
|-------|-------|----------|
| `"Invalid JSON payload"` | Malformed JSON | Ensure payload is valid JSON |
| `"Missing required fields: gameMode"` | Missing `gameMode` | Include `gameMode` in payload |
| `"Invalid gameId UUID format"` | Invalid UUID (if provided) | Use a valid UUID format or omit `gameId` |
| `"Invalid gameMode"` | Wrong game mode | Use `"DailyChallenge"` or `"DailyPremiumQuiz"` |
| `"User not authenticated"` | No session | Ensure user is logged in (user UUID is automatically extracted from session) |

---

## Testing

### Test Case 1: User Has Completed Today (Without gameId)
```json
// Request
{
  "gameMode": "DailyChallenge"
}

// Expected Response
{
  "success": true,
  "completed": true,
  "gameMode": "DailyChallenge",
  "date": "2025-01-15"
}
```

### Test Case 2: User Has Not Completed Today
```json
// Request
{
  "gameMode": "DailyChallenge"
}

// Expected Response
{
  "success": true,
  "completed": false,
  "gameMode": "DailyChallenge",
  "date": "2025-01-15"
}
```

### Test Case 3: Invalid Game Mode
```json
// Request
{
  "gameMode": "QuickPlay"
}

// Expected Response
{
  "success": false,
  "error": "Invalid gameMode. Must be 'DailyChallenge' or 'DailyPremiumQuiz'",
  "completed": false
}
```

---

## Related RPCs

- **`quiz_submit_result`** - Submit quiz results (creates the data this RPC checks)
- **`quiz_get_history`** - Get user's quiz history
- **`quiz_get_stats`** - Get user's aggregate quiz statistics
- **`daily_rewards_claim`** - Claim daily rewards (may use this RPC to validate eligibility)

---

## Implementation Notes

- **User-Based:** Automatically uses the authenticated user's UUID from the session (`ctx.userId`)
- **Date Calculation:** Uses UTC timezone for consistency across regions
- **Storage Collections:**
  - If `gameId` provided: Queries `quiz_results_{gameId}` collection
  - If `gameId` omitted: Queries `transaction_logs` collection (stores all quiz results across games)
- **Timestamp Format:** Quiz results store `timestamp` as Unix timestamp (seconds)
- **Performance:** 
  - With `gameId`: Checks last 100 results
  - Without `gameId`: Checks up to 1000 transaction logs
- **Flexibility:** Can check a specific game or all games for the user

---

**Last Updated:** 2025-01-15  
**Version:** 1.0.0
