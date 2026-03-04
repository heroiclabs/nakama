#!/bin/bash

# test_rpcs.sh - Test script for all Copilot Leaderboard RPCs
# Usage: ./test_rpcs.sh <auth_token>
#
# Example:
#   ./test_rpcs.sh "your_bearer_token_here"

set -e

# Configuration
NAKAMA_URL="${NAKAMA_URL:-http://127.0.0.1:7350}"
AUTH_TOKEN="${1:-}"

if [ -z "$AUTH_TOKEN" ]; then
    echo "Usage: $0 <auth_token>"
    echo "Please provide a valid authentication token"
    exit 1
fi

echo "=========================================="
echo "Testing Copilot Leaderboard RPCs"
echo "Nakama URL: $NAKAMA_URL"
echo "=========================================="
echo ""

# Test 1: submit_score_sync
echo "Test 1: submit_score_sync"
echo "--------------------------------------"
curl -X POST "$NAKAMA_URL/v2/rpc/submit_score_sync" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"test_game","score":4200}' \
  -w "\nStatus: %{http_code}\n" \
  -s | jq '.' || echo "Request failed"
echo ""

# Test 2: submit_score_with_aggregate
echo "Test 2: submit_score_with_aggregate"
echo "--------------------------------------"
curl -X POST "$NAKAMA_URL/v2/rpc/submit_score_with_aggregate" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"test_game","score":4200}' \
  -w "\nStatus: %{http_code}\n" \
  -s | jq '.' || echo "Request failed"
echo ""

# Test 3: create_all_leaderboards_with_friends
echo "Test 3: create_all_leaderboards_with_friends"
echo "--------------------------------------"
curl -X POST "$NAKAMA_URL/v2/rpc/create_all_leaderboards_with_friends" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -w "\nStatus: %{http_code}\n" \
  -s | jq '.' || echo "Request failed"
echo ""

# Test 4: submit_score_with_friends_sync
echo "Test 4: submit_score_with_friends_sync"
echo "--------------------------------------"
curl -X POST "$NAKAMA_URL/v2/rpc/submit_score_with_friends_sync" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"test_game","score":3500}' \
  -w "\nStatus: %{http_code}\n" \
  -s | jq '.' || echo "Request failed"
echo ""

# Test 5: get_friend_leaderboard
echo "Test 5: get_friend_leaderboard"
echo "--------------------------------------"
curl -X POST "$NAKAMA_URL/v2/rpc/get_friend_leaderboard" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"leaderboardId":"leaderboard_test_game","limit":10}' \
  -w "\nStatus: %{http_code}\n" \
  -s | jq '.' || echo "Request failed"
echo ""

# Test 6: send_friend_invite
echo "Test 6: send_friend_invite"
echo "--------------------------------------"
# Note: Replace target_user_id with a real user ID
curl -X POST "$NAKAMA_URL/v2/rpc/send_friend_invite" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetUserId":"00000000-0000-0000-0000-000000000001","message":"Lets be friends!"}' \
  -w "\nStatus: %{http_code}\n" \
  -s | jq '.' || echo "Request failed"
echo ""

# Test 7: accept_friend_invite
echo "Test 7: accept_friend_invite"
echo "--------------------------------------"
# Note: Replace invite_id with a real invite ID from send_friend_invite
curl -X POST "$NAKAMA_URL/v2/rpc/accept_friend_invite" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"inviteId":"test_invite_id"}' \
  -w "\nStatus: %{http_code}\n" \
  -s | jq '.' || echo "Request failed"
echo ""

# Test 8: decline_friend_invite
echo "Test 8: decline_friend_invite"
echo "--------------------------------------"
# Note: Replace invite_id with a real invite ID from send_friend_invite
curl -X POST "$NAKAMA_URL/v2/rpc/decline_friend_invite" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"inviteId":"test_invite_id"}' \
  -w "\nStatus: %{http_code}\n" \
  -s | jq '.' || echo "Request failed"
echo ""

# Test 9: get_notifications
echo "Test 9: get_notifications"
echo "--------------------------------------"
curl -X POST "$NAKAMA_URL/v2/rpc/get_notifications" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit":20}' \
  -w "\nStatus: %{http_code}\n" \
  -s | jq '.' || echo "Request failed"
echo ""

echo "=========================================="
echo "All RPC tests completed"
echo "=========================================="
