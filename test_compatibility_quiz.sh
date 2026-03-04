#!/bin/bash

# ============================================================================
# COMPATIBILITY QUIZ END-TO-END TEST
# Simulates two Unity clients going through the full async quiz flow
# ============================================================================

# Configuration - adjust these for your environment
NAKAMA_HOST="http://localhost:7350"
SERVER_KEY="defaultkey"  # Base64 of "defaultkey:"

echo "=============================================="
echo "COMPATIBILITY QUIZ - END-TO-END FLOW TEST"
echo "=============================================="
echo ""

# ============================================================================
# STEP 1: Authenticate two users (simulating two Unity devices)
# ============================================================================
echo "STEP 1: Authenticating two test users..."
echo "----------------------------------------------"

# Authenticate Player A (creator)
PLAYER_A_DEVICE="test-device-player-a-$(date +%s)"
echo "Player A authenticating with device: $PLAYER_A_DEVICE"

PLAYER_A_AUTH=$(curl -s -X POST "$NAKAMA_HOST/v2/account/authenticate/device?create=true" \
  -H "Authorization: Basic $(echo -n "$SERVER_KEY:" | base64)" \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$PLAYER_A_DEVICE\"}")

PLAYER_A_TOKEN=$(echo $PLAYER_A_AUTH | jq -r '.token')
PLAYER_A_USER_ID=$(echo $PLAYER_A_AUTH | jq -r '.user_id // empty')

if [ -z "$PLAYER_A_TOKEN" ] || [ "$PLAYER_A_TOKEN" == "null" ]; then
  echo "ERROR: Failed to authenticate Player A"
  echo "Response: $PLAYER_A_AUTH"
  exit 1
fi

echo "✓ Player A authenticated"
echo "  User ID: $PLAYER_A_USER_ID"
echo ""

# Authenticate Player B (joiner)
PLAYER_B_DEVICE="test-device-player-b-$(date +%s)"
echo "Player B authenticating with device: $PLAYER_B_DEVICE"

PLAYER_B_AUTH=$(curl -s -X POST "$NAKAMA_HOST/v2/account/authenticate/device?create=true" \
  -H "Authorization: Basic $(echo -n "$SERVER_KEY:" | base64)" \
  -H "Content-Type: application/json" \
  -d "{\"id\": \"$PLAYER_B_DEVICE\"}")

PLAYER_B_TOKEN=$(echo $PLAYER_B_AUTH | jq -r '.token')
PLAYER_B_USER_ID=$(echo $PLAYER_B_AUTH | jq -r '.user_id // empty')

if [ -z "$PLAYER_B_TOKEN" ] || [ "$PLAYER_B_TOKEN" == "null" ]; then
  echo "ERROR: Failed to authenticate Player B"
  echo "Response: $PLAYER_B_AUTH"
  exit 1
fi

echo "✓ Player B authenticated"
echo "  User ID: $PLAYER_B_USER_ID"
echo ""

# ============================================================================
# STEP 2: Player A creates a compatibility quiz session
# ============================================================================
echo "STEP 2: Player A creates a compatibility quiz session..."
echo "----------------------------------------------"

CREATE_PAYLOAD=$(cat <<EOF
{
  "quizId": "valentines_quiz_2024",
  "quizTitle": "Valentine's Compatibility Quiz",
  "playerDisplayName": "Alice"
}
EOF
)

CREATE_RESPONSE=$(curl -s -X POST "$NAKAMA_HOST/v2/rpc/compatibility_create_session" \
  -H "Authorization: Bearer $PLAYER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$CREATE_PAYLOAD")

echo "Raw response:"
echo "$CREATE_RESPONSE" | jq '.'
echo ""

# Parse the response
CREATE_RESULT=$(echo $CREATE_RESPONSE | jq -r '.payload' | jq '.')
SUCCESS=$(echo $CREATE_RESULT | jq -r '.success')
SESSION_ID=$(echo $CREATE_RESULT | jq -r '.data.sessionId')
SHARE_CODE=$(echo $CREATE_RESULT | jq -r '.data.shareCode')
STATUS=$(echo $CREATE_RESULT | jq -r '.data.status')

if [ "$SUCCESS" != "true" ]; then
  echo "ERROR: Failed to create session"
  echo "Message: $(echo $CREATE_RESULT | jq -r '.message')"
  exit 1
fi

echo "✓ Session created successfully!"
echo "  Session ID: $SESSION_ID"
echo "  Share Code: $SHARE_CODE (give this to your partner!)"
echo "  Status: $STATUS (0 = WaitingForPartner)"
echo ""

# ============================================================================
# STEP 3: Player B joins using the share code
# ============================================================================
echo "STEP 3: Player B joins using share code: $SHARE_CODE"
echo "----------------------------------------------"

