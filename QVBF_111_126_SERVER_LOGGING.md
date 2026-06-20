# QVBF_111 & QVBF_126 Server-Side Logging Guide

## Overview
Comprehensive logging has been added to `groups.js` to diagnose group joining bugs (QVBF_111 and QVBF_126).

## Log Prefix
All logs use: `[socialzone-group]` with bug ID: `QVBF_111/126`

## Modified Functions

### 1. rpcCreateQuizverseGroup (lines 215-378)
**Purpose:** Handle group creation with coin charging

**Key Logs:**
- Entry: `🔍 CreateQuizverseGroup RPC called | userID=... | payload=...`
- Validation: `❌ Missing group name | userID=...`
- Balance: `💰 Coin balance check | balance=... | required=500`
- Charge: `✅ Coins charged | amount=500 | newBalance=...`
- Creation: `✅ Group created successfully | groupID=... | memberCount=...`
- Refund: `✅ Coins refunded | userID=... | amount=500` (on failure)

---

### 2. groupAfterJoinHook (lines 1613-1642)
**Purpose:** Hook that fires after user joins a group

**Key Logs:**
- Success: `✅ User joined group | userID=... | groupID=...`
- Group Info: `📋 Group info after join | name=... | memberCount=... | maxCount=...`
- Notification Start: `📡 Sending sync notification | userID=... | groupID=...`
- Notification Done: `✅ Sync notification sent | userID=... | groupID=...`

---

### 3. groupAfterLeaveHook (lines 1648-1674)
**Purpose:** Hook that fires after user leaves a group

**Key Logs:**
- Success: `✅ User left group | userID=... | groupID=...`
- Notification: `✅ Leave sync notification sent | userID=... | groupID=...`

---

### 4. rpcGetUserGroups (lines 741-819)
**Purpose:** Fetch all groups for a user

**Key Logs:**
- Entry: `🔍 GetUserGroups RPC called | userID=... | payload=...`
- Data Fetch: `📡 userGroupsList returned | userID=... | rawCount=3`
- Per Group: `📋 Group[0] | groupID=... | name=... | state=2 | edgeCount=5`
- Return: `✅ GetUserGroups returning | userID=... | count=3 | gameIdFilter=quizverse`

---

### 5. sendGroupSyncNotification (lines 1531-1610)
**Purpose:** Send real-time notification to user about group membership change

**Key Logs:**
- Entry: `📡 sendGroupSyncNotification called | subjectKey=GROUP_JOINED | userID=...`
- Content: `📋 Notification content | code=500 | subject=group_joined | title=Group Joined`
- Success: `✅ Notification sent successfully | code=500 | userID=... | groupID=...`
- Failure: `❌ sendGroupSyncNotification failed | error=...`

---

## Notification Codes

### GROUP_JOINED (Code 500)
- Sent when user joins a group
- Self-notification (sender = recipient)
- Non-persistent (real-time only)
- Subject: `group_joined`

### GROUP_LEFT (Code 501)
- Sent when user leaves a group
- Self-notification (sender = recipient)
- Non-persistent (real-time only)
- Subject: `group_left`

---

## Docker Log Commands

### Real-Time Monitoring
```bash
# All group operations
docker logs -f nakama-container 2>&1 | grep --line-buffered "\[socialzone-group\]"

# Only QVBF_111/126 related
docker logs -f nakama-container 2>&1 | grep --line-buffered "QVBF_111"

# Only successful operations
docker logs -f nakama-container 2>&1 | grep --line-buffered "✅"

# Only errors
docker logs -f nakama-container 2>&1 | grep --line-buffered "❌"
```

### Historical Logs
```bash
# Last 100 lines with group operations
docker logs --tail 100 nakama-container 2>&1 | grep "\[socialzone-group\]"

# Specific user
docker logs nakama-container 2>&1 | grep "userID=abc-123-def"

# Specific group
docker logs nakama-container 2>&1 | grep "groupID=xyz-789"

# Join operations only
docker logs nakama-container 2>&1 | grep "\[socialzone-group\].*joined"

# Create operations only
docker logs nakama-container 2>&1 | grep "\[socialzone-group\].*CreateQuizverseGroup"
```

