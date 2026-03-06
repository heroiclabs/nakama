// Live Ops module for Nakama game server
// Flash events, mystery boxes, daily spotlights, streaks, comeback rewards, lucky draws, happy hour

// ─── Helpers ────────────────────────────────────────────────────────────────

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

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

function todayKey() {
  var d = new Date();
  return d.getUTCFullYear() + "-" +
    ("0" + (d.getUTCMonth() + 1)).slice(-2) + "-" +
    ("0" + d.getUTCDate()).slice(-2);
}

function weightedPick(table) {
  var total = 0;
  var i;
  for (i = 0; i < table.length; i++) {
    total += table[i].weight;
  }
  var roll = Math.random() * total;
  var cumulative = 0;
  for (i = 0; i < table.length; i++) {
    cumulative += table[i].weight;
    if (roll <= cumulative) {
      return table[i];
    }
  }
  return table[table.length - 1];
}

// ─── Mystery Box reward tables ──────────────────────────────────────────────

var MYSTERY_BOX_TABLES = {
  common: [
    { weight: 50, reward: { coins: 100 },  label: "100 Coins" },
    { weight: 30, reward: { coins: 250 },  label: "250 Coins" },
    { weight: 15, reward: { coins: 500 },  label: "500 Coins" },
    { weight: 4,  reward: { gems: 5 },     label: "5 Gems" },
    { weight: 1,  reward: { gems: 15 },    label: "15 Gems" }
  ],
  rare: [
    { weight: 35, reward: { coins: 500 },  label: "500 Coins" },
    { weight: 30, reward: { coins: 1000 }, label: "1000 Coins" },
    { weight: 20, reward: { gems: 10 },    label: "10 Gems" },
    { weight: 10, reward: { gems: 25 },    label: "25 Gems" },
    { weight: 5,  reward: { gems: 50 },    label: "50 Gems" }
  ],
  epic: [
    { weight: 25, reward: { coins: 2000 },             label: "2000 Coins" },
    { weight: 25, reward: { gems: 30 },                label: "30 Gems" },
    { weight: 20, reward: { gems: 60 },                label: "60 Gems" },
    { weight: 15, reward: { coins: 5000 },             label: "5000 Coins" },
    { weight: 10, reward: { gems: 100 },               label: "100 Gems" },
    { weight: 5,  reward: { gems: 100, badge: "epic_unboxer" }, label: "100 Gems + Epic Badge" }
  ],
  legendary: [
    { weight: 20, reward: { gems: 100 },                           label: "100 Gems" },
    { weight: 20, reward: { coins: 10000 },                        label: "10000 Coins" },
    { weight: 20, reward: { gems: 200 },                           label: "200 Gems" },
    { weight: 15, reward: { gems: 500 },                           label: "500 Gems" },
    { weight: 10, reward: { gems: 300, badge: "legendary_luck" },  label: "300 Gems + Legendary Badge" },
    { weight: 10, reward: { coins: 25000, gems: 250 },             label: "25000 Coins + 250 Gems" },
    { weight: 5,  reward: { gems: 1000, avatar: "golden_phoenix" }, label: "1000 Gems + Exclusive Avatar" }
  ]
};

// ─── Streak milestone definitions ───────────────────────────────────────────

var STREAK_MILESTONES = {
  7:   { coins: 500,   gems: 10,  badge: "week_warrior" },
  14:  { coins: 1500,  gems: 25,  badge: "fortnight_fighter" },
  30:  { coins: 3000,  gems: 50,  badge: "monthly_master" },
  50:  { coins: 5000,  gems: 100, badge: "fifty_fierce" },
  100: { coins: 10000, gems: 250, badge: "century_champion" },
  365: { coins: 50000, gems: 1000, badge: "year_legend" }
};

// ─── 1. Flash Event Create ──────────────────────────────────────────────────

var rpcFlashEventCreate = function (ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var gameId = input.game_id;
  var eventName = input.event_name;
  var eventType = input.event_type;
  var multiplier = input.multiplier || 2;
  var durationMinutes = input.duration_minutes || 60;
  var description = input.description || "";

  var validTypes = ["double_xp", "bonus_coins", "special_category", "tournament_blitz", "happy_hour"];
  if (validTypes.indexOf(eventType) === -1) {
    throw Error("invalid event_type: " + eventType);
  }

  var now = nowSeconds();
  var eventId = uuid();

  var eventData = {
    event_id: eventId,
    game_id: gameId,
    event_name: eventName,
    event_type: eventType,
    multiplier: multiplier,
    duration_minutes: durationMinutes,
    description: description,
    start_time: now,
    end_time: now + (durationMinutes * 60),
    created_by: ctx.userId,
    created_at: now
  };

  nk.storageWrite([{
    collection: "flash_events",
    key: eventId,
    userId: "00000000-0000-0000-0000-000000000000",
    value: eventData,
    permissionRead: 1,
    permissionWrite: 0
  }]);

  logger.info("Flash event created: %s (%s) for game %s", eventName, eventType, gameId);
  return JSON.stringify({ success: true, event: eventData });
};

