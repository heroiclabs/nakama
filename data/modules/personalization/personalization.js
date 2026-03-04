// Personalization module for Nakama game server
// Smart missions and recommendations based on player behavior

// ─── Helpers ────────────────────────────────────────────────────────────────

function uuid() {
  var s = [];
  var hex = "0123456789abcdef";
  for (var i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      s.push("-");
    } else if (i === 14) {
      s.push("4");
    } else {
      s.push(hex.charAt(Math.floor(Math.random() * 16)));
    }
  }
  return s.join("");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function todayKey() {
  var d = new Date();
  return d.getUTCFullYear() + "-" +
    ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" +
    ("0" + d.getUTCDate()).slice(-2);
}

var ALL_CATEGORIES = [
  "Science", "History", "Geography", "Entertainment",
  "Sports", "Technology", "Art", "Music", "Literature", "Nature"
];

var DISCOVERABLE_FEATURES = [
  { id: "tournament", label: "Tournaments", description: "Compete in a tournament" },
  { id: "daily_duo", label: "Daily Duo", description: "Play a Daily Duo match with a friend" },
  { id: "group_challenge", label: "Group Challenge", description: "Join a group challenge" },
  { id: "leaderboard", label: "Leaderboards", description: "Check and climb the leaderboards" },
  { id: "mystery_box", label: "Mystery Box", description: "Open a mystery box" },
  { id: "lucky_draw", label: "Lucky Draw", description: "Enter the daily lucky draw" },
  { id: "streak_bonus", label: "Streak Bonus", description: "Maintain your daily streak" }
];

// ─── Internal: load player quiz history ─────────────────────────────────────

function loadQuizHistory(nk, userId, gameId) {
  var categoryStats = {};
  var totalQuizzes = 0;

  var collections = ["quiz_results_" + gameId, "quizverse_analytics"];
  for (var c = 0; c < collections.length; c++) {
    try {
      var records = nk.storageRead([{
        collection: collections[c],
        key: "stats",
        userId: userId
      }]);
      if (records && records.length > 0) {
        var stats = records[0].value;
        if (stats.category_stats) { categoryStats = stats.category_stats; }
        if (stats.total_quizzes) { totalQuizzes = stats.total_quizzes; }
        break;
      }
    } catch (e) {
      // continue to next collection
    }
  }

  return { categoryStats: categoryStats, totalQuizzes: totalQuizzes };
}

// ─── Internal: load player achievements ─────────────────────────────────────

function loadAchievements(nk, userId, gameId) {
  var achievements = [];
  try {
    var records = nk.storageRead([{
      collection: "achievements",
      key: gameId + "_progress",
      userId: userId
    }]);
    if (records && records.length > 0 && records[0].value.achievements) {
      achievements = records[0].value.achievements;
    }
  } catch (e) {
    // no achievements yet
  }
  return achievements;
}

// ─── Internal: count friends ────────────────────────────────────────────────

function countFriends(nk, userId) {
  var count = 0;
  try {
    var friendsList = nk.friendsList(userId, 100, 0, "");
    if (friendsList && friendsList.friends) {
      count = friendsList.friends.length;
    }
  } catch (e) {
    // no friends data
  }
  return count;
}

// ─── Internal: load player state ────────────────────────────────────────────

function loadPlayerState(nk, userId, gameId) {
  var state = {
    streak: 0,
    last_login: 0,
    wallet: { coins: 0, gems: 0 },
    features_used: []
  };

  try {
    var records = nk.storageRead([{
      collection: "player_state",
      key: gameId,
      userId: userId
    }]);
    if (records && records.length > 0) {
      var val = records[0].value;
      if (val.streak !== undefined) { state.streak = val.streak; }
      if (val.last_login !== undefined) { state.last_login = val.last_login; }
      if (val.features_used) { state.features_used = val.features_used; }
    }
  } catch (e) {
    // defaults
  }

  try {
    var account = nk.accountGetId(userId);
    if (account && account.wallet) {
      var w = JSON.parse(account.wallet);
      if (w.coins !== undefined) { state.wallet.coins = w.coins; }
      if (w.gems !== undefined) { state.wallet.gems = w.gems; }
    }
  } catch (e) {
    // default wallet
  }

  return state;
}

// ─── Internal: load friends recent activity ─────────────────────────────────

function loadFriendsActivity(nk, userId, gameId) {
  var activities = [];
  try {
    var friendsList = nk.friendsList(userId, 20, 0, "");
    if (friendsList && friendsList.friends) {
      for (var i = 0; i < friendsList.friends.length && i < 5; i++) {
        var friend = friendsList.friends[i];
        var friendId = friend.user.userId || friend.user.id;
        try {
          var records = nk.storageRead([{
            collection: "player_state",
            key: gameId,
            userId: friendId
          }]);
          if (records && records.length > 0) {
            activities.push({
              user_id: friendId,
              username: friend.user.username || "Friend",
              last_login: records[0].value.last_login || 0,
              streak: records[0].value.streak || 0
            });
          }
        } catch (e) {
          // skip this friend
        }
      }
    }
  } catch (e) {
    // no friend activity
  }
  return activities;
}

