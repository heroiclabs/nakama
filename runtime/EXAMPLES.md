# Runtime Module Examples

This directory contains example client code demonstrating how to use the Cognito Auth + Wallet RPCs.

## JavaScript/TypeScript Example

```typescript
import { Client } from "@heroiclabs/nakama-js";

// Initialize Nakama client
const client = new Client("defaultkey", "localhost", "7350");
client.ssl = false;

// Example 1: Login with Cognito ID token
async function loginWithCognito(cognitoIdToken: string) {
  const response = await client.rpc(null, "rpc_cognito_login", {
    id_token: cognitoIdToken,
    create: true,
    username: "player123"
  });
  
  const token = response.token;
  console.log("Nakama token:", token);
  
  // Create session from token
  const session = nakamajs.Session.restore(token);
  return session;
}

// Example 2: Link Cognito to existing account
async function linkCognitoAccount(session: Session, cognitoIdToken: string) {
  const response = await client.rpc(session, "rpc_link_cognito", {
    id_token: cognitoIdToken
  });
  
  console.log("Linked:", response.linked);
}

// Example 3: Get wallet balances
async function getWallet(session: Session) {
  const response = await client.rpc(session, "rpc_wallet_get", {});
  
  console.log("Wallet:", response.wallet);
  console.log("Gold:", response.wallet.gold || 0);
  console.log("Gems:", response.wallet.gems || 0);
  console.log("Updated at:", response.updated_at);
  
  return response.wallet;
}

// Example 4: Update wallet (reward player)
async function rewardPlayer(session: Session, gold: number, gems: number) {
  const response = await client.rpc(session, "rpc_wallet_update", {
    changes: {
      gold: gold,
      gems: gems
    },
    metadata: {
      reason: "daily_reward",
      timestamp: Date.now()
    }
  });
  
  console.log("New wallet:", response.wallet);
  return response.wallet;
}

// Example 5: Deduct currency (make purchase)
async function makePurchase(session: Session, itemId: string, cost: { gold?: number, gems?: number }) {
  try {
    const changes: any = {};
    if (cost.gold) changes.gold = -cost.gold;
    if (cost.gems) changes.gems = -cost.gems;
    
    const response = await client.rpc(session, "rpc_wallet_update", {
      changes: changes,
      metadata: {
        reason: "shop_purchase",
        item_id: itemId,
        timestamp: Date.now()
      }
    });
    
    console.log("Purchase successful. New wallet:", response.wallet);
    return true;
  } catch (error) {
    if (error.message.includes("insufficient balance")) {
      console.error("Not enough currency!");
      return false;
    }
    throw error;
  }
}

// Example 6: Get transaction history
async function getTransactionHistory(session: Session, limit = 50) {
  const response = await client.rpc(session, "rpc_wallet_ledger", {
    limit: limit,
    cursor: ""
  });
  
  console.log("Transaction history:");
  for (const item of response.items) {
    const date = new Date(item.create_time * 1000);
    console.log(`  ${date.toISOString()}: ${JSON.stringify(item.changes)} - ${item.metadata.reason || 'unknown'}`);
  }
  
  return response;
}

// Full workflow example
async function fullExample() {
  // 1. Get Cognito ID token (from AWS Amplify, AWS SDK, etc.)
  const cognitoIdToken = "eyJraWQiOiI..."; // Your Cognito ID token
  
  // 2. Login with Cognito
  const session = await loginWithCognito(cognitoIdToken);
  
  // 3. Check wallet
  let wallet = await getWallet(session);
  
  // 4. Reward player
  if (wallet.gold === undefined || wallet.gold < 100) {
    await rewardPlayer(session, 500, 10);
  }
  
  // 5. Make a purchase
  const success = await makePurchase(session, "sword_001", { gold: 100 });
  
  if (success) {
    // 6. Get updated wallet
    wallet = await getWallet(session);
    
    // 7. View history
    await getTransactionHistory(session, 10);
  }
}
```

## Unity C# Example