// ─── 2. Flash Event List Active ─────────────────────────────────────────────

var rpcFlashEventListActive = function (ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var gameId = input.game_id;
  var now = nowSeconds();

  var query = "+collection:flash_events +value.game_id:" + gameId;
  var results = nk.storageIndexList("flash_events_idx", query, 100);

  var active = [];
  if (results && results.objects) {
    for (var i = 0; i < results.objects.length; i++) {
      var obj = results.objects[i];
      var val = obj.value;
      if (val.start_time <= now && val.end_time > now) {
        val.time_remaining_seconds = val.end_time - now;
        active.push(val);
      }
    }
  }

  // Fallback: list via storageList if index not available
  if (active.length === 0) {
    var cursor = "";
    var systemId = "00000000-0000-0000-0000-000000000000";
    var listed = nk.storageList(systemId, "flash_events", 100, cursor);
    if (listed && listed.objects) {
      for (var j = 0; j < listed.objects.length; j++) {
        var item = listed.objects[j];
        var v = item.value;
        if (v.game_id === gameId && v.start_time <= now && v.end_time > now) {
          v.time_remaining_seconds = v.end_time - now;
          active.push(v);
        }
      }
    }
  }

  return JSON.stringify({ active_events: active, count: active.length });
};

// ─── 3. Mystery Box Grant ───────────────────────────────────────────────────

var rpcMysteryBoxGrant = function (ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var userId = input.user_id;
  var gameId = input.game_id;
  var boxType = input.box_type || "common";
  var source = input.source || "unknown";

  var validBoxTypes = ["common", "rare", "epic", "legendary"];
  if (validBoxTypes.indexOf(boxType) === -1) {
    throw Error("invalid box_type: " + boxType);
  }

  var boxId = uuid();
  var now = nowSeconds();

  var boxData = {
    box_id: boxId,
    game_id: gameId,
    box_type: boxType,
    source: source,
    granted_to: userId,
    granted_at: now,
    opened: false,
    opened_at: null,
    reward: null
  };

  nk.storageWrite([{
    collection: "mystery_boxes",
    key: boxId,
    userId: userId,
    value: boxData,
    permissionRead: 1,
    permissionWrite: 0
  }]);

  logger.info("Mystery box (%s) granted to %s from %s", boxType, userId, source);
  return JSON.stringify({ success: true, box: boxData });
};

// ─── 4. Mystery Box Open ────────────────────────────────────────────────────

var rpcMysteryBoxOpen = function (ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var boxId = input.box_id;
  var gameId = input.game_id;
  var userId = ctx.userId;

  var records = nk.storageRead([{
    collection: "mystery_boxes",
    key: boxId,
    userId: userId
  }]);

  if (!records || records.length === 0) {
    throw Error("mystery box not found: " + boxId);
  }

  var box = records[0].value;

  if (box.opened) {
    throw Error("mystery box already opened: " + boxId);
  }

  if (box.game_id !== gameId) {
    throw Error("box does not belong to game: " + gameId);
  }

  var table = MYSTERY_BOX_TABLES[box.box_type];
  if (!table) {
    throw Error("unknown box_type on stored box: " + box.box_type);
  }

  var pick = weightedPick(table);
  var walletChangeset = {};
  if (pick.reward.coins) { walletChangeset.coins = pick.reward.coins; }
  if (pick.reward.gems)  { walletChangeset.gems = pick.reward.gems; }

  if (walletChangeset.coins || walletChangeset.gems) {
    nk.walletUpdate(userId, walletChangeset, { source: "mystery_box", box_type: box.box_type, box_id: boxId }, true);
  }

  var now = nowSeconds();
  box.opened = true;
  box.opened_at = now;
  box.reward = {
    label: pick.label,
    coins: pick.reward.coins || 0,
    gems: pick.reward.gems || 0,
    badge: pick.reward.badge || null,
    avatar: pick.reward.avatar || null
  };

  nk.storageWrite([{
    collection: "mystery_boxes",
    key: boxId,
    userId: userId,
    value: box,
    permissionRead: 1,
    permissionWrite: 0
  }]);

  logger.info("Mystery box %s opened by %s: %s", boxId, userId, pick.label);
  return JSON.stringify({ success: true, reward: box.reward, box_type: box.box_type });
};

// ─── 5. Daily Spotlight ─────────────────────────────────────────────────────

var SPOTLIGHT_CATEGORIES = [
  "Science", "History", "Geography", "Entertainment",
  "Sports", "Technology", "Art", "Music", "Literature", "Nature"
];

