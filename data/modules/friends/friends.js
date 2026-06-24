// ============================================================================
// friends.js — Helper-only module (Phase-4 C2 cleanup)
// ============================================================================
// PRODUCTION-READY | ES5 (Goja runtime)
//
// HISTORY
// -------
// This file used to host SIX RPC handlers and SEVERAL helpers:
//   * RPCs: friends_block, friends_unblock, friends_remove, friends_list,
//          friends_challenge_user, friends_spectate
//   * Helpers: isValidFriendUUID, isUserBlocked, areActualFriends,
//              checkRateLimit, sendChallengePushNotification,
//              sendChallengeChatMessage
//
// All six RPCs were silently shadowed by canonical replacements:
//   * friends_block / friends_unblock / friends_remove → src/legacy/friends.ts
//   * friends_list                                    → src/friends/friends_list.ts (Phase-4 C1)
//   * friends_challenge_user / friends_spectate       → friends/friend_challenges.js (Phase-3a)
//
// Phase-4 C2 strips the dead RPC handlers AND their now-unused helpers
// (isValidFriendUUID, isUserBlocked, areActualFriends, checkRateLimit) so
// nobody can read this file and "fix" the wrong code path. The lone
// `checkRateLimit` deletion also removes a name collision with
// `infrastructure/rate_limiting.js` which defines a totally different
// function with the same name (different signature) — the
// rate_limiting.js version was silently overwriting friends.js's at
// merge time, which is the kind of subtle global-scope bug we never
// want to hit.
//
// What remains
// ------------
// Two helper functions that `friends/friend_challenges.js` still calls
// at runtime (via `typeof X === 'function'` lookups so the module is
// resilient to load-order changes — see line 483-495 of
// friend_challenges.js):
//
//   sendChallengePushNotification(nk, logger, targetUserId, gameId,
//                                 challengerName, quizModeName,
//                                 challengeId, roomCode, isAsync)
//      → fans out a push notification via the PUSH_SEND_URL Lambda
//        endpoint to every push_endpoints row owned by `targetUserId`
//        for the given `gameId`. Used by send_friend_challenge.
//
//   sendChallengeChatMessage(nk, logger, senderId, receiverId,
//                            senderName, challengeData)
//      → inserts a "friend challenge" message into the DM channel
//        between sender and receiver so the challenge appears in their
//        chat thread. Falls back to a `pending_chat_messages` storage
//        row if the channel insert fails.
//
// Both helpers are intentionally kept in the legacy JS module rather
// than ported to TypeScript because (a) the Phase-3a TS challenge
// module already has the canonical RPC handler, (b) these helpers are
// pure side-effect fan-outs the TS handler delegates to via dynamic
// lookup, and (c) the dynamic lookup pattern is the safest way to
// handle "host calls helper if it exists, otherwise no-op" without
// hard-coupling the two files.
//
// If you need to add a NEW friend RPC, ADD IT TO ONE OF:
//   - friends/friend_invites.js     (invite lifecycle)
//   - friends/friend_challenges.js  (challenge lifecycle + spectate)
//   - src/friends/friends_list.ts   (read-only roster RPCs)
//   - src/legacy/friends.ts         (graph mutations)
// NOT to this file. This file should never grow back to handler size.
// ============================================================================


/**
 * Send a push notification for a friend challenge.
 * Calls the push notification Lambda endpoint.
 *
 * @param {object} nk
 * @param {object} logger
 * @param {string} targetUserId   - Recipient userId (the challenged player)
 * @param {string} gameId         - Free-form game/mode id (used to filter push_endpoints)
 * @param {string} challengerName - Display name shown in the push title
 * @param {string} quizModeName   - Display name of the quiz mode for the body
 * @param {string} challengeId    - Server-authoritative challenge id (echoed in data)
 * @param {string} roomCode       - Room/share code (echoed in data)
 * @param {boolean} isAsync       - True for async challenges, false for live
 */