```csharp
using Nakama;
using System;
using System.Collections.Generic;
using UnityEngine;

public class NakamaWalletExample : MonoBehaviour
{
    private IClient client;
    private ISession session;
    
    async void Start()
    {
        // Initialize Nakama client
        client = new Client("http", "localhost", 7350, "defaultkey");
        
        // Example: Login with Cognito
        await LoginWithCognito("your-cognito-id-token");
        
        // Example: Get wallet
        await GetWallet();
        
        // Example: Update wallet
        await UpdateWallet(100, -1);
        
        // Example: Get ledger
        await GetLedger();
    }
    
    async System.Threading.Tasks.Task LoginWithCognito(string cognitoIdToken)
    {
        var payload = new Dictionary<string, object>
        {
            ["id_token"] = cognitoIdToken,
            ["create"] = true,
            ["username"] = "player123"
        };
        
        var response = await client.RpcAsync(session, "rpc_cognito_login", JsonUtility.ToJson(payload));
        var loginResponse = JsonUtility.FromJson<LoginResponse>(response.Payload);
        
        // Restore session from token
        session = Session.Restore(loginResponse.token);
        
        Debug.Log($"Logged in! Token: {loginResponse.token}");
    }
    
    async System.Threading.Tasks.Task GetWallet()
    {
        var response = await client.RpcAsync(session, "rpc_wallet_get", "{}");
        var walletResponse = JsonUtility.FromJson<WalletGetResponse>(response.Payload);
        
        Debug.Log($"Gold: {walletResponse.wallet.gold}, Gems: {walletResponse.wallet.gems}");
    }
    
    async System.Threading.Tasks.Task UpdateWallet(int goldChange, int gemsChange)
    {
        var payload = new Dictionary<string, object>
        {
            ["changes"] = new Dictionary<string, int>
            {
                ["gold"] = goldChange,
                ["gems"] = gemsChange
            },
            ["metadata"] = new Dictionary<string, object>
            {
                ["reason"] = "test_update",
                ["timestamp"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
            }
        };
        
        var response = await client.RpcAsync(session, "rpc_wallet_update", JsonUtility.ToJson(payload));
        var updateResponse = JsonUtility.FromJson<WalletUpdateResponse>(response.Payload);
        
        Debug.Log($"Updated wallet - Gold: {updateResponse.wallet.gold}, Gems: {updateResponse.wallet.gems}");
    }
    
    async System.Threading.Tasks.Task GetLedger()
    {
        var payload = new Dictionary<string, object>
        {
            ["limit"] = 25,
            ["cursor"] = ""
        };
        
        var response = await client.RpcAsync(session, "rpc_wallet_ledger", JsonUtility.ToJson(payload));
        var ledgerResponse = JsonUtility.FromJson<WalletLedgerResponse>(response.Payload);
        
        foreach (var item in ledgerResponse.items)
        {
            Debug.Log($"Transaction: {item.changes}, Reason: {item.metadata["reason"]}, Time: {item.create_time}");
        }
    }
}

[Serializable]
public class LoginResponse
{
    public string token;
}

[Serializable]
public class WalletGetResponse
{
    public Dictionary<string, int> wallet;
    public long updated_at;
}

[Serializable]
public class WalletUpdateResponse
{
    public Dictionary<string, int> wallet;
    public long updated_at;
}

[Serializable]
public class WalletLedgerResponse
{
    public List<WalletLedgerItem> items;
    public string cursor;
}

[Serializable]
public class WalletLedgerItem
{
    public Dictionary<string, int> changes;
    public Dictionary<string, object> metadata;
    public long create_time;
}
```

## Python Example

```python
import asyncio
from nakama import Client
import json

async def main():
    # Initialize client
    client = Client("defaultkey", "localhost", 7350, ssl=False)
    
    # Login with Cognito
    payload = {
        "id_token": "your-cognito-id-token",
        "create": True,
        "username": "player123"
    }
    
    response = await client.rpc_async(None, "rpc_cognito_login", json.dumps(payload))
    login_data = json.loads(response.payload)
    token = login_data["token"]
    
    # Create session
    session = await client.authenticate_custom_async(token, create=False)
    
    # Get wallet
    response = await client.rpc_async(session, "rpc_wallet_get", "{}")
    wallet_data = json.loads(response.payload)
    print(f"Wallet: {wallet_data['wallet']}")
    
    # Update wallet
    update_payload = {
        "changes": {"gold": 100, "gems": -1},
        "metadata": {"reason": "daily_login"}
    }
    response = await client.rpc_async(session, "rpc_wallet_update", json.dumps(update_payload))
    updated = json.loads(response.payload)
    print(f"New wallet: {updated['wallet']}")
    
    # Get ledger
    ledger_payload = {"limit": 25, "cursor": ""}
    response = await client.rpc_async(session, "rpc_wallet_ledger", json.dumps(ledger_payload))
    ledger = json.loads(response.payload)
    
    for item in ledger["items"]:
        print(f"Transaction: {item['changes']} - {item['metadata'].get('reason', 'unknown')}")

if __name__ == "__main__":
    asyncio.run(main())
```

## Testing with cURL

For quick testing without a client SDK:

```bash
# 1. Login (get session token)
curl -X POST http://localhost:7350/v2/rpc/rpc_cognito_login \
  -H "Content-Type: application/json" \
  -d '{
    "id_token": "your-cognito-id-token",
    "create": true,
    "username": "testuser"
  }'

# Response: {"token": "nakama-session-token"}

# 2. Get wallet (requires session token from step 1)
curl -X POST http://localhost:7350/v2/rpc/rpc_wallet_get \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_NAKAMA_SESSION_TOKEN" \
  -d '{}'

# 3. Update wallet
curl -X POST http://localhost:7350/v2/rpc/rpc_wallet_update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_NAKAMA_SESSION_TOKEN" \
  -d '{
    "changes": {"gold": 100, "gems": 5},
    "metadata": {"reason": "test_reward"}
  }'

# 4. Get ledger
curl -X POST http://localhost:7350/v2/rpc/rpc_wallet_ledger \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_NAKAMA_SESSION_TOKEN" \
  -d '{
    "limit": 10,
    "cursor": ""
  }'
```

## AWS Cognito Setup

1. Create a Cognito User Pool
2. Create an App Client (note the Client ID)
3. Configure your app to authenticate with Cognito
4. Use the ID token from Cognito authentication

```javascript
// Example: Getting Cognito ID token with AWS Amplify
import { Auth } from 'aws-amplify';

const user = await Auth.signIn(username, password);
const idToken = user.signInUserSession.idToken.jwtToken;

// Now use idToken with rpc_cognito_login
```

## Error Handling

Common errors and how to handle them:

```typescript
try {
  const response = await client.rpc(session, "rpc_wallet_update", payload);
} catch (error) {
  if (error.message.includes("insufficient balance")) {
    console.error("Not enough currency to complete this action");
    // Show UI message to user
  } else if (error.message.includes("unauthorized")) {
    console.error("Session expired, please login again");
    // Redirect to login
  } else {
    console.error("Unexpected error:", error.message);
    // Log for debugging
  }
}
```