### Save to File
```bash
# Save all group logs to file
docker logs nakama-container 2>&1 | grep "\[socialzone-group\]" > group_operations.log

# Save with timestamps
docker logs --timestamps nakama-container 2>&1 | grep "\[socialzone-group\]" > group_operations_with_time.log
```

---

## Expected Flow: Create Group

### 1. User Clicks "Create Group"
**Client → Server: CreateQuizverseGroup RPC**

### 2. Server Processes Request
```
[socialzone-group] 🔍 QVBF_111/126 - CreateQuizverseGroup RPC called | userID=abc123 | payload={"name":"TestGroup","badge":"badge_star",...} | timestamp=1715000000000
[socialzone-group] 📋 QVBF_111/126 - Parsed request | name=TestGroup | badge=badge_star | maxMembers=100 | joinPolicy=open
[socialzone-group] 💰 QVBF_111/126 - Coin balance check | userID=abc123 | balance=1000 | required=500
[socialzone-group] ✅ QVBF_111/126 - Coins charged | userID=abc123 | amount=500 | newBalance=500
[socialzone-group] 🔨 QVBF_111/126 - Creating group | userID=abc123 | name=TestGroup | badge=badge_star
[socialzone-group] ✅ QVBF_111/126 - Group created successfully | groupID=xyz789 | creatorID=abc123 | name=TestGroup | edgeCount=1 | timestamp=1715000001000
```

### 3. Creator is Auto-Joined (Triggers Join Hook)
```
[socialzone-group] ✅ QVBF_111/126 - User joined group | userID=abc123 | groupID=xyz789 | timestamp=1715000001100
[socialzone-group] 📋 QVBF_111/126 - Group info after join | groupID=xyz789 | name=TestGroup | memberCount=1 | maxCount=100
[socialzone-group] 📡 QVBF_111/126 - Sending sync notification | userID=abc123 | groupID=xyz789
[socialzone-group] 📡 QVBF_111/126 - sendGroupSyncNotification called | subjectKey=GROUP_JOINED | userID=abc123 | groupID=xyz789
[socialzone-group] ✅ QVBF_111/126 - Notification sent successfully | code=500 | userID=abc123 | groupID=xyz789
[socialzone-group] ✅ QVBF_111/126 - Sync notification sent | userID=abc123 | groupID=xyz789
```

---

## Expected Flow: Join Existing Group

### 1. User Clicks "Join" on Group
**Client → Server: Nakama's Built-in JoinGroup RPC**

### 2. Join Hook Fires (After Successful Join)
```
[socialzone-group] ✅ QVBF_111/126 - User joined group | userID=def456 | groupID=xyz789 | timestamp=1715000002000
[socialzone-group] 📋 QVBF_111/126 - Group info after join | groupID=xyz789 | name=TestGroup | memberCount=2 | maxCount=100
[socialzone-group] 📡 QVBF_111/126 - Sending sync notification | userID=def456 | groupID=xyz789
[socialzone-group] 📡 QVBF_111/126 - sendGroupSyncNotification called | subjectKey=GROUP_JOINED | userID=def456 | groupID=xyz789
[socialzone-group] ✅ QVBF_111/126 - Notification sent successfully | code=500 | userID=def456 | groupID=xyz789
[socialzone-group] ✅ QVBF_111/126 - Sync notification sent | userID=def456 | groupID=xyz789
```

---

## Expected Flow: View My Groups

### 1. User Opens "My Groups" Screen
**Client → Server: get_user_groups RPC**