// ─── Internal: load active events ───────────────────────────────────────────

function loadActiveEvents(nk, gameId) {
  var events = [];
  var now = nowSeconds();
  var systemId = "00000000-0000-0000-0000-000000000000";

  try {
    var listed = nk.storageList(systemId, "flash_events", 100, "");
    if (listed && listed.objects) {
      for (var i = 0; i < listed.objects.length; i++) {
        var val = listed.objects[i].value;
        if (val.game_id === gameId && val.start_time <= now && val.end_time > now) {
          events.push(val);
        }
      }
    }
  } catch (e) {
    // no events
  }

  return events;
}

// ─── Internal: find strongest & weakest categories ──────────────────────────

function analyzeCategoryStrength(categoryStats) {
  var strongest = null;
  var weakest = null;
  var bestScore = -1;
  var worstScore = Infinity;
  var triedCategories = [];

  for (var cat in categoryStats) {
    if (!categoryStats.hasOwnProperty(cat)) continue;
    triedCategories.push(cat);
    var stat = categoryStats[cat];
    var accuracy = stat.correct / Math.max(stat.total, 1);
    if (accuracy > bestScore) {
      bestScore = accuracy;
      strongest = cat;
    }
    if (accuracy < worstScore) {
      worstScore = accuracy;
      weakest = cat;
    }
  }

  var untried = [];
  for (var i = 0; i < ALL_CATEGORIES.length; i++) {
    if (triedCategories.indexOf(ALL_CATEGORIES[i]) === -1) {
      untried.push(ALL_CATEGORIES[i]);
    }
  }

  return {
    strongest: strongest,
    weakest: weakest,
    bestAccuracy: bestScore,
    worstAccuracy: worstScore,
    triedCategories: triedCategories,
    untriedCategories: untried
  };
}

// ─── 1. Get Personalized Missions ───────────────────────────────────────────