var rpcDailySpotlight = function (ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var gameId = input.game_id;
  var today = todayKey();
  var spotlightKey = gameId + "_" + today;

  var records = nk.storageRead([{
    collection: "daily_spotlight",
    key: spotlightKey,
    userId: "00000000-0000-0000-0000-000000000000"
  }]);

  if (records && records.length > 0) {
    return JSON.stringify({ spotlight: records[0].value, cached: true });
  }

  // Generate today's spotlight
  var featuredCategoryIdx = Math.floor(Math.random() * SPOTLIGHT_CATEGORIES.length);
  var bonusCategoryIdx = (featuredCategoryIdx + 1 + Math.floor(Math.random() * (SPOTLIGHT_CATEGORIES.length - 1))) % SPOTLIGHT_CATEGORIES.length;

  var spotlight = {
    game_id: gameId,
    date: today,
    featured_category: SPOTLIGHT_CATEGORIES[featuredCategoryIdx],
    bonus_category: SPOTLIGHT_CATEGORIES[bonusCategoryIdx],
    bonus_multiplier: 2,
    featured_player: null,
    featured_group: null,
    tip_of_the_day: "Challenge a friend today for bonus rewards!",
    created_at: nowSeconds()
  };

  // Try to find top scorer via leaderboard
  try {
    var leaderboardId = gameId + "_daily";
    var topRecords = nk.leaderboardRecordsList(leaderboardId, null, 1, null, 0);
    if (topRecords && topRecords.records && topRecords.records.length > 0) {
      var topRecord = topRecords.records[0];
      spotlight.featured_player = {
        user_id: topRecord.ownerId,
        username: topRecord.username || "Anonymous",
        score: topRecord.score
      };
    }
  } catch (e) {
    logger.warn("Could not fetch leaderboard for spotlight: %s", e.message);
  }

  // Try to find most active group
  try {
    var groups = nk.groupsList(null, null, null, null, 1, null);
    if (groups && groups.groups && groups.groups.length > 0) {
      var g = groups.groups[0];
      spotlight.featured_group = {
        group_id: g.id,
        name: g.name,
        member_count: g.edgeCount
      };
    }
  } catch (e) {
    logger.warn("Could not fetch groups for spotlight: %s", e.message);
  }

  nk.storageWrite([{
    collection: "daily_spotlight",
    key: spotlightKey,
    userId: "00000000-0000-0000-0000-000000000000",
    value: spotlight,
    permissionRead: 1,
    permissionWrite: 0
  }]);

  return JSON.stringify({ spotlight: spotlight, cached: false });
};

// ─── 6. Streak Milestone Celebrate ──────────────────────────────────────────

var rpcStreakMilestoneCelebrate = function (ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var deviceId = input.device_id;
  var gameId = input.game_id;
  var streakCount = input.streak_count;
  var userId = ctx.userId;

  var milestoneReward = STREAK_MILESTONES[streakCount];
  if (!milestoneReward) {
    return JSON.stringify({
      milestone_reached: false,
      streak_count: streakCount,
      message: "No milestone at streak " + streakCount + ". Keep going!"
    });
  }

  var milestoneKey = gameId + "_" + userId + "_streak_" + streakCount;

  var existing = nk.storageRead([{
    collection: "streak_milestones",
    key: milestoneKey,
    userId: userId
  }]);

  if (existing && existing.length > 0) {
    return JSON.stringify({
      milestone_reached: true,
      already_claimed: true,
      streak_count: streakCount,
      reward: existing[0].value.reward
    });
  }

  var walletChangeset = {};
  if (milestoneReward.coins) { walletChangeset.coins = milestoneReward.coins; }
  if (milestoneReward.gems)  { walletChangeset.gems = milestoneReward.gems; }

  nk.walletUpdate(userId, walletChangeset, {
    source: "streak_milestone",
    streak_count: streakCount,
    game_id: gameId
  }, true);

  var milestoneData = {
    game_id: gameId,
    device_id: deviceId,
    streak_count: streakCount,
    reward: {
      coins: milestoneReward.coins || 0,
      gems: milestoneReward.gems || 0,
      badge: milestoneReward.badge || null
    },
    claimed_at: nowSeconds()
  };

  nk.storageWrite([{
    collection: "streak_milestones",
    key: milestoneKey,
    userId: userId,
    value: milestoneData,
    permissionRead: 1,
    permissionWrite: 0
  }]);

  logger.info("Streak milestone %d claimed by %s: %d coins, %d gems, badge=%s",
    streakCount, userId, milestoneReward.coins, milestoneReward.gems, milestoneReward.badge);

  return JSON.stringify({
    milestone_reached: true,
    already_claimed: false,
    streak_count: streakCount,
    reward: milestoneData.reward,
    celebration: "Congratulations on your " + streakCount + "-day streak!"
  });
};

// ─── 7. Comeback Surprise ───────────────────────────────────────────────────