JOIN_PAYLOAD=$(cat <<EOF
{
  "shareCode": "$SHARE_CODE",
  "playerDisplayName": "Bob"
}
EOF
)

JOIN_RESPONSE=$(curl -s -X POST "$NAKAMA_HOST/v2/rpc/compatibility_join_session" \
  -H "Authorization: Bearer $PLAYER_B_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$JOIN_PAYLOAD")

echo "Raw response:"
echo "$JOIN_RESPONSE" | jq '.'
echo ""

JOIN_RESULT=$(echo $JOIN_RESPONSE | jq -r '.payload' | jq '.')
SUCCESS=$(echo $JOIN_RESULT | jq -r '.success')
STATUS=$(echo $JOIN_RESULT | jq -r '.data.status')
PARTNER_NAME=$(echo $JOIN_RESULT | jq -r '.data.playerB.displayName')

if [ "$SUCCESS" != "true" ]; then
  echo "ERROR: Failed to join session"
  echo "Message: $(echo $JOIN_RESULT | jq -r '.message')"
  exit 1
fi

echo "✓ Player B joined successfully!"
echo "  Partner Name: $PARTNER_NAME"
echo "  Status: $STATUS (1 = PartnerJoined)"
echo ""

# ============================================================================
# STEP 4: Player A submits their quiz answers
# ============================================================================
echo "STEP 4: Player A submits quiz answers..."
echo "----------------------------------------------"

PLAYER_A_ANSWERS=$(cat <<EOF
{
  "sessionId": "$SESSION_ID",
  "answers": [
    {"questionId": "q1", "optionId": "a"},
    {"questionId": "q2", "optionId": "b"},
    {"questionId": "q3", "optionId": "c"},
    {"questionId": "q4", "optionId": "a"},
    {"questionId": "q5", "optionId": "b"}
  ],
  "traitScores": {
    "mbti:E": 4,
    "mbti:I": 1,
    "mbti:N": 3,
    "mbti:S": 2,
    "mbti:F": 4,
    "mbti:T": 1,
    "mbti:J": 2,
    "mbti:P": 3,
    "big_five:high_openness": 4,
    "big_five:high_agreeableness": 3,
    "big_five:high_conscientiousness": 3
  },
  "resultId": "personality_type_enfp",
  "personalityTitle": "The Campaigner",
  "personalityEmoji": "🌟"
}
EOF
)

SUBMIT_A_RESPONSE=$(curl -s -X POST "$NAKAMA_HOST/v2/rpc/compatibility_submit_answers" \
  -H "Authorization: Bearer $PLAYER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PLAYER_A_ANSWERS")

echo "Raw response:"
echo "$SUBMIT_A_RESPONSE" | jq '.'
echo ""

SUBMIT_A_RESULT=$(echo $SUBMIT_A_RESPONSE | jq -r '.payload' | jq '.')
SUCCESS=$(echo $SUBMIT_A_RESULT | jq -r '.success')
CREATOR_COMPLETE=$(echo $SUBMIT_A_RESULT | jq -r '.data.playerA.isComplete')
STATUS=$(echo $SUBMIT_A_RESULT | jq -r '.data.status')

if [ "$SUCCESS" != "true" ]; then
  echo "ERROR: Player A failed to submit answers"
  echo "Message: $(echo $SUBMIT_A_RESULT | jq -r '.message')"
  exit 1
fi

echo "✓ Player A submitted answers!"
echo "  Creator Complete: $CREATOR_COMPLETE"
echo "  Status: $STATUS"
echo ""

# ============================================================================
# STEP 5: Player B submits their quiz answers
# ============================================================================
echo "STEP 5: Player B submits quiz answers..."
echo "----------------------------------------------"

PLAYER_B_ANSWERS=$(cat <<EOF
{
  "sessionId": "$SESSION_ID",
  "answers": [
    {"questionId": "q1", "optionId": "a"},
    {"questionId": "q2", "optionId": "a"},
    {"questionId": "q3", "optionId": "c"},
    {"questionId": "q4", "optionId": "b"},
    {"questionId": "q5", "optionId": "b"}
  ],
  "traitScores": {
    "mbti:E": 2,
    "mbti:I": 3,
    "mbti:N": 4,
    "mbti:S": 1,
    "mbti:F": 3,
    "mbti:T": 2,
    "mbti:J": 4,
    "mbti:P": 1,
    "big_five:high_openness": 5,
    "big_five:high_agreeableness": 4,
    "big_five:high_conscientiousness": 4
  },
  "resultId": "personality_type_infj",
  "personalityTitle": "The Advocate",
  "personalityEmoji": "💫"
}
EOF
)