var rpcGetPersonalizedMissions = function (ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var deviceId = input.device_id;
  var gameId = input.game_id;
  var userId = ctx.userId;
  var today = todayKey();
  var missionsKey = gameId + "_" + today;

  // Return cached missions if generated today
  var cached = nk.storageRead([{
    collection: "personalized_missions",
    key: missionsKey,
    userId: userId
  }]);

  if (cached && cached.length > 0) {
    return JSON.stringify(cached[0].value);
  }

  var quizData = loadQuizHistory(nk, userId, gameId);
  var achievements = loadAchievements(nk, userId, gameId);
  var friendCount = countFriends(nk, userId);
  var playerState = loadPlayerState(nk, userId, gameId);
  var analysis = analyzeCategoryStrength(quizData.categoryStats);

  var missions = [];
  var reasons = [];

  // (a) Comfort mission – strongest category, easy target
  var comfortCategory = analysis.strongest || ALL_CATEGORIES[0];
  var comfortTarget = 3;
  missions.push({
    id: uuid(),
    title: comfortCategory + " Champion",
    description: "Score well in " + comfortTarget + " " + comfortCategory + " quizzes",
    objective: "complete_quizzes",
    category: comfortCategory,
    target: comfortTarget,
    reward: { coins: 200, gems: 5 },
    difficulty: "easy",
    type: "comfort"
  });
  reasons.push("Comfort mission in your strongest category: " + comfortCategory);

  // (b) Stretch mission – weaker or untried category, moderate target
  var stretchCategory;
  if (analysis.untriedCategories.length > 0) {
    stretchCategory = analysis.untriedCategories[Math.floor(Math.random() * analysis.untriedCategories.length)];
    reasons.push("Stretch mission in an untried category: " + stretchCategory);
  } else if (analysis.weakest && analysis.weakest !== comfortCategory) {
    stretchCategory = analysis.weakest;
    reasons.push("Stretch mission in your weakest category: " + stretchCategory);
  } else {
    stretchCategory = ALL_CATEGORIES[Math.floor(Math.random() * ALL_CATEGORIES.length)];
    reasons.push("Stretch mission in a random category: " + stretchCategory);
  }

  missions.push({
    id: uuid(),
    title: "Explore " + stretchCategory,
    description: "Answer 5 questions correctly in " + stretchCategory,
    objective: "correct_answers",
    category: stretchCategory,
    target: 5,
    reward: { coins: 400, gems: 15 },
    difficulty: "moderate",
    type: "stretch"
  });

  // (c) Social mission – depends on friend count
  var socialMission;
  if (friendCount === 0) {
    socialMission = {
      id: uuid(),
      title: "Make a Friend",
      description: "Send a friend request or join a group",
      objective: "social_connect",
      category: "social",
      target: 1,
      reward: { coins: 300, gems: 10 },
      difficulty: "easy",
      type: "social"
    };
    reasons.push("Social mission: you have no friends yet — time to connect!");
  } else if (friendCount < 5) {
    socialMission = {
      id: uuid(),
      title: "Challenge a Friend",
      description: "Send a quiz challenge to a friend",
      objective: "send_challenge",
      category: "social",
      target: 1,
      reward: { coins: 350, gems: 10 },
      difficulty: "easy",
      type: "social"
    };
    reasons.push("Social mission: challenge one of your " + friendCount + " friends");
  } else {
    socialMission = {
      id: uuid(),
      title: "Squad Goals",
      description: "Play " + Math.min(friendCount, 3) + " matches with friends",
      objective: "play_with_friends",
      category: "social",
      target: Math.min(friendCount, 3),
      reward: { coins: 500, gems: 20 },
      difficulty: "moderate",
      type: "social"
    };
    reasons.push("Social mission: play with your friends");
  }
  missions.push(socialMission);

  // (d) Discovery mission – feature not yet used
  var unusedFeatures = [];
  for (var f = 0; f < DISCOVERABLE_FEATURES.length; f++) {
    if (playerState.features_used.indexOf(DISCOVERABLE_FEATURES[f].id) === -1) {
      unusedFeatures.push(DISCOVERABLE_FEATURES[f]);
    }
  }

  var discoveryFeature;
  if (unusedFeatures.length > 0) {
    discoveryFeature = unusedFeatures[Math.floor(Math.random() * unusedFeatures.length)];
  } else {
    discoveryFeature = DISCOVERABLE_FEATURES[Math.floor(Math.random() * DISCOVERABLE_FEATURES.length)];
  }

  missions.push({
    id: uuid(),
    title: "Discover: " + discoveryFeature.label,
    description: discoveryFeature.description,
    objective: "try_feature",
    category: "discovery",
    target: 1,
    reward: { coins: 250, gems: 10 },
    difficulty: "easy",
    type: "discovery",
    feature_id: discoveryFeature.id
  });
  reasons.push("Discovery mission: try " + discoveryFeature.label);

  var result = {
    missions: missions,
    personalization_reason: reasons.join("; "),
    generated_at: nowSeconds(),
    date: today,
    game_id: gameId
  };

  nk.storageWrite([{
    collection: "personalized_missions",
    key: missionsKey,
    userId: userId,
    value: result,
    permissionRead: 1,
    permissionWrite: 0
  }]);

  logger.info("Generated %d personalized missions for %s (game: %s)", missions.length, userId, gameId);
  return JSON.stringify(result);
};

// ─── 2. Get Smart Recommendations ──────────────────────────────────────────

