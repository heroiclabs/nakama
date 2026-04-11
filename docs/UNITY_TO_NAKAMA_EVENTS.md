# Unity → Nakama Events & RPCs (Complete Inventory)

> **Project:** QuizVerse | **Generated:** 2026-04-11 | **Total RPCs:** 97+ | **Event Types:** 100+

---

## 1. Analytics & Session Tracking (IVXAnalyticsManager)

| RPC | Payload | Trigger |
|-----|---------|---------|
| `quizverse_log_event` | `{ gameID, eventName, properties, timestamp }` | Custom event tracking (flexible) |
| `quizverse_track_session_start` | `{ gameID, sessionKey, deviceInfo: { platform, version, deviceModel, os } }` | App opened |
| `quizverse_track_session_end` | `{ gameID, sessionKey, duration }` | App closed/backgrounded |

## 2. Satori Analytics (SatoriService — Buffered)

| RPC | Payload | Trigger |
|-----|---------|---------|
| `satori_event` | `{ name, timestamp, metadata }` | Single critical event (immediate) |
| `satori_events_batch` | `{ events: [{ name, timestamp, metadata }] }` | Auto-flush at 20 events |
| `satori_identity_get` | `{}` | Retrieve user identity properties |
| `satori_identity_update_properties` | `{ properties }` | Update user profile in Satori |
| `satori_flags_get_all` | `{}` | Fetch feature flags |

## 3. Onboarding (OnboardingNakamaClient)

| RPC | Payload | Trigger |
|-----|---------|---------|
| `onboarding_get_state` | `{}` | App start — fetch onboarding status |
| `onboarding_complete_step` | `{ stepId }` | User completes onboarding step |
| `onboarding_claim_welcome_bonus` | `{}` | Claim +50 coins welcome bonus |
| `onboarding_set_interests` | `{ interests: string[] }` | Select quiz categories |
| `onboarding_get_interests` | `{}` | Retrieve saved category preferences |
| `onboarding_first_quiz_complete` | `{ score, time, questions }` | First quiz done (claims bonus + streak shield) |
| `onboarding_get_tomorrow_preview` | `{}` | Personalized next-day quiz preview |
| `onboarding_create_link_quiz` | `{ url }` | AHA moment — quiz from shared URL |
| `onboarding_track_session` | `{ step, duration }` | Retention analytics tracking |
| `onboarding_get_retention_data` | `{}` | Fetch user retention metrics |

## 4. Quiz Results (IVXQuizResultsManager)

| RPC | Payload | Trigger |
|-----|---------|---------|
| `quiz_submit_result` | `{ quizId, score, time, answers, difficulty }` | User completes quiz |
| `quiz_get_history` | `{ limit, offset }` | Fetch past quiz results |
| `quiz_get_stats` | `{ period }` | Get user quiz statistics |

## 5. Leaderboards & Scoring

| RPC | Payload | Trigger |
|-----|---------|---------|
| `submit_score_and_sync` | `{ score, metadata }` | Submit quiz score to leaderboard |
| `get_all_leaderboards` | `{ limit, cursor }` | Fetch all active leaderboards |

## 6. Wallet & Economy

| RPC | Payload | Trigger |
|-----|---------|---------|
| `wallet_get_balances` | `{}` | Fetch current coins + tokens |
| `wallet_update_game_wallet` | `{ delta, reason }` | Add/deduct coins |

## 7. Daily Rewards & Missions

| RPC | Payload | Trigger |
|-----|---------|---------|
| `daily_rewards_get_status` | `{}` | Check daily reward status |
| `daily_rewards_claim` | `{ day }` | Claim daily reward |
| `get_daily_missions` | `{ day }` | Fetch daily mission list |
| `submit_mission_progress` | `{ missionId, progress }` | Update mission progress |
| `claim_mission_reward` | `{ missionId }` | Claim mission reward |

## 8. Rewarded Ads (RewardedAdClaimManager)

| RPC | Payload | Trigger |
|-----|---------|---------|
| `rewarded_ad_request_token` | Ad SDK token | User clicks ad placement |
| `rewarded_ad_claim` | `{ token, reward }` | Claim reward after viewing ad |
| `rewarded_ad_validate_score_multiplier` | Score multiplier data | Verify ad multiplier eligibility |
| `rewarded_ad_get_status` | `{ placement }` | Get ad placement status |

## 9. Clans (ClanManager)