SUBMIT_B_RESPONSE=$(curl -s -X POST "$NAKAMA_HOST/v2/rpc/compatibility_submit_answers" \
  -H "Authorization: Bearer $PLAYER_B_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PLAYER_B_ANSWERS")

echo "Raw response:"
echo "$SUBMIT_B_RESPONSE" | jq '.'
echo ""

SUBMIT_B_RESULT=$(echo $SUBMIT_B_RESPONSE | jq -r '.payload' | jq '.')
SUCCESS=$(echo $SUBMIT_B_RESULT | jq -r '.success')
PARTNER_COMPLETE=$(echo $SUBMIT_B_RESULT | jq -r '.data.playerB.isComplete')
STATUS=$(echo $SUBMIT_B_RESULT | jq -r '.data.status')

if [ "$SUCCESS" != "true" ]; then
  echo "ERROR: Player B failed to submit answers"
  echo "Message: $(echo $SUBMIT_B_RESULT | jq -r '.message')"
  exit 1
fi

echo "✓ Player B submitted answers!"
echo "  Partner Complete: $PARTNER_COMPLETE"
echo "  Status: $STATUS (2 = BothCompleted)"
echo ""

# ============================================================================
# STEP 6: Calculate compatibility score
# ============================================================================
echo "STEP 6: Calculating compatibility score..."
echo "----------------------------------------------"

CALC_PAYLOAD=$(cat <<EOF
{
  "sessionId": "$SESSION_ID"
}
EOF
)

CALC_RESPONSE=$(curl -s -X POST "$NAKAMA_HOST/v2/rpc/compatibility_calculate" \
  -H "Authorization: Bearer $PLAYER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$CALC_PAYLOAD")

echo "Raw response:"
echo "$CALC_RESPONSE" | jq '.'
echo ""

CALC_RESULT=$(echo $CALC_RESPONSE | jq -r '.payload' | jq '.')
SUCCESS=$(echo $CALC_RESULT | jq -r '.success')

if [ "$SUCCESS" != "true" ]; then
  echo "ERROR: Failed to calculate compatibility"
  echo "Message: $(echo $CALC_RESULT | jq -r '.message')"
  exit 1
fi

SCORE=$(echo $CALC_RESULT | jq -r '.data.compatibilityScore')
LEVEL=$(echo $CALC_RESULT | jq -r '.data.compatibilityLevel')
INSIGHT=$(echo $CALC_RESULT | jq -r '.data.compatibilityInsight')
MATCHING=$(echo $CALC_RESULT | jq -r '.data.matchingTraits')
DIFFERENT=$(echo $CALC_RESULT | jq -r '.data.differentTraits')

echo "=============================================="
echo "🎉 COMPATIBILITY RESULTS 🎉"
echo "=============================================="
echo ""
echo "  Score: $SCORE%"
echo "  Level: $LEVEL"
echo "  Insight: $INSIGHT"
echo ""
echo "  Player A: Alice (The Campaigner 🌟)"
echo "  Player B: Bob (The Advocate 💫)"
echo ""

# ============================================================================
# STEP 7: Verify by getting session details
# ============================================================================
echo "STEP 7: Verify - Get session details..."
echo "----------------------------------------------"

GET_PAYLOAD=$(cat <<EOF
{
  "sessionId": "$SESSION_ID"
}
EOF
)

GET_RESPONSE=$(curl -s -X POST "$NAKAMA_HOST/v2/rpc/compatibility_get_session" \
  -H "Authorization: Bearer $PLAYER_B_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$GET_PAYLOAD")

echo "Final session state:"
echo "$GET_RESPONSE" | jq -r '.payload' | jq '.'
echo ""

# ============================================================================
# STEP 8: List all sessions for Player A
# ============================================================================
echo "STEP 8: List Player A's sessions..."
echo "----------------------------------------------"

LIST_RESPONSE=$(curl -s -X POST "$NAKAMA_HOST/v2/rpc/compatibility_list_sessions" \
  -H "Authorization: Bearer $PLAYER_A_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{}")

echo "Player A's sessions:"
echo "$LIST_RESPONSE" | jq -r '.payload' | jq '.'
echo ""

echo "=============================================="
echo "✓ END-TO-END TEST COMPLETE!"
echo "=============================================="
echo ""
echo "Flow Summary:"
echo "1. Player A (Alice) authenticated"
echo "2. Player A created session with share code: $SHARE_CODE"
echo "3. Player B (Bob) joined using the share code"
echo "4. Player A submitted quiz answers (ENFP personality)"
echo "5. Player B submitted quiz answers (INFJ personality)"
echo "6. Compatibility calculated: $SCORE%"
echo "7. Both players can view results"
echo ""