var rpcGetSmartRecommendations = function (ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var deviceId = input.device_id;
  var gameId = input.game_id;
  var userId = ctx.userId;

  var playerState = loadPlayerState(nk, userId, gameId);
  var quizData = loadQuizHistory(nk, userId, gameId);
  var achievements = loadAchievements(nk, userId, gameId);
  var friendsActivity = loadFriendsActivity(nk, userId, gameId);
  var activeEvents = loadActiveEvents(nk, gameId);
  var analysis = analyzeCategoryStrength(quizData.categoryStats);
  var friendCount = countFriends(nk, userId);

  var recommendations = [];
  var nextBestAction = "";
  var reason = "";

  // Priority 1: active events
  if (activeEvents.length > 0) {
    var topEvent = activeEvents[0];
    recommendations.push({
      type: "event",
      value: topEvent.event_name,
      reason: topEvent.event_type + " is active now! " + (topEvent.multiplier || 2) + "x rewards for " +
        Math.round((topEvent.end_time - nowSeconds()) / 60) + " more minutes"
    });
  }

  // Priority 2: streak at risk
  var now = nowSeconds();
  var hoursSinceLogin = (now - playerState.last_login) / 3600;
  if (playerState.streak > 0 && hoursSinceLogin > 18) {
    nextBestAction = "play_now";
    reason = "Your " + playerState.streak + "-day streak is at risk! Play a quick round to keep it alive.";
    recommendations.push({
      type: "feature",
      value: "streak_bonus",
      reason: "Don't lose your " + playerState.streak + "-day streak!"
    });
  }

  // Category recommendations
  if (analysis.untriedCategories.length > 0) {
    var suggestCat = analysis.untriedCategories[Math.floor(Math.random() * analysis.untriedCategories.length)];
    recommendations.push({
      type: "category",
      value: suggestCat,
      reason: "You haven't tried " + suggestCat + " yet — it could be your hidden strength!"
    });
  }

  if (analysis.weakest) {
    recommendations.push({
      type: "category",
      value: analysis.weakest,
      reason: "Practice " + analysis.weakest + " to improve — currently your weakest area (" +
        Math.round(analysis.worstAccuracy * 100) + "% accuracy)"
    });
  }

  // Friend recommendations
  if (friendCount === 0) {
    recommendations.push({
      type: "friend",
      value: "find_friends",
      reason: "Playing with friends makes quizzes more fun — add some friends to get started!"
    });
  } else if (friendsActivity.length > 0) {
    var activeFriend = null;
    for (var i = 0; i < friendsActivity.length; i++) {
      if ((now - friendsActivity[i].last_login) < 86400) {
        activeFriend = friendsActivity[i];
        break;
      }
    }
    if (activeFriend) {
      recommendations.push({
        type: "friend",
        value: activeFriend.username,
        reason: activeFriend.username + " is active today — challenge them to a match!"
      });
    }
  }

  // Group recommendation if not in many groups
  try {
    var userGroups = nk.userGroupsList(userId, 100, null, "");
    if (!userGroups || !userGroups.userGroups || userGroups.userGroups.length === 0) {
      recommendations.push({
        type: "group",
        value: "join_group",
        reason: "Join a group to unlock group challenges and earn bonus rewards"
      });
    }
  } catch (e) {
    // skip group recommendation
  }

  // Tournament recommendation if events running
  for (var t = 0; t < activeEvents.length; t++) {
    if (activeEvents[t].event_type === "tournament_blitz") {
      recommendations.push({
        type: "tournament",
        value: activeEvents[t].event_name,
        reason: "A tournament blitz is running — compete for top prizes!"
      });
      break;
    }
  }

  // Achievement push — find one close to completion
  var nearComplete = null;
  for (var a = 0; a < achievements.length; a++) {
    var ach = achievements[a];
    if (!ach.completed && ach.progress && ach.target) {
      var pct = ach.progress / ach.target;
      if (pct >= 0.7 && pct < 1.0) {
        nearComplete = ach;
        break;
      }
    }
  }
  if (nearComplete) {
    recommendations.push({
      type: "achievement",
      value: nearComplete.name || nearComplete.id,
      reason: "You're " + Math.round((nearComplete.progress / nearComplete.target) * 100) +
        "% done with '" + (nearComplete.name || nearComplete.id) + "' — finish it!"
    });
  }

  // Feature discovery
  var unusedFeatures = [];
  for (var fe = 0; fe < DISCOVERABLE_FEATURES.length; fe++) {
    if (playerState.features_used.indexOf(DISCOVERABLE_FEATURES[fe].id) === -1) {
      unusedFeatures.push(DISCOVERABLE_FEATURES[fe]);
    }
  }
  if (unusedFeatures.length > 0) {
    var feat = unusedFeatures[Math.floor(Math.random() * unusedFeatures.length)];
    recommendations.push({
      type: "feature",
      value: feat.id,
      reason: "Try " + feat.label + " — " + feat.description.toLowerCase()
    });
  }

  // Determine next best action if not already set
  if (!nextBestAction) {
    if (activeEvents.length > 0) {
      nextBestAction = "join_event";
      reason = "A live event is happening right now — don't miss out on bonus rewards!";
    } else if (quizData.totalQuizzes === 0) {
      nextBestAction = "play_first_quiz";
      reason = "Start your journey by playing your first quiz!";
    } else if (analysis.untriedCategories.length > 3) {
      nextBestAction = "explore_categories";
      reason = "You've only tried " + analysis.triedCategories.length + " out of " +
        ALL_CATEGORIES.length + " categories. Explore more to find your strengths!";
    } else if (friendCount === 0) {
      nextBestAction = "add_friends";
      reason = "Add friends to unlock social features and compete together!";
    } else {
      nextBestAction = "keep_playing";
      reason = "You're doing great! Keep playing to climb the leaderboard.";
    }
  }

  var result = {
    next_best_action: nextBestAction,
    reason: reason,
    recommendations: recommendations,
    context: {
      streak: playerState.streak,
      total_quizzes: quizData.totalQuizzes,
      friend_count: friendCount,
      active_events: activeEvents.length,
      categories_tried: analysis.triedCategories.length
    },
    generated_at: nowSeconds(),
    game_id: gameId
  };

  logger.info("Generated %d recommendations for %s (game: %s), next action: %s",
    recommendations.length, userId, gameId, nextBestAction);

  return JSON.stringify(result);
};
