# Change Log
All notable changes to this project are documented below.

The format is based on [keep a changelog](http://keepachangelog.com) and this project uses [semantic versioning](http://semver.org).

:warning: This server code is versioned separately to the download of the [Hiro game framework](https://heroiclabs.com/hiro/). :warning:

## [1.28.0] - 2025-10-07
### Added
- Add function to fetch user with Team profile.

### Changed
- If Team or user within an active Event Leaderboard has been deleted, skip using an empty score record.
- (Unity) Update to '3.20.0' Nakama/Satori .NET client release.

### Fixed
- Do not allow re-claiming rewards if Team gift count is exactly equal to reward min count.
- When an Inventory Item is consumed for Rewards, ensure rolled currencies are accumulated.

## [1.27.1] - 2025-09-30
### Changed
- Update to Nakama 3.32.0 version on the nakama-common 1.42.0 release.

## [1.27.0] - 2025-09-30
### Added
- New function to get a Team by ID.
- Delete an Item by instance ID in Inventory.
- New benchmark suite with [Artillery](https://www.artillery.io/) for load tests.
- (Unity) (TypeScript) (Dart) (CPP) (Unreal) (Godot) (Python) Add client functions for all new features.

### Changed
- An Event Leaderboard score update can submit metadata which is passed through to the underlying Leaderboard.
- A Challenge score update can decide if metadata should be updated on score change.
- (Unity) Update to '3.19.0' Nakama/Satori .NET client release.
- Add user ID and other inputs into Economy logger for debugging.

### Fixed
- "RewardGrant" in server function should correctly grant Rewards which have no Inventory Items.
- (Unity) Allow negative Economy grants to work in Offline Mode.
- If set, use config source in Inventory consume function.
- (Unity) Apply Energy refill increments in Offline Mode.
- (Unity) Track score changes in Event Leaderboards while in Offline Mode.
- Pass AvatarUrl into Team update function.
- If set, apply collection resolver in Challenges invite function.
- Use the input UNIX time when a Team Gift is claimed.
- In custom matching function use correct tier override in Event Leaderboards.
- Fix regression when rolled Reward contents are granted with "RewardGrant" and "GrantItems".
- Progressions marked as permanently unlocked should remain unlocked even if an item precondition becomes unmet.
- Expired Mailbox Messages should be pruned at client read time.
- Fix Achievement replay when auto-reset is enabled and claim when max count is zero.

## [1.26.0] - 2025-08-13
### Added
- A Progression can be defined to allow its counts to be updated irrespective of any other preconditions.
- If enabled, a Challenge score's metadata is updated only when the score itself changes.
- A Progression can be defined to unlock permanently rather than have its state be computed.
- Each player now has a Reward Mailbox which can be used to receive Rewards to be collected.
- Huge redesign of the Teams gameplay system. This provides a very powerful set of features for Guilds, Clans, and other teamplay game design.
- A Team can now earn currencies into a Team Wallet.
- A Team can spend currencies in the Team Virtual Store for Rewards.
- A Team can collect Inventory which could be consumed for the benefits of all team members.
- A Team can make progress on Team Achievements with optional reset schedules.
- A Team can compete on Team Event Leaderboards with individual contributions part of the team's score.
- A Team can generate Team Gifts for players with different Rewards based on their activity.
- A Team can track Team Stats about any statistics that are interesting to players.
- A Team has a Team Reward Mailbox where Rewards can be sent to be collected.
- Players can be restricted to be joined to only one Team at any time.
- Players can have their activity and Team activity measured to track the frequency of play.
- A Reward in all gameplay systems can be directed to grant it into Reward Mailbox.
- When rolled into an Event Leaderboard cohort, the player's leaderboard record metadata can be set.
- When rolled into a Team Event Leaderboard cohort, the Team player's leaderboard record metadata can be set.
- A Streak can be defined with repeating claimable Rewards.
- (Unity) (TypeScript) (Dart) (CPP) (Unreal) (Godot) (Python) Add functions for all new features.

### Changed
- The Reward definition is greatly extended to support Team Rewards and grants to individual players.
- Update to Nakama 3.30.0 version on the nakama-common 1.40.0 release.
- The Challenge gameplay system can now emit analytics events about activity.
- Team icon field is replaced by the avatar URL field.
- Teams no longer use "min_entry" metadata parameter on Create.
- Event Leaderboard cohorts cannot be rolled when the previous cohort Reward is unclaimed.
- Streak Reward(s) should define no "max_count" to allow them to be claimed beyond their initial eligible step.

### Fixed
- "StoragePersonalizer" type now recognizes Challenge definitions in the Nakama Storage engine.
- Update JSON schema for Stats to include the latest fields.
- TotalReward when claimed on an Achievement has its timestamp updated.
- Set the Start Step correctly when a non-default value is used in a Tutorial definition.
- Fix how new/updated Items are updated in local state on Grant operations.
- Treat Item(s) as newly granted when granted as an Item's Reward.
- The "AllowFakeReceipts" option in Economy definition should be copied into Personalizers.

## [1.25.0] - 2025-07-17
### Added
- A Challenge can be created with custom metadata.
- (Unreal) The Hiro Online Subsystem (OSSv1) for Identity, Achievements, and Leaderboards is no longer in preview.
- (Python) New Python Hiro GDK also with Nakama Leaderboards support.
- A "PurchaseIntent" can now provide optional ISO currency code and amount.
- (Unity) Automatically set ISO currency code and amount in "PurchaseIntent" with "UnityPurchasingSystem" type.

### Changed
- Update to Nakama 3.28.0 version on the nakama-common 1.38.0 release.
- The category field is now optional in Hiro data definitions which use it.
- (Unity) Update to '3.17.0' Nakama/Satori .NET client release.
- AppLovin Max S2S callbacks for rewarded video Placements are updated for the latest changes of the API.

### Fixed
- Set "TotalClaimTimeSec" on Achievement update if claim count reached and "AutoClaimTotal" is enabled.

## [1.24.0] - 2025-06-03
### Added
- Add JSON schema and example data definition for Challenges.
- (Unity) Add "conditionalUpdateMetadata" to update method in "EventLeaderboardSystem" type.
- Add new Energy Modifiers for refill, count, and max.
- (Unity) Streaks progress can be calculated Offline and synchronized to server.

### Changed
- (Unity) POCOs are now public to ease integration into custom RPCs and other SDKs.
- (CPP) (Dart) (Godot) (Unreal) Update client impls with changes.

### Fixed
- Register Challenges with "SatoriPersonalizer" type.
- Invert parameter behaviour with Event Leaderboard score update metadata exclusion.
- Fix edge case where a rolled reward can grant too many reward items.
- (Unity) Enforce Inventory Item max count when in Offline Mode.

## [1.23.0] - 2025-05-19
### Added
- New gameplay system called Challenges for players to compete with each other on private leaderboards.
- (Unreal) New [Blueprints](https://dev.epicgames.com/documentation/en-us/unreal-engine/blueprints-visual-scripting-in-unreal-engine) support for all Hiro features.
- New Dart client for all Hiro features.

### Changed
- When a score with metadata is changed on an Event Leaderboard, its metadata can be excluded.
- Use default values if Economy Reward ranges are unset in definition.
- (Unreal) Optimize parse response with string iterators.
- Update TypeScript client with all the latest Hiro features.
- (Unity) Modernize analytics systems and default taxonomy.
- (Unity) Achievement progress can be calculated Offline and synchronized to server.

### Fixed
- (Unreal) Resolve all warnings in code generated types with 5.4 or newer.
- (Unity) When a player leaves a Team, update state to unset membership and other fields.
- (Unity) When an Inventory Item is consumed while Offline correctly calculate delta changes.
- Return updated Energy Modifiers as part of Economy Ack responses.
- (CPP) Use "std::variant" to parse "google.protobuf.Struct" types.
- (Unity) Correctly update view state of player Stats when back Online.
- (Unity) Correctly update view state of player Inventory when back Online.
- Do not store Inventory Item properties in storage which originate in Item definition.
- (Unity) Return filtered Inventory codex if category field is set.
- Reduce contention in Event Leaderboard entry participation to minimize retries.

## [1.22.0] - 2025-02-14
### Added
- Add "claim_count" field to Streaks gameplay system.
- A Donation now tracks and allows claiming from individual contributors.
- Inventory has a new lifecycle hook to allow Item IDs to be validated externally.
- Add List function to Event Leaderboards.

### Changed
- Update to Nakama 3.26.0 version on the nakama-common 1.36.0 release.
- Username generator will not replace a username set as part of first account creation.
- Update JSON schema for Streaks gameplay system.
- Leaderboards can now use score operator directly from the Nakama SDK type.
- The root ID is now stored in metadata with generated Event Leaderboard IDs.
- (Unity) Use ReadOnlyCollection with Donations gameplay system.
- (Unity) Purchase Intents will always be sent if multiple Store Items share the same SKU code.
- Event Leaderboard rolls include retry backoff logic to minimize contention.
- (Unity) Notification package is updated to use 2.4.0 release.
- Expired donations are garbage collected only after claimed.

### Fixed
- Use Preserve annotation to retain System and other type constructors with IL2CPP builds.
- Return Tier name with Event Leaderboard tiers in responses.
- Fix custom Tier selector in first Event Leaderboard roll logic.
- Rewards in Streaks which are achieved in intermediate steps can also be claimed.
- (Unity) [Fake Store](https://docs.unity3d.com/Packages/com.unity.purchasing@4.12/manual/WhatIsFakeStore.html) is now recognised by the Economy Store system.
- Idle activity in Event Leaderboard active phases does not demote incorrectly.
- Fix queue start calculation with Unlockables when an early unlock is spent.
- Weighted rewards in weight value is copied correctly in a deep clone.
- (Unity) Inventory gameplay system decodes JSON to type correctly with updates.
- Progressions reset CRON expression is calculated with the correct offset.

## [1.21.0] - 2024-11-22
### Added
- New Auctions lifecycle function hook for "OnCancel".
- All Event Leaderboards can be listed (optionally) with scores.
- Lifecycle hooks for Tutorials system which can be used to implement server-side rewards.

### Changed
- Update to Nakama 3.25.0 version on the nakama-common 1.35.0 release.
- Incentive codes can be set never to expire with a 0 (zero) end time.
- Stats with zero values are returned rather than assumed to be zeroed out on the client.
- All definitions for gameplay systems are stripped of byte-order marker (BOM) for better Windows compatibility.
- Event Leaderboards now use a content hash ID to allow easier changes to their configuration with LiveOps.
- More efficient memory usage with cached Feature Flags in Satori Personalizer.

### Fixed
- Inventory items marked with keep zero are kept when granted with zero in initialize user.
- (Unity) Use Energies dictionary keys only with applying offline updates.
- Always set username, display name, and avatar URL with non-debug players in Event Leaderboard scores.
- (Unity) Store Items which have the same SKU product ID are found through "WithStoreSpecificID".
- Don't throw error when all reward tiers in an Event Leaderboard are empty.
- Unlockable purchases to reduce time left should apply against final remainder cost.
- Use If-None-Match OCC in Event Leaderboard roll when using a custom selection function.
- Energy rewards should have "AvailableRewards" field returned when spend succeeds.
- Inventory items which are rolled but not granted should increment grant count except if overflow is allowed.
- Apply cohort selection storage bucket lock when using custom cohort selection function.

## [1.20.0] - 2024-10-26
### Added
- New Auctions lifecycle function hooks for "OnClaimBid", "OnClaimCreated", and "OnClaimCreatedFailed".
- New "Publisher" interface which can be registered to provide analytics to a separate service.
- Economy store items can be marked as "unavailable" which makes them visible to the player but not purchaseable.

### Changed
- Return more detailed error messages with malformed inputs in "StoragePersonalizer" upload RPC.
- Cohort selection can force a new cohort and specific tier on fallback in Event Leaderboards.
- "SatoriPersonalizer" type now also implements the "Publisher" type.
- (Unity) Update "ExampleCoordinator" type to use refresh signal in Satori client.
- Use any registered personalizers to apply definition changes in Leaderboards gameplay system.
- Dynamically create Leaderboards if a personalizer has added ones not previously seen at server startup.
- (Unity) Use "UnityPurchasingSystem" observer to fetch additional products on previously unseen store item SKUs.
- Update to Achievement progress now act the same way as other gameplay systems by returning the latest state in the Ack returned.

### Fixed
- Improve how malformed input is handled in the "StoragePersonalizer" type with upload RPC.
- (Unreal) Fix generated code on some non-map custom types in Hiro protocol.
- Update Auctions definition JSON example to use correct format.
- Trim older rewards which have already been claimed in a Streak.
- Fix registration of Tutorials reset RPC function.

## [1.19.0] - 2024-10-06
### Added
- New Streaks gameplay system to allow players to accumulate rewards with win streaks.
- A tutorial can now be reset so its steps can be played again.
- (Unity) Subscribe to chat history and other updates in a Team with a "Nakama.ISocket".

### Changed
- A custom cohort created with Event Leaderboards can be forced to build a new cohort rather than fallback on the builtin matchmaker behaviour.
- Inventory grant items now returns items which were not granted but generated as part of the reward roll for the player.
- Teams can now be searched over by their language tag field.
- Migrate to Buf tool for Protobuf Go code generation.

### Fixed
- Fix errors in JSON schema for Auctions feature.
- Economy virtual store soft currency purchases did not generate "purchaseCompleted" events.
- (Unity) Use a hash implementation with chat messages which can be compared for ordering.
- (Unity) Update internal state when a join request which is accepted in Teams system.

## [1.18.0] - 2024-09-16
### Added
- New Auctions gameplay system to allow players to offer and bid on Inventory items.

### Changed
- The contents of the Energies sync sub-message had some fields renamed for clarity.
- Inventory and Economy can now optionally grant over the max count defined against an Item.
- Additional checks are used to perform Economy initialize user in case raw SQL has been used on account creation.
- Godot support is now packaged within Hiro releases.

### Fixed
- Active modifiers are correctly returned in Economy refresh and ACKs.
- (Unity) Team chat messages now use an appropriate `IComparer` for sorted order.

## [1.17.0] - 2024-08-05
### Added
- New "UnlockAdvance" function to advance the unlock of an active Unlockable.
- Add OpenAPI v3 spec which can be used by API clients like [Bruno](https://www.usebruno.com/), Insomnia, etc.
- (Unity) Google Play Games and Apple Sign-in are included as new integrations.
- Inventory items can be filtered by category.
- Inventory items can be restricted when granted with category and item set limits.
- (Unity) Energy can now be granted to the player directly as well as part of a reward.

### Changed
- Expose the cohort ID which the user has been assigned to within the active phase of the Event Leaderboard.
- Economy can now be configured to accept fake receipts and process grants for development.
- Allow Achievements to have a max count of 0 (zero) and be claimable only after preconditions are completed.

### Fixed
- Progression counts on top level entities were not set in some API responses.
- Handle "null" description and avatar URL with Teams search gracefully.
- Purchased unlocks should also contribute towards the next queued unlockable start.
- Use substitute transaction ID for Discord test purchases.

## [1.16.0] - 2024-07-07
### Added
- Virtual store now supports [Discord In-App Purchases](https://github.com/discord/embedded-app-sdk/blob/main/docs/in-app-purchases.md).
- Event Leaderboard debug functions can now use "targetCount", "subscoreMin", and "subscoreMax" as optional parameters.

### Changed
- Inventory system will keep zero count items in the player's storage if "keep_zero" is enabled.
- Use named return arguments in Go interfaces for improved readability.
- Any active reward modifiers are returned in "EconomyUpdateAck" responses.
- Unlockables which have completed but are not yet claimed do not count towards the active (in-use) slots.
- Fake users in Event Leaderboards are given zero scores rather than have no score set.
- (Unity) Update "ExampleCoordinator" for improved offline mode example.
- Stats system now observes "resolveCollection" for gameplay system's state.

### Fixed
- (Unity) Confirm pending purchase even if non-consumable products exist on an Apple ID but are not known to the Virtual Store.
- (Unity) Fix queued unlocks which are not updated in the gameplay system's state.
- Fix "RewardGrant" error when energy system is not in use.
- (Unity) Remove various usages of "System.Linq" from codebase.
- Fix error on publish of Satori events about store items with no rewards.
- Fix energy "Spend" did not return aggregate rewards in response.

## [1.15.0] - 2024-06-22
### Added
- Unlockables can now be queued to unlock when stored within slots.
- New "max_queued_unlocks" param to restrict how many Unlockables can be queued to unlock.
- Add "metadata" field to Event Leaderboard score updates.

### Changed
- The "OnReward" hooks now include the ID of the gameplay system entity which is the source of the reward.
- "PlacementStart" can take additional metadata as the context of what started the rewarded video placement.
- (Unity) (TypeScript) (CPP) (Unreal) Add functions for new queued Unlockables.
- Do not return an error when Inventory grant operations result in no change.
- (Unity) Switch over all enumerable data types to use "IReadOnlyCollection" to expose the "Count" field.
- A small Unlockable gameplay system design changed so an Unlockable can be started even if another Unlockable which was active is completed but not claimed yet.

### Fixed
- Any active Reward Modifiers are returned in various gameplay system ACK responses.
- The Unlockables state now retains "null" in the list to indicate their position in the available slots.

## [1.14.0] - 2024-06-09
### Changed
- Update to Nakama 3.22.0 version on the nakama-common 1.32.0 release.
- Update dependency which include Protobuf 1.34.1 release.
- Leaderboard record metadata can be passed into score writes with Event Leaderboards.
- (Unity) Fix request object sent with "DebugRandomScores" function in Event Leaderboards.
- (Unity) Handle edge case where incorrectly defined Rewards within a hard currency purchase could leave the purchase in pending state.
- (Unity) Rename "DebugRandomScores" to "DebugRandomScoresAsync" to follow C# naming conventions.

### Fixed
- Prevent a panic when consuming an Inventory Item but the Energy system has not been initialized.
- Fix non-stackable Inventory Item grants which could go beyond the max count defined.
- Use "reward" key name in Achievements JSON schema definition.

## [1.13.0] - 2024-06-02
### Added
- A Nakama Console import file to make it easy to set up storage objects for the "StoragePersonalizer" type.
- Add debug functions to help with QA on Event Leaderboards.
- Add "UnregisterDebugRpc" to clear the implementation of all debug functions across gameplay systems.

### Changed
- (Unity) When the "NakamaSystem" is refreshed, reauthenticate if needed. This is useful when a logout has been performed or auto refresh in the "Nakama.Client" has been disabled.
- (Unity) The Nakama and Satori client dependencies are updated to their 3.12.0 releases.
- Refactor the "SatoriPersonalizer" for more modularity.
- An Event Leaderboard now contains "CurrentTimeSec" (UNIX time) same as an Achievement type.

### Fixed
- In some reward types ensure we create multiple Inventory items when "non-stackable" is enabled.
- Don't return stale wallet values in sync RPC responses.

## [1.12.0] - 2024-05-26
### Added
- Support custom matchmaker properties with Event Leaderboards.
- Inventory items and Economy store items can be disabled.
- (Unity) Add "GetWallet" by enum as an extension to the "IApiAccount" type.
- (Unity) Add "GetPublicStats" by enum as an extension to the "IApiUser" type.
- (Unity) Add "GetPrivateStats" by enum as an extension to the "IApiUser" type.

### Changed
- (Unity) "GetRecordsAsync" in "LeaderboardsSystem" can now return more than 100 records.
- (Unity) "GetItemCodexAsync" in "InventorySystem" can now take category as an optional input.

### Fixed
- Fix JSON schema "tier_change" validation rule in Event Leaderboards.

## [1.11.0] - 2024-05-19
### Added
- Add "UnregisterRpc" to clear the implementation of one or more of the RPCs registered by gameplay systems in Hiro.
- Add helper function to convert "AvailableRewardsContents" type to an "EconomyConfigRewardContents" type.
- The "SatoriPersonalizer" can now cache data definitions within the lifecycle of a request if enabled.

### Changed
- The "ForceNetworkProbe" can now be switched between true/false at runtime.
- The collection name used to store data per player can be (optionally) set.
- Explicitly include "unordered_map" in CPP generated output for Windows platform.
- Run Economy initialize user before any custom after authentication hook.

### Fixed
- (Unity) Fix how currencies are decoded when values are larger than "int32.MaxSize".
- Fix incorrect WARN message at startup with some Economy reward data definition validations.
- Add "type" field to JSON schemas for Incentives, Progressions, and Stats.
- Add "max_count" field to JSON schema in Economy.

## [1.10.0] - 2024-04-12
### Added
- (Unity) Add function to write score to regional leaderboards.

### Changed
- Use "omitempty" in marshaler settings with data definition structs.
- Improve error response codes in inventory and economy operations.
- "max_repeat_rolls" is now returned in the "AvailableRewards" type.
- Update to nakama-common v1.31.0 to be compatible with newer Nakama releases.
- Inventory "GrantItems" now returns the modified inventory and also the specific item instances which were granted.
- Use unsigned integers with the reward range type.
- Inventory items granted as part of a reward can now have their instance properties rolled at the same time.
- (Unity) Expose client and session types in the SatoriSystem type.
- (Unity) Update to latest Nakama and Satori SDK dependencies.

### Fixed
- Fixed unrecognized Inventory system type in storage personalizer.
- Restore behaviour where inventory items inherit their properties from the definition and those property keys are not stored in storage.
- (Unity) Fixed batch update function with player stats.
- Satori integration to publish analytics events correctly reads configuration parameters.
- (Unity) Detect UnityPurchasing 'fake' store and warn prices will have mock values.

## [1.9.0] - 2024-02-04
### Added
- New option "max_repeat_rolls" to set how many duplicate rows of rolled rewards can occur.
- The "StoragePersonalizer" can now update data definitions with a S2S RPC function.
- Progressions can now be programmatically reset.

### Changed
- The "SatoriPersonalizer" can optionally send analytics events for each gameplay system.

### Fixed
- (Unity) Fix visibility modifier with "StatUpdate" class.
- Set energy modifiers into server response with Energies spend function.
- Fix item properties not set when items are granted as part of user initialization.
- Fix unlockable slots populated in the wrong order when overflow slots are enabled.

## [1.8.1] - 2024-01-20
### Added
- New "UnmarshalWallet" function to get a Hiro wallet from a Nakama "\*api.Account" type.

### Changed
- Use clearer error messages in Personalizer middleware.
- Apply Satori identity authorization before Economy initialize user is processed.

### Fixed
- Use stable order when inter-dependent achievement progress updates are counted.
- Don't throw an error on reward grants if Energies system is uninitialized.

## [1.8.0] - 2023-12-27
### Added
- Add switches for core and authenticate events to be sent by the "SatoriPersonalizer".
- Add "instance_id" field to response in Inventory Item type.
- Allow the "Personalizer" type to be added as a chain of transforms to each gameplay's data definition.
- Achievement updates can now be sent as a batch to change different counts on multiple achievements at the same time.
- Progressions can now define a reset schedule similar to Achievements.
- New "StoragePersonalizer" type which can use Nakama's storage engine to manage gameplay data definitions.
- Progression "Reset" can be used to manually reset progress on a progression node (i.e. to reset a quest).
- (Unity) VContainer DI example is now packaged with the Unity package.
- (Unity) Add "IsClaimed" computed field to Achievement type.
- (Unity) Wrap "Satori.IClient" methods in "SatoriSystem" type for simpler code.
- Stats can update multiple different stats in a single request.
- (Unity) Progression IDs can optionally be sent to receive deltas for a portion of the progression graph.

### Changed
- Update nakama-common to v1.30.1 release.
- (Unreal) Update "HiroClient" with newest features.
- (TypeScript) Update "HiroClient" with newest features.
- Return instanced item rewards in response type when consumed.
- The "refill" and "refill_sec" fields are always populated in an Energy type (even if at max value).
- The builtin "SatoriPersonalizer" now (optionally) uses Satori Live Events to configure Event Leaderboards.
- Economy "Grant" now takes an optional wallet metadata input to record a reason in the Nakama ledger.
- A user who has not submitted any score to an Event Leaderboard is not eligible for rewards or promotions.
- Use Nakama's builtin Facebook Instant purchase validation function in the Economy system.
- If Satori is configured and enabled always authenticate server-side (rather than just new players).

### Fixed
- Some outdated or missing definitions and schemas have been updated.
- Don't throw an error when the sender claim has no reward defined.
- (Unity) Add the Preserve attribute to some types at the class level to avoid code stripping issues in Unity IL2CPP.
- (Unity) Notify observers should not be called twice in the Progression system.
- Energies granted in rewards should be returned immediately rather than the previous stale value.
- (Unity) Don't throw an error if Achievement category is unset or empty.
- (Unity) Use platform specific preprocessor statements with Unity Mobile Notifications system.
- Fix variable shadow error with how data definition of sub-achievements are populated in responses.
- Economy weighted table rewards should escape early if a valid reward row has already been granted.

## [1.7.0] - 2023-10-24
### Added
- New error type "ErrItemsNotConsumable" for Inventory items which are not consumable.

### Changed
- Energies "Grant" now returns a player's updated energies.
- "Get" will return an empty state for an Event Leaderboard when a player has never had a previous cohort.
- Add "locked" field to the storage engine index used with Event Leaderboard cohort generation.
- (Unity) Improve "InventorySystem" to use observer pattern.

### Fixed
- (Unity) Use "PurchaseFailureDescription.reason" with Unity IAP package for error messages.
- Sender claim uses the newer internal operation in Incentives system.
- Do not shadow parent Reward when it is created to be granted in Achievements system.
- (Unity) Use an async pattern in "IStoreListener.ProcessPurchase" with Unity IAP package.

## [1.6.0] - 2023-10-15
### Added
- Add fields for "is_active", "can_claim", and "can_roll" for simpler client code with Event Leaderboards.
- (Unity) Add "IncentivesSystem".
- New "max_overflow" field to the data definition for Energies.

### Changed
- (Unity) Allow both "IEconomyListStoreItem" and "IEconomyLocalizedStoreItem" to be used in purchase flows.

### Fixed
- Use Inventory after the Progression purchase has been applied to calculate the latest Progression deltas.
- Energy counts granted as an Economy Reward are kept as overflow.
- Fix panic in progression precondition comparison.
- Batch economy changes which resolve to items removed are now marked correctly.
- (Unity) Serialize the input for Inventory update items request correctly to JSON.
- Fix to progression deltas computations.

## [1.5.0] - 2023-10-04
### Added
- Add server interface for the Incentives gameplay system.
- Cohort selection in Event Leaderboards can now be overridden with a custom function.

### Changed
- "Get" in the Progression gameplay system now returns a delta of Progression Nodes who's state has changed if a previous graph is passed to it.

## [1.4.0] - 2023-09-14
### Added
- New function to "Roll" a new cohort with an Event Leaderboard in an active phase.
- Each Progression Node can now contain multiple counts for local progress to be expressed.

### Fixed
- Update Event Leaderboard cohort search for Nakama 3.17.1 release.

## [1.3.0] - 2023-09-07
### Added
- New gameplay system called Progression to express Saga Maps, RPG Quests, and other game mechanics.
- Event Leaderboards can now express promotion and demotion zones with percentages.

### Changed
- An Event Leaderboard which is active but no cohort has been assigned now returns a precondition failed on claim.

## [1.2.0] - 2023-08-29
### Added
- Add server interface for Stats gameplay system.

### Changed
- Pin dependencies to compatible versions of Nakama common at v1.28.1.
- Return all Reward Tiers when an Event Leaderboard is fetched for the current user.

### Fixed
- Fix weighted reward error when definition is empty (instead of nil).

## [1.1.0] - 2023-08-23
### Added
- Add server interface for Event Leaderboards gameplay system.

## [1.0.4] - 2023-08-22
### Changed
- Add ChannelMessageAck message to proto definition.

### Fixed
- Expose server functions for reward and roll in Hiro.

## [1.0.3] - 2023-08-10
### Added
- Add enum value options to proto definition as code generation hints for Unreal Engine.

### Changed
- Update to Nakama 3.17.0 release.

## [1.0.2] - 2023-07-11
### Changed
- Find the binary lookup path relative to Nakama modules dir.

## [1.0.1] - 2023-07-11
### Changed
- Pin dependencies to compatible versions of Nakama common at v1.27.0.

## [1.0.0] - 2023-07-10
### Added
- Initial public commit.