function sendChallengePushNotification(nk, logger, targetUserId, gameId, challengerName, quizModeName, challengeId, roomCode, isAsync) {
    var LAMBDA_PUSH_URL = process.env.PUSH_SEND_URL || "https://your-lambda-url.lambda-url.region.on.aws/send-push";

    var endpoints = [];
    try {
        var records = nk.storageList(targetUserId, "push_endpoints", 100);
        for (var i = 0; i < records.length; i++) {
            var value = records[i].value;
            if (value.gameId === gameId) {
                endpoints.push(value);
            }
        }
    } catch (err) {
        utils.logWarn(logger, "Could not list push endpoints: " + err.message);
        return;
    }

    if (endpoints.length === 0) {
        utils.logInfo(logger, "No push endpoints for user " + targetUserId);
        return;
    }

    var challengeType = isAsync ? "Async Challenge" : "Live Challenge";
    var title = "🎮 " + challengerName + " challenged you!";
    var body  = "Accept the " + quizModeName + " " + challengeType + " now!";

    for (var j = 0; j < endpoints.length; j++) {
        var endpoint = endpoints[j];

        var pushPayload = {
            endpointArn: endpoint.endpointArn,
            platform:    endpoint.platform,
            title:       title,
            body:        body,
            data: {
                type:         "friend_challenge",
                challengeId:  challengeId,
                roomCode:     roomCode,
                isAsync:      isAsync,
                click_action: "OPEN_CHALLENGE"
            },
            gameId:    gameId,
            eventType: "friend_challenge"
        };

        try {
            var response = nk.httpRequest(
                LAMBDA_PUSH_URL,
                "post",
                { "Content-Type": "application/json", "Accept": "application/json" },
                JSON.stringify(pushPayload)
            );
            if (response.code === 200 || response.code === 201) {
                utils.logInfo(logger, "Push sent to " + endpoint.platform + " for challenge " + challengeId);
            }
        } catch (pushErr) {
            utils.logWarn(logger, "Push to " + endpoint.platform + " failed: " + pushErr.message);
        }
    }
}

/**
 * Send a friend challenge as a chat message so it appears in the conversation
 * thread between the two users.
 *
 * @param {object} nk
 * @param {object} logger
 * @param {string} senderId      - Challenger userId
 * @param {string} receiverId    - Challenged userId
 * @param {string} senderName    - Challenger display name
 * @param {object} challengeData - { challengeId, roomCode, quizModeName, isAsync,
 *                                   fromUserId, fromDisplayName, expiresAt }
 */
function sendChallengeChatMessage(nk, logger, senderId, receiverId, senderName, challengeData) {
    // Use nk.channelIdBuild(type=2) — the canonical DM channel ID used by UnifiedChatController.
    // The old hand-built "dm_<uuid>_<uuid>" key produced a different channel than the client
    // reads, so challenge messages were never visible in chat history. nk.channelIdBuild
    // sorts the two user IDs internally so A→B and B→A produce the same channel.
    var channelId = null;
    try {
        channelId = nk.channelIdBuild(senderId, receiverId, 2);
    } catch (err) {
        utils.logWarn(logger, "Could not create channel ID: " + err.message);
        return;
    }

    var messageContent = {
        type: "friend_challenge",
        text: "🎮 " + senderName + " challenged you to " + challengeData.quizModeName + "!",
        challenge: {
            challengeId:     challengeData.challengeId,
            roomCode:        challengeData.roomCode,
            shareCode:       challengeData.roomCode,
            quizModeName:    challengeData.quizModeName,
            isAsync:         challengeData.isAsync,
            fromUserId:      challengeData.fromUserId,
            fromDisplayName: challengeData.fromDisplayName,
            expiresAt:       challengeData.expiresAt,
            status:          "pending"
        }
    };

    try {
        nk.channelMessageSend(
            channelId,
            JSON.stringify(messageContent),
            senderId,
            senderName,
            true  // persistent
        );
        utils.logInfo(logger, "Challenge chat message sent to channel " + channelId);
    } catch (chatErr) {
        // Fallback: store under RECIPIENT's userId so they can read it (permRead=1 = owner).
        // Previously stored under senderId which the recipient could never access.
        utils.logWarn(logger, "Channel message failed, using storage fallback: " + chatErr.message);

        var msgKey = "pending_chat_" + senderId + "_" + Date.now();
        utils.writeStorage(nk, logger, "pending_chat_messages", msgKey, receiverId, {
            senderId:    senderId,
            senderName:  senderName,
            receiverId:  receiverId,
            content:     messageContent,
            timestamp:   utils.getCurrentTimestamp()
        });
    }
}