var rpcComebackSurprise = function (ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var deviceId = input.device_id;
  var gameId = input.game_id;
  var daysAway = input.days_away || 1;
  var userId = ctx.userId;

  var coins = 0;
  var gems = 0;
  var message = "";
  var tier = "";

  if (daysAway >= 90) {
    tier = "legendary_comeback";
    coins = 25000;
    gems = 500;
    message = "A LEGEND RETURNS! We've missed you incredibly. Here's a legendary welcome-back package!";
  } else if (daysAway >= 30) {
    tier = "epic_comeback";
    coins = 10000;
    gems = 200;
    message = "Welcome back, champion! It's been a while. Here's an epic care package just for you!";
  } else if (daysAway >= 14) {
    tier = "rare_comeback";
    coins = 5000;
    gems = 75;
    message = "Great to see you again! We saved some special rewards for your return!";
  } else if (daysAway >= 7) {
    tier = "uncommon_comeback";
    coins = 2000;
    gems = 30;
    message = "Hey, welcome back! Here's a little something to get you going again!";
  } else if (daysAway >= 3) {
    tier = "common_comeback";
    coins = 500;
    gems = 10;
    message = "Good to see you! Here are some comeback goodies!";
  } else {
    tier = "quick_return";
    coins = 100;
    gems = 0;
    message = "Welcome back! Here's a small token of appreciation.";
  }

  var walletChangeset = { coins: coins };
  if (gems > 0) { walletChangeset.gems = gems; }

  nk.walletUpdate(userId, walletChangeset, {
    source: "comeback_surprise",
    days_away: daysAway,
    tier: tier,
    game_id: gameId
  }, true);

  var comebackData = {
    game_id: gameId,
    device_id: deviceId,
    days_away: daysAway,
    tier: tier,
    coins: coins,
    gems: gems,
    message: message,
    claimed_at: nowSeconds()
  };

  nk.storageWrite([{
    collection: "comeback_surprises",
    key: gameId + "_" + userId + "_" + todayKey(),
    userId: userId,
    value: comebackData,
    permissionRead: 1,
    permissionWrite: 0
  }]);

  logger.info("Comeback surprise (%s) granted to %s: %d coins, %d gems", tier, userId, coins, gems);

  return JSON.stringify({
    success: true,
    tier: tier,
    reward: { coins: coins, gems: gems },
    message: message,
    days_away: daysAway
  });
};

// ─── 8. Lucky Draw Enter ────────────────────────────────────────────────────

var rpcLuckyDrawEnter = function (ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var gameId = input.game_id;
  var userId = ctx.userId;
  var today = todayKey();
  var entryKey = gameId + "_" + today + "_" + userId;

  var existing = nk.storageRead([{
    collection: "lucky_draw",
    key: entryKey,
    userId: userId
  }]);

  if (existing && existing.length > 0) {
    return JSON.stringify({
      entered: false,
      already_entered: true,
      draw_date: today,
      message: "You've already entered today's lucky draw. Come back tomorrow!"
    });
  }

  var entryData = {
    game_id: gameId,
    user_id: userId,
    draw_date: today,
    entry_time: nowSeconds(),
    status: "pending"
  };

  nk.storageWrite([{
    collection: "lucky_draw",
    key: entryKey,
    userId: userId,
    value: entryData,
    permissionRead: 1,
    permissionWrite: 0
  }]);

  logger.info("Lucky draw entry for %s on %s (game: %s)", userId, today, gameId);

  return JSON.stringify({
    entered: true,
    already_entered: false,
    draw_date: today,
    message: "You're in! Good luck in today's draw!"
  });
};

// ─── 9. Happy Hour Status ───────────────────────────────────────────────────

var rpcHappyHourStatus = function (ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var gameId = input.game_id;
  var now = nowSeconds();

  var active = false;
  var multiplier = 1;
  var timeRemaining = 0;
  var eventName = "";

  // Scan flash_events for happy_hour type
  var systemId = "00000000-0000-0000-0000-000000000000";
  try {
    var listed = nk.storageList(systemId, "flash_events", 100, "");
    if (listed && listed.objects) {
      for (var i = 0; i < listed.objects.length; i++) {
        var val = listed.objects[i].value;
        if (val.game_id === gameId && val.event_type === "happy_hour" &&
            val.start_time <= now && val.end_time > now) {
          active = true;
          multiplier = val.multiplier || 2;
          timeRemaining = val.end_time - now;
          eventName = val.event_name || "Happy Hour";
          break;
        }
      }
    }
  } catch (e) {
    logger.warn("Could not list flash events for happy hour: %s", e.message);
  }

  return JSON.stringify({
    active: active,
    multiplier: multiplier,
    time_remaining_seconds: timeRemaining,
    event_name: eventName,
    game_id: gameId
  });
};