### 2. Server Fetches and Returns Data
```
[socialzone-group] 🔍 QVBF_111/126 - GetUserGroups RPC called | userID=abc123 | payload={"gameId":"quizverse"} | timestamp=1715000003000
[socialzone-group] 📡 QVBF_111/126 - userGroupsList returned | userID=abc123 | rawCount=3
[socialzone-group] 📋 QVBF_111/126 - Group[0] | groupID=xyz789 | name=TestGroup | state=0 | edgeCount=2
[socialzone-group] 📋 QVBF_111/126 - Group[1] | groupID=aaa111 | name=OtherGroup | state=2 | edgeCount=15
[socialzone-group] 📋 QVBF_111/126 - Group[2] | groupID=bbb222 | name=MyGuild | state=1 | edgeCount=7
[socialzone-group] ✅ QVBF_111/126 - GetUserGroups returning | userID=abc123 | count=3 | gameIdFilter=quizverse | timestamp=1715000003200
```

**Note:** `state` indicates role:
- 0 = Owner
- 1 = Admin
- 2 = Member
- 3 = Join request pending

---

## Troubleshooting

### Issue: "Group created but not showing in My Groups"

#### Check Create Logs:
```bash
docker logs nakama-container 2>&1 | grep "CreateQuizverseGroup.*groupID="
```
**Expected:** Should see `✅ Group created successfully | groupID=xyz789`

#### Check Join Hook Logs:
```bash
docker logs nakama-container 2>&1 | grep "User joined group.*groupID=xyz789"
```
**Expected:** Should see join hook firing with notification sent

#### Check GetUserGroups Logs:
```bash
docker logs nakama-container 2>&1 | grep "GetUserGroups.*userID=YOUR_USER_ID"
```
**Expected:** Should see the new group in the returned list

---

### Issue: "Joined group but not receiving notification"

#### Check Join Hook:
```bash
docker logs nakama-container 2>&1 | grep "groupAfterJoinHook"
```
**Expected:** `✅ User joined group` followed by `✅ Sync notification sent`

#### Check Notification Send:
```bash
docker logs nakama-container 2>&1 | grep "sendGroupSyncNotification.*GROUP_JOINED"
```
**Expected:** `✅ Notification sent successfully | code=500`

**If Missing:** Server notification system may be down OR client not listening

---

### Issue: "Server returns wrong group count"

#### Check userGroupsList Call:
```bash
docker logs nakama-container 2>&1 | grep "userGroupsList returned.*userID=YOUR_USER_ID"
```
**Compare:** `rawCount` vs expected count

**If Mismatch:** Database issue - join didn't persist OR replication lag

---

### Issue: "Coins charged but group creation failed"

#### Check for Refund:
```bash
docker logs nakama-container 2>&1 | grep "Coins refunded.*userID=YOUR_USER_ID"
```
**Expected:** Should see refund log if creation failed after charge

**If Missing Refund:** 🚨 CRITICAL ERROR - contact admin to manually refund

---

## Deployment

### 1. Rebuild Nakama Server
```bash
cd /path/to/nakama
docker-compose build nakama
docker-compose restart nakama
```

### 2. Verify Logs Are Working
```bash
# Trigger a create or join operation from Unity client

# Check logs appear
docker logs --tail 50 -f nakama-container 2>&1 | grep "\[socialzone-group\]"
```

### 3. If Logs Don't Appear
- Check if `groups.js` is being loaded: `docker logs nakama-container 2>&1 | grep "groups.js"`
- Check for JS syntax errors: `docker logs nakama-container 2>&1 | grep "SyntaxError"`
- Verify file is in correct location: `docker exec nakama-container ls -l /nakama/data/modules/groups/`

---

## File Location
`C:\Office\Backend\nakama\data\modules\groups\groups.js`

## Related Files
- Unity Client: `Assets\_QuizVerse\Scripts\SocialZone\GroupsNakamaService.cs`
- Complete Guide: `Assets\_QuizVerse\QVBF_111_126_LOGGING_COMPLETE.md`