| RPC | Payload | Trigger |
|-----|---------|---------|
| `create_game_group` | `{ name, description, isOpen }` | Create clan (500 gems) |
| `get_user_groups` | `{ limit }` | Fetch user's clans |
| `update_group_xp` | `{ clanId, xp }` | Add XP to clan |
| `get_clan_challenges` | `{ clanId }` | Fetch clan challenges |
| `contribute_clan_challenge` | `{ challengeId, points }` | Contribute to clan challenge |
| `get_clan_leaderboard` | `{ clanId, limit }` | Fetch clan member rankings |

## 10. Competitive Leagues (LeagueManager)

| RPC | Payload | Trigger |
|-----|---------|---------|
| `league_join` | League-specific | User joins/qualifies for league |
| `league_submit_score` | `{ score }` | Submit score during league season |
| `league_get_standings` | League-specific | Fetch current rankings |

## 11. Async Challenges (AsyncChallengeManager)

| RPC | Payload | Trigger |
|-----|---------|---------|
| `async_challenge_create` | Challenge creation data | Create challenge vs friend |
| `async_challenge_join` | `{ challengeId }` | Friend joins challenge |
| `async_challenge_get` | `{ challengeId }` | Fetch challenge details |
| `async_challenge_submit` | Quiz results data | Submit challenge results |
| `async_challenge_list` | `{ limit }` | Fetch active challenges |
| `async_challenge_cancel` | `{ challengeId }` | Cancel ongoing challenge |
| `async_challenge_stats` | `{ challengeId }` | Fetch challenge statistics |
| `async_challenge_rematch` | Challenge data | Request rematch |
| `async_challenge_leaderboard` | Leaderboard params | Fetch challenge rankings |

## 12. Characters & Cosmetics (CharacterManager)

| RPC | Payload | Trigger |
|-----|---------|---------|
| `character_unlock` | Character unlock data | User unlocks/purchases character |
| `character_equip` | `{ characterId }` | User equips character |
| `character_get_owned` | `{}` | Fetch owned characters |

## 13. Social / Friends (FriendsNakamaService)

| RPC | Payload | Trigger |
|-----|---------|---------|
| `friends_list` | Query params | Fetch friends list |
| `friends_block` | `{ userId }` | Block user |
| `friends_unblock` | `{ userId }` | Unblock user |
| `send_friend_invite` | `{ userId }` | Send friend request |
| `accept_friend_invite` | `{ userId }` | Accept friend request |
| `decline_friend_invite` | `{ userId }` | Decline friend request |
| `gift_send` | `{ recipientId, giftType, quantity }` | Send gift to friend |

## 14. User Profile & Auth (IVXNManager)

| RPC | Payload | Trigger |
|-----|---------|---------|
| `create_or_sync_user` | `{ userId, username, email, ... }` | First login / profile sync |
| `check_geo_and_update_profile` | `{ latitude, longitude, ... }` | Update geolocation |
| `rpc_update_player_metadata` | Player metadata (level, stats) | Update player profile |

## 15. Fortune Wheel (WeeklyFortuneWheelManager)

| RPC | Payload | Trigger |
|-----|---------|---------|
| `fortune_wheel_spin` | Spin data | User spins fortune wheel |
| `fortune_wheel_claim` | Reward claim data | Claim fortune wheel prize |

## 16. Conversion & Monetization Events (ConversionAnalytics → quizverse_log_event)

| Event Name | Sub-Events | Data |
|------------|-----------|------|
| Guest Conversion | `guest_conversion_prompt_shown`, `_started`, `_completed`, `_abandoned`, `guest_feature_blocked` | User progression, timestamps |
| IAP Funnel | `iap_trigger_shown`, `_clicked`, `iap_purchase_started`, `_completed`, `_failed` | Product ID, price, currency |
| Link & Play Promo | `lap_promo_shown`, `_clicked`, `lap_upload_started`, `_completed` | Promo ID, user segment |
| Social Actions | `social_promo_shown`, `social_action`, `invite_sent`, `challenge_started` | Action type, referral source |
| A/B Testing | `ab_test_assigned`, `ab_test_conversion` | Test ID, variant, conversion |

---

## Key Architecture Notes

- **All RPCs** use `await client.RpcAsync(session, rpcName, jsonPayload)`
- **Three analytics aggregators:** IVXAnalyticsManager (Nakama direct), SatoriService (buffered batch), ConversionAnalytics (funnel events routed via quizverse_log_event)
- **Satori auto-batches** at 20 events before flushing
- **All calls** are async with try-catch error handling
- **Session validation** checked before every RPC call
