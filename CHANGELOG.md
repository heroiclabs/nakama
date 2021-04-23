# Change Log
All notable changes to this project are documented below.

The format is based on [keep a changelog](http://keepachangelog.com) and this project uses [semantic versioning](http://semver.org).

## [Unreleased]
### Changed
- Change runtime group add/kick/promote/demote APIs to include optional callerID parameter for permission checking. If callerID is an empty string it defaults to the admin user.
### Fixed
- Fix reading Lua authoritative match states that contain functions.
- Correct path representation for embedded migrations and console files on Windows systems.

## [3.2.1] - 2021-04-19
### Changed
- A user's online indicator now observes the status mode rather than just socket connectivity.
- Update sql-migrate library to a32ed26.
- Rework some migrations for better compatibility with different database engines.
- Update to Protobuf v1.5.2, GRPC v1.37.0, and GRPC-Gateway v2.3.0 releases.
- Update to Bleve v2.0.3 release.
- Various other dependency updates.

### Fixed
- Fix user scoping in Nakama Console purchase listing view.

## [3.2.0] - 2021-04-14
### Added
- New API to logout and intercept logouts with session and refresh tokens.
- Add a leave reason to presence events to handle transient disconnects more easily.
- New API for IAP validation with Apple App Store, Google Play Store, and Huawei AppGallery.

### Changed
- Improve struct field alignment on types in the social package.
- Improve memory re-use within the matchmaker and match registry structures.
- Support Facebook Limited Login tokens received into the standard Facebook login/link/unlink functions.
- Update JS VM to newer version. This resolves an issue with resizing some JS arrays.
- Build with Go 1.16.3 release.

### Fixed
- Matchmaker entries which were only partially matched together could not combine with larger player counts.
- Fix bad inputs parsed in some before/after hook executions made from the API Explorer in the Console.
- Correctly return Unix timestamps in JS runtime functions returning users/accounts data.

## [3.1.2] - 2021-03-03
### Changed
- Sort match listings to show newer created matches first by default.
- Loosen status follow input validation and constraints to ignore unrecognised user IDs and usernames.
- Build with Go 1.16.0 release.
- Do not import Steam friends by default on Steam authentication.
- Do not import Facebook friends by default on Facebook authentication.
- Improve match label update batching semantics.
- Account object returned by some JS runtime functions are not flattened with user values anymore.

### Fixed
- Fix an issue in the JS runtime that would prevent the matchmaker matched callback to function correctly.
- Allow the console API to return large responses based on the configured max message size.
- Allow JS runtime initializer functions to be invoked inside a try/catch block.
- Fix Tournament Reset function hook schedules calcuated on first write if the end active time must be computed with no reset schedule.

## [3.1.1] - 2021-02-15
### Changed
- Go runtime logger now identifies the file/line in the runtime as the caller rather than the logger.
- Build with Go 1.15.8 release.
- Use a newer CA certificates package within the Docker containers.

### Fixed
- Fix an issue that prevented the JavaScript runtime hooks to be invoked correctly.
- Fix the delete button not working in the console leaderboard listing.
- GetUsers can fetch user accounts by Facebook ID the same as in the client API.

## [3.1.0] - 2021-02-04
### Added
- New APIs to import Steam friends into the social graph.

### Changed
- Improve output of "nakama migrate status" command when database contains unknown migrations.
- The socket status flag is now parsed as case-insensitive.
- Build with Go 1.15.7 release.

### Fixed
- Fix an issue with the JS runtime multiUpdate function.
- Fix an issue where the JS runtime would call the InitModule function twice.
- Fix how the JS runtime invokes matchmakerMatched and leaderboard/tournament related hooks.
- Fix JS VM not being put back into the pool after an RPC call.

## [3.0.0] - 2021-01-16

This is a major release of the server but **fully backwards compatible** with the 2.x releases.

### Added
- New JavaScript runtime to write server code.
- Introduce refresh tokens that can be used to refresh sessions.
- New Realtime Parties for users to create teamplay in games. Users can form a party and communicate with party members.
- Add party matching support to the Matchmaker.
- Add options to the Matchmaker to control how long tickets wait for their preferred match.
- Add Console UI permissions API.
- New "ReadFile" runtime function to read files within the "--runtime.path" folder.

### Changed
- Rebuild Console UI with Angular framework. Manage user data, update objects, restrict access to production with permission profiles, and gain greater visibility into realtime features like active matches.
- Matchmaker improvements to the process for matching and the handling of player count ranges.
- Authoritative match handlers can now tick at 60 per second.
- Support CockroachDB 20.2 release.
- Build with Go 1.15.6 release.

### Fixed
- Return rank field in Lua API for leaderboard record writes.
- Return social fields for users in friend listings.

## [2.15.0] - 2020-11-28
### Added
- Add cacheable cursor to channel message listings.
- Add group management functions to the server runtime. Thanks @4726.

### Changed
- Make metrics prefix configurable and set a default value.
- Pin the GRPC Go plugin for the protoc compiler with a tool dependency.
- Build with Go 1.15.5 release.
- Use the Facebook Graph API v9.0 version.
- Facebook authentication no longer requires access to gender, locale, and timezone data.
- Update to Bleve v1.0.13 release.
- Update to nakama-common 1.10.0 release.
- Skip logging Lua errors raised by explicit runtime calls to the `error({ msg, code })` function.

### Fixed
- Better handling of SSL negotiation in development with certs provided to the server.
- Use correct error message and response code when RPC functions receive a request payload larger than allowed.
- Expose missing 'group_users_kick' function to the Lua runtime.
- Fix an issue that would cause an error when trying to update a tournament record with invalid data.
- Fix some issues around listing tournaments.
- Fix an issue that would prevent the insertion of a record in a tournament with no scheduled reset and end time.
- Ensure the devconsole applies user password updates even if no other fields change.
- Fix third-party authentication ids not getting returned if queried through the friends graph.

## [2.14.1] - 2020-11-02
### Added
- Event contexts now contain user information for external events.
- Expose more metrics for socket activity.
- New [Docker release](https://hub.docker.com/repository/docker/heroiclabs/nakama-dsym) of the server with debug symbols enabled.
- Add "TournamentRecordsList" and "ListFriends" functions to the Go server runtime.
- Add "friends_list" and "tournament_records_list" functions to the Lua server runtime.

### Changed
- Build with Go 1.15.3 release.
- Update to Protobuf v1.4.3, GRPC v1.33.1, and GRPC-Gateway v2.0.1 releases.
- Update protocol definitions for OpenAPIv2 code generator.

### Fixed
- Fix score comparisons on leaderboard record ranks in cache. Thanks @4726.
- Put "rank" field into results from "tournament_records_haystack" calls in Lua server runtime.
- Add missing cursor return values from "GroupUsersList" and "UsersGroupList" functions in the Go server runtime.

## [2.14.0] - 2020-10-03
### Added
- Publish new metric for presences count.
- Use a "tool dependency" to specify the protoc-gen-go, protoc-gen-grpc-gateway, and protoc-gen-openapiv2 required versions. See [here](https://github.com/golang/go/wiki/Modules#how-can-i-track-tool-dependencies-for-a-module).

### Changed
- Build with Go 1.15.2 release.
- Update to Protobuf 1.4.2, GRPC 1.32.0, and GRPC-Gateway 2.0.0-beta.5. This enables us to take advantage of the new Protobuf runtime. See [here](https://blog.golang.org/protobuf-apiv2).
- Replace shell script with Go generate commands to run protoc toolchain.
- Update protocol definitions to remove warnings from stricter Go package import paths. See [here](https://developers.google.com/protocol-buffers/docs/reference/go-generated#package).
- Move some Go packages to be internal.
- Improved rank caching strategy.
- Separate authentication error response code and message for banned accounts.
- Pin to an older certs store in the Docker container to work around an issue with GeoTrust certificates.

## [2.13.0] - 2020-08-31
### Added
- Add Sign in with Apple authentication, link, and unlink.
- Wallet operations now return the previous and updated state of the wallet.
- New multi-update runtime function to handle batched storage, wallet, and account updates in a single transaction.
- Groups now have a demote API for convenience.

### Changed
- Build with Go 1.15.0 release.
- Sanitize metric names and properties fields.
- Wallet updates now use int64 values to ensure precision in all numeric operations.
- Update to nakama-common 1.7.3 release.
- Optimize how session IDs are stored in presence structs.
- Friend listings now allow a page size of up to 1000 objects.

### Fixed
- Prevent bad presence list input to dispatcher message broadcasts from causing unexpected errors.
- Extra HTTP headers in RPC responses are set before the response is written to the buffer.
- Fix an issue in the Lua runtime nk module's "jwt_generate" function that would prevent it from accepting a key in RS256 format.
- Fix an issue in the Lua runtime nk module's "rsaSHA256Hash" function that would prevent it from parsing the input private key.
- Unmatched routes in the Nakama Console server now return a 404 rather than a 401 response.

## [2.12.0] - 2020-05-25
### Added
- Print a log message when all authoritative messages have stopped during graceful shutdown.
- New option in Lua runtime for read-only globals to reduce memory footprint. This is enabled by default.
- Separate server config flags for socket read and write buffer sizes.
- Add user session scoped fields to authoritative match join attempt contexts.
- Add group ID to content of in-app notifications sent for with changes to groups.
- New runtime function to get a single match by ID.
- New runtime functions for link and unlink operations.
- New Lua runtime function to print a log message at debug level.
- Add disable time to account get operations in the server runtime.
- Expose last user relationship update time when listing friends.
- Expose caller information in logger messages.
- Expose node name in all runtime contexts.

### Changed
- Rebuild metrics implementation.
- Validate GOB encoded authoritative match create parameters.
- Eliminate user account writes to database if fields have not changed.
- The gauges in the Developer console status view more accurately reflect current server metrics.
- Disconnect match participants when a Lua runtime authoritative match ends due to an error.
- Sort wallet ledger listings by creation time from newest to oldest.
- Do not update leaderboard and tournament record timestamps when scores have not changed.
- Build with Go 1.14.3 release.
- Update to nakama-common 1.5.1 release.

### Fixed
- Fetch account in Lua runtime function now includes Facebook Instant Game IDs.
- Don't duplicate runtime environment values in the devconsole configuration view.
- All low-level channel presence events now populate room, group, and direct message fields.
- Developer console status graphs correctly show a fixed time window of metrics.
- Fix friend deletion in developer console user detail view.
- Fix group membership deletion in developer console user detail view.
- A user's password is no longer expected when unlinking emails.

## [2.11.1] - 2020-03-29
### Changed
- Update protobuf (1.3.5), websocket (1.4.2), opencensus (0.22.3), atomic (1.6.0), zap (1.14.1) dependencies.
- Update devconsole minimist (1.2.2), acorn (6.4.1) dependencies.
- Build with Go 1.14.1 release.

## [2.11.0] - 2020-02-27
### Added
- Return tournament end time in listing operations if one exists.
- Add Facebook Instant Game Authentication method.

### Changed
- Build with Go 1.14.0 release.
- Update most server dependencies (particularly GRPC, GRPC Gateway, and Protobuf).
- Upgrade to use nakama-common 1.4.0 release.

## [2.10.0] - 2020-02-13
### Added
- New metric for number of authoritative matches currently running.
- New metric for total number of events dropped by the events processor pool.

### Changed
- Build with Go 1.13.7 release.
- Update username on leaderboard and tournament records when processing a score update.
- Automatically stop empty authoritative matches after a configurable amount of time.

### Fixed
- Fix calculation for 'can enter' field for newly created tournaments.
- Ensure tournament reset callbacks carry the correct ID.
- Ensure tournament end callbacks carry the correct end and reset times.
- Expose match stopped state to the Lua runtime match dispatcher.
- Fix calculation of tournament start active time for schedules with variable active durations.

## [2.9.1] - 2020-01-14
### Changed
- Build with Go 1.13.6 release.
- Upgrade devconsole handlebars (4.3.0) dependency.

### Fixed
- Ensure tournament listing correctly uses the cursor on paginated requests.
- Passthrough GRPC Gateway Console requests to GRPC internally with authentication middleware active.

## [2.9.0] - 2019-12-23
### Added
- New runtime functions to retrieve tournaments by ID.
- Allow tournament duration to exceed reset window and cap the duration if it does.
- Ban group users which prevents them from rejoining or requesting to rejoin.
- New config parameter for max request message size separate from socket message size limit.

### Changed
- Do not use absolute path for `tini` executable in default container entry point.
- Faster validation of JSON object input payloads.
- Update IAP validation example for Android Publisher v3 API.
- Relayed multiplayer matches allow echoing messages back to sender if they're in the filter list.
- Upgrade Facebook authentication to use version 5.0 of the Facebook Graph API.
- Upgrade devconsole serialize-javascript (2.1.1) dependency.
- Ensure authoritative match dispatcher is no longer usable after match stops.
- Deferred message broadcasts now process just before match ends if match handler functions return an error.

### Fixed
- Correctly read pagination cursor in notification listings.
- Group user add no longer sends another channel message when an add operation is repeated.
- Importing Facebook friends when there are no friends and reset is true now works as expected.

## [2.8.0] - 2019-11-11
### Added
- New API for client and runtime events known as event signals.
- Allow user account password updates from the developer console.
- Runtime log messages are now tagged with their source runtime type.

### Changed
- Default runtime HTTP key value is no longer the same as the default server key value.
- A group create operation now returns a GRPC Code 6 (HTTP 409 Conflict) when the group name is already in use.
- Allow Console API requests to return results above default size limit.
- The presence count is no longer added together across nodes in the status view of the Developer Console.
- Create tournament operations always return the existing tournament after repeated calls with the same ID.
- Upgrade to Go 1.13.4 and use Debian buster-slim for base docker images.
- Rate limit the maximum number of concurrent leaderboard/tournament callback executions.
- Allow Go runtime match listing operations min/max count to be optional.

### Fixed
- Handle (OCC) errors when concurrently writing new storage objects.
- Fix optimistic concurrency controls (OCC) on individual storage objects under high write contention.
- Time spent metrics are now correctly reported in milliseconds.
- Password minimum length error message now correctly reflects the constraint.
- Set specific response Content-Type header in successful HTTP RPC responses.

## [2.7.0] - 2019-09-11
### Added
- Enable RPC functions to receive and return raw JSON data.
- Status follow operations now also accept usernames to follow.
- Pagination support for friends listing operations.
- Filtering by friend state in friends listing operations.
- Pagination support for group users listing operations.
- Filtering by user state in group users listing operations.
- Pagination support for user groups listing operations.
- Filtering by group state in user groups listing operations.
- Allow max count to be set when creating groups from client calls.
- Log better startup error message when database schema is not set up at all.
- New "check" command to validate runtime modules without starting the server.
- Add discrete channel identifier fields in all messages and message history listings.
- Session tokens now allow storage of arbitrary string key-value pairs.
- New runtime function for programmatic GDPR account data exports.

### Changed
- Use Go 1.13.0 on Alpine 3.10 as base Docker container image and native builds.
- Update devconsole lodash (4.17.13), lodash.template (4.5.0), eslint-utils (1.4.1), set-value (2.0.1), and mixin-deep (1.3.2) dependencies.
- Errors from runtime before hooks no longer close the session.
- Switch prometheus metrics to use labels instead of a prefix.
- Add flag on realtime socket messages that will support optional reliability.
- Friends listing pages are now limited to max 100 results each.
- Group users listing pages are now limited to max 100 results each.
- User groups listing pages are now limited to max 100 results each.
- Group users listing now includes disabled (banned) users.
- User groups listing now includes disabled groups.
- Remove hard cap on maximum number of users per group.
- Return deterministic ordering for edge relationship listings.
- Return deterministic ordering for storage listing operations.
- Return deterministic ordering for leaderboard scores where both score and subscore are identical.
- Consistent default database address between migration command and main server startup.
- Return deterministic ordering for group listings without filters.

### Fixed
- Handle updates during leaderboard schedule reset window.
- Ensure the matchmaker cannot match together tickets from the same session.
- Handle leaderboard deletes shortly before a scheduled reset.
- Listing user groups no longer returns an error when the user is a member of zero groups.
- Go runtime group creation now correctly validates max count.
- Consistent expiry calculation in leaderboard records haystack queries.
- Convert custom SQL query and exec parameters to integers when necessary in Lua runtime.
- Correctly validate users before adding them to groups.
- Add missing group chat channel message when a user joins the group.
- Add missing group chat channel message when a user leaves the group.
- Add missing group chat channel message when a user is added to the group.
- Add missing group chat channel message when a user is kicked from the group.
- Add missing group chat channel message when a user is promoted in the group.
- Handle TIMESTAMPTZ return types in Lua runtime custom SQL queries.
- Use consistent upper bound for authoritative match label size.

## [2.6.0] - 2019-07-01
### Added
- Explicitly set cache control header in all API responses.
- Add support for CockroachDB 19.1.
- Add tournament start active timestamp to the API response.
- Add overridable expiry time when listing leaderboard/tournaments records.

### Changed
- Tournament start time can be set to past time.
- Update GRPC (1.21.1), GRPC-Gateway (1.9.2), Protobuf (1.3.1), Mux (1.7.2), and OpenCensus (0.22.0) dependencies.
- Use Go 1.12.6 as base Docker container image and native builds.
- Move from dep to Go modules for dependency management.
- Switch database driver from pq to pgx.
- Update devconsole handlebars (4.1.2) and js-yaml (3.13.1) dependencies.
- Update community link in console sidebar.

### Fixed
- Fix delayed first time invocation of tournament and leaderboard callbacks.
- Expired tournaments will no longer be listed nor any records will be returned.
- Unlink device identifiers on console user account details page.
- Add missing index drop on migrate down.
- Handle query and parameter resets on wallet update retries.
- Reset list of friend IDs in Facebook import when retrying the operation.
- Reset notifications in friend add when retrying the operation.
- Do not return storage list cursor unless there are further objects.
- Attempt fast user and storage count on partitioned tables in console API.

## [2.5.1] - 2019-05-03
### Changed
- Storage object get operations now also return the user ID if the owner is the root user.
- Status view on console no longer refreshes if server is not reachable.
- Adjust default socket ping and pong heartbeat frequency.

### Fixed
- Display updated counters on console status page.
- Render friend names on console user details page.
- Render group names on console user details page.
- Do not attempt to navigate to groups from console user details page.
- Render changed wallet value after update on console user details page.
- Display custom ID, email, and verification time on console user details page.
- Add missing placeholder text to fields on console user details page.
- Re-render the console storage view when deleting records.

## [2.5.0] - 2019-04-25
### Added
- New developer console UI available on http://127.0.0.1:7351.
- New Lua runtime functions to generate JWT tokens.
- New Lua runtime functions to hash data using RSA SHA256.
- Print max number of OS threads setting in server startup logs.

### Changed
- Log more information when authoritative match handlers receive too many data messages.
- Ensure storage writes and deletes are performed in a consistent order within each batch.
- Ensure wallet updates are performed in a consistent order within each batch.
- Increase default socket pong wait time.
- Ensure leaderboard record metadata, number of scores, and update time are only changed during leaderboard write operations if the score or subscore change.

### Fixed
- Storage write batches now correctly abort when any query in the batch fails.
- Rank cache correctly calculates record expiry times.
- Return correct response to group join operations when the user is already a member of the group.
- Fix query when selecting a page of leaderboard records around a user.

## [2.4.2] - 2019-03-25
### Added
- New programmatic console API for administrative server operations.
- Initial events subsystem with session start+end handlers.

### Changed
- Update GRPC (1.19.0), GRPC-Gateway (1.8.4), and Protobuf (1.3.0) dependencies.
- Use Go 1.12.1 as base Docker container image and native builds.

## [2.4.1] - 2019-03-08
### Added
- Strict validation of socket timeout configuration parameters.
- New Go runtime constants representing storage permissions.
- New runtime function to programmatically delete user accounts.
- Allow multiple config files to be read at startup and merged into a final server configuration.
- Storage listing operations can now disambiguate between listing system-owned data and listing all data.

### Changed
- Default maximum database connection lifetime is now 1 hour.
- Improved parsing of client IP and port for incoming requests and socket connections.
- WebSocket sessions no longer log the client IP and port number in error messages.
- Go and Lua server runtime startup log messages are now consistent.
- All schema and query statements that use the '1970-01-01 00:00:00' constant now specify UTC timezone.
- Storage write error message are more descriptive for when values must be encoded JSON objects.
- Storage listing operations now treat empty owner IDs as listing across all data rather than system-owned data.
- Storage write operations now return more specific error messages.

### Fixed
- CRON expressions for leaderboard and tournament resets now allow concurrent usage safely.
- Set console API gateway timeout to match connection idle timeout value.

## [2.4.0] - 2019-02-03
### Added
- New logging format option for Stackdriver Logging.
- New runtime function to immediately disconnect active sockets.
- New runtime function to kick arbitrary presences from streams.

### Fixed
- Fix return arguments for group user list results in Lua runtime function.
- Leaderboard records returned with a previous page cursor no longer errors.

## [2.3.2] - 2019-01-17
### Fixed
- Set gateway timeout to match idle timeout value.
- Reliably release database resources before moving from one query to the next.
- Unlock GPGS certs cache in social client.

## [2.3.1] - 2019-01-04
### Added
- Make authoritative match join attempt marker deadline configurable.

### Changed
- Improve db transaction semantics with batch wallet updates.

### Fixed
- Initialize registration of deferred messages sent from authoritative matches.
- Early cancel Lua authoritative match context when match initialization fails.
- Update decoding of Steam authentication responses to correctly unwrap payload. Thanks @nielslanting
- Parse Steam Web API response errors when authenticating Steam tokens.

## [2.3.0] - 2018-12-31
### Added
- WebSocket connections can now send Protobuf binary messages.
- Lua runtime tournament listings now return duration, end active, and end time fields.
- Lua runtime tournament end hooks now contain duration, end active, and end time fields.
- Lua runtime tournament reset hooks now contain duration, end active, and end time fields.
- New configuration flag for maximum number of concurrent join requests to authoritative matches.
- New runtime function to kick users from a group.
- Clients that send data to an invalid match ID will now receive an uncollated error.
- The logger now supports optional log file rotation.
- Go runtime authoritative matches now also print Match IDs in log lines generated within the match.
- Email authentication client requests can authenticate with username/password instead of email/password.
- Email authentication server runtime calls can authenticate with username/password instead of email/password.
- New authoritative match dispatcher function to defer message broadcasts until the end of the tick.
- New runtime function to retrieve multiple user accounts by user ID.
- Send notifications to admins of non-open groups when a user requests to join.
- Send notifications to users when their request to join a group is accepted.
- New configuration flag for presence event buffer size.

### Changed
- Replace standard logger supplied to the Go runtime with a more powerful interface.
- Rename stream 'descriptor' field to 'subcontext' to avoid protocol naming conflict.
- Rename Facebook authentication and link 'import' field to avoid language keyword conflict.
- Rejoining a match the user is already part of will now return the match label.
- Allow tournament joins before the start of the tournament active period.
- Authoritative matches now complete their stop phase faster to avoid unnecessary processing.
- Authoritative match join attempts now have their own bounded queue and no longer count towards the match call queue limit.
- Lua runtime group create function now sets the correct default max size if one is not specified.
- Improve socket session close semantics.
- Session logging now prints correct remote address if available when the connection is through a proxy.
- Authoritative match join attempts now wait until the handler acknowledges the join before returning to clients.

### Fixed
- Report correct execution mode in Lua runtime after hooks.
- Use correct parameter type for creator ID in group update queries.
- Use correct parameter name for lang tag in group update queries.
- Do not allow users to send friend requests to the root user.
- Tournament listings now report correct active periods if the start time is in the future.
- Leaderboard and tournament reset runtime callbacks now receive the correct reset time.
- Tournament end runtime callbacks now receive the correct end time.
- Leaderboard and tournament runtime callbacks no longer trigger twice when time delays are observed.
- Check group max allowed user when promoting a user.
- Correct Lua runtime decoding of stream identifying parameters.
- Correctly use optional parameters when they are passed to group creation operations.
- Lua runtime operations now observe context cancellation while waiting for an available Lua instance.
- Correctly list tournament records when the tournament has no end time defined.

## [2.2.1] - 2018-11-20
### Added
- New duration field in the tournament API.

### Fixed
- Set friend state correctly when initially adding friends.
- Allow tournaments to be created to start in the future but with no end time.
- Join events on tournaments with an end time set but no reset now allow users to submit scores.

## [2.2.0] - 2018-11-11
### Added
- New runtime function to send raw realtime envelope data through streams.

### Changed
- Improve error message on database errors raised during authentication operations.
- Set new default of 100 maximum number of open database connections.
- Friendship state is no longer offset by one when sent to clients.
- Group membership state is no longer offset by one when sent to clients.
- Set new default metrics report frequency to 60 seconds.

### Fixed
- Account update optional inputs are not updated unless set in runtime functions.
- Fix boolean logic with context cancellation in single-statement database operations.

## [2.1.3] - 2018-11-02
### Added
- Add option to skip virtual wallet ledger writes if not needed.

### Changed
- Improved error handling in Lua runtime custom SQL function calls.
- Authoritative match join attempts are now cancelled faster when the client session closes.

### Fixed
- Correctly support arbitrary database schema names that may contain special characters.

## [2.1.2] - 2018-10-25
### Added
- Ensure runtime environment values are exposed through the Go runtime InitModule context.

### Changed
- Log more error information when InitModule hooks from Go runtime plugins return errors.
- Preserve order expected in match listings generated with boosted query terms.

### Fixed
- Improve leaderboard rank re-calculation when removing a leaderboard record.

## [2.1.1] - 2018-10-21
### Added
- More flexible query-based filter when listing realtime multiplayer matches.
- Runtime function to batch get groups by group ID.
- Allow authoritative match join attempts to carry metadata from the client.

### Changed
- Improved cancellation of ongoing work when clients disconnect.
- Improved validation of dispatcher broadcast message filters.
- Set maximum size of authoritative match labels to 2048 bytes.

### Fixed
- Use leaderboard expires rather than end active IDs with leaderboard resets.
- Better validation of tournament duration when a reset schedule is set.
- Set default matchmaker input query if none supplied with the request.
- Removed a possible race condition when session ping backoff triggers concurrently with a timed ping.
- Errors returned by InitModule hooks from Go runtime plugins will now correctly halt startup.

## [2.1.0] - 2018-10-08
### Added
- New Go code runtime for custom functions and authoritative match handlers.
- New Tournaments feature.
- Runtime custom function triggers for leaderboard and tournament resets.
- Add Lua runtime AES-256 util functions.
- Lua runtime token generator function now returns a second value representing the token's expiry.
- Add local cache for in-memory storage to the Lua runtime.
- Graceful server shutdown and match termination.
- Expose incoming request data in runtime after hooks.

### Changed
- Improved Postgres compatibility on TIMESTAMPTZ types.

### Fixed
- Correctly merge new friend records when importing from Facebook.
- Log registered hook names correctly at startup.

## [2.0.3] - 2018-08-10
### Added
- New "bit32" backported module available in the code runtime.
- New code runtime function to create MD5 hashes.
- New code runtime function to create SHA256 hashes.
- Runtime stream user list function now allows filtering hidden presences.
- Allow optional request body compression on all API requests.

### Changed
- Reduce the frequency of socket checks on known active connections.
- Deleting a record from a leaderboard that does not exist now succeeds.
- Notification listings use a more accurate timestamp in cacheable cursors.
- Use "root" as the default database user if not specified.

### Fixed
- Runtime module loading now correctly handles paths on non-UNIX environments.
- Correctly handle blocked user list when importing friends from Facebook.

## [2.0.2] - 2018-07-09
### Added
- New configuration option to adjust authoritative match data input queue size.
- New configuration option to adjust authoritative match call queue size.
- New configuration options to allow listening on IPv4/6 and a particular network interface.
- Authoritative match modules now support a `match_join` callback that triggers when users have completed their join process.
- New stream API function to upsert a user presence.
- Extended validation of Google signin tokens to handle different token payloads.
- Authoritative match labels can now be updated using the dispatcher's `match_label_update` function.

### Changed
- Presence list in match join responses no longer contains the user's own presence.
- Presence list in channel join responses no longer contains the user's own presence.
- Socket read/write buffer sizes are now set based on the `socket.max_message_size_bytes` value.
- Console GRPC port now set relative to `console.port` config value.

## [2.0.1] - 2018-06-15
### Added
- New timeout option to HTTP request function in the code runtime.
- Set QoS settings on client outgoing message queue.
- New runtime pool min/max size options.
- New user ban and unban functions.
- RPC functions triggered by HTTP GET requests now include any custom query parameters.
- Authoritative match messages now carry a receive timestamp field.
- Track new metrics for function calls, before/after hooks, and internal components.

### Changed
- The avatar URL fields in various domain objects now support up to 512 characters for FBIG.
- Runtime modules are now loaded in a deterministic order.

### Fixed
- Add "ON DELETE CASCADE" to foreign key user constraint on wallet ledger.

## [2.0.0] - 2018-05-14

This release brings a large number of changes and new features to the server. It cannot be upgraded from v1.0 - reach out for help to upgrade.

### Added
- Authenticate functions can now be called from the code runtime.
- Use opencensus for server metrics. Add drivers for Prometheus and Google Cloud Stackdriver.
- New API for users to subscribe to status update events from other users online.
- New API for user wallets to store and manage virtual currencies.
- Realtime multiplayer supports authoritative matches with a handler and game loop on the server.
- Matches can be listed on the server for "room-based" matchmaker logic.
- "run_once" function to execute logic at startup with the code runtime.
- Variables can be passed into the server for environment configuration.
- Low level streams API for advanced distributed use cases.
- New API for export and delete of users for GDPR compliance.

### Changed
- Split the server protocol into request/response with GRPC or HTTP1.1+JSON (REST) and WebSockets or rUDP.
- The command line flags of the server have changed to be clearer and more explicit.
- Authenticate functions can now take username as an input at account create time.
- Use TIMESTAMPTZ for datetimes in the database.
- Use JSONB for objects stored in the database.
- Before/after hooks changed to distinguish between req/resp and socket messages.
- Startup messages are more concise.
- Log messages have been updated to be more useful in development.
- Stdlib for the code runtime uses "snake_case" consistently across variables and function names.
- The base image for our Docker images now uses Alpine Linux.

### Fixed
- Build dependencies are now vendored and build system is simplified.
- Database requests for transaction retries are handled automatically.

### Removed
- The storage engine no longer needs a "bucket" field as a namespace. It was redundant.
- Leaderboard haystack queries did not perform well and need a redesign.
- IAP validation removed until it can be integrated with the virtual wallet system.

---

## [1.4.1] - 2018-03-30
### Added
- Allow the server to handle SSL termination of client connections although NOT recommended in production.
- Add code runtime hook for IAP validation messages.

### Changed
- Update social sign-in code for changes to Google's API.
- Migrate code is now cockroach2 compatible.

### Fixed
- Fix bitshift code in rUDP protocol parser.
- Fix incorrect In-app purchase setup availability checks.
- Cast ID in friend add queries which send notifications.
- Expiry field in notifications now stored in database write.
- Return success if user is re-added who is already a friend.

## [1.4.0] - 2017-12-16
### Changed
- Nakama will now log an error and refuse to start if the schema is outdated.
- Drop unused leaderboard 'next' and 'previous' fields.
- A user's 'last online at' field now contains a current UTC milliseconds timestamp if they are currently online.
- Fields that expect JSON content now allow up to 32kb of data.

### Fixed
- Storage remove operations now ignore records that don't exist.

## [1.3.0] - 2017-11-21
### Added
- Improve graceful shutdown behaviour by ensuring the server stops accepting connections before halting other components.
- Add User-Agent to the default list of accepted CORS request headers.
- Improve how the dashboard component is stopped when server shuts down.
- Improve dashboard CORS support by extending the list of allowed request headers.
- Server startup output now contains database version string.
- Migrate command output now contains database version string.
- Doctor command output now contains database version string.

### Changed
- Internal operations exposed to the script runtime through function bindings now silently ignore unknown parameters.

### Fixed
- Blocking users now works correctly when there was no prior friend relationship in place.
- Correctly assign cursor data in paginated leaderboard records list queries.
- Improve performance of user device login operations.

## [1.2.0] - 2017-11-06
### Added
- New experimental rUDP socket protocol option for client connections.
- Accept JSON payloads over WebSocket connections.

### Changed
- Use string identifiers instead of byte arrays for compatibility across Lua, JSON, and client representations.
- Improve runtime hook lookup behaviour.

### [1.1.0] - 2017-10-17
### Added
- Advanced Matchmaking with custom filters and user properties.

### Changed
- Script runtime RPC and HTTP hook errors now return more detail when verbose logging is enabled.
- Script runtime invocations now use separate underlying states to improve concurrency.

### Fixed
- Build system no longer passes flags to Go vet command.
- Haystack leaderboard record listings now return correct results around both sides of the pivot record.
- Haystack leaderboard record listings now return a complete page even when the pivot record is at the end of the leaderboard.
- CRON expression runtime function now correctly uses UTC as the timezone for input timestamps.
- Ensure all runtime 'os' module time functions default to UTC timezone.

## [1.0.2] - 2017-09-29
### Added
- New code runtime function to list leaderboard records for a given set of users.
- New code runtime function to list leaderboard records around a given user.
- New code runtime function to execute raw SQL queries.
- New code runtime function to run CRON expressions.

### Changed
- Handle update now returns a bad input error code if handle is too long.
- Improved handling of accept request headers in HTTP runtime script invocations.
- Improved handling of content type request headers in HTTP runtime script invocations.
- Increase default maximum length of user handle from 20 to 128 characters.
- Increase default maximum length of device and custom IDs from 64 to 128 characters.
- Increase default maximum length of various name, location, timezone, and other free text fields to 255 characters.
- Increase default maximum length of storage bucket, collection, and record from 70 to 128 characters.
- Increase default maximum length of topic room names from 64 to 128 characters.
- Better error responses when runtime function RPC or HTTP hooks fail or return errors.
- Log a more informative error message when social providers are unreachable or return errors.

### Fixed
- Realtime notification routing now correctly resolves connected users.
- The server will now correctly log a reason when clients disconnect unexpectedly.
- Use correct wire format when sending live notifications to clients.

## [1.0.1] - 2017-08-05
### Added
- New code runtime functions to convert UUIDs between byte and string representations.

### Changed
- Improve index selection in storage list operations.
- Payloads in `register_before` hooks now use `PascalCase` field names and expose correctly formatted IDs.
- Metadata regions in users, groups, and leaderboard records are now exposed to the code runtime as Lua tables.

### Fixed
- The code runtime batch user update operations now process correctly.

## [1.0.0] - 2017-08-01
### Added
- New storage partial update feature.
- Log warn messages at startup when using insecure default parameter values.
- Add code runtime function to update groups.
- Add code runtime function to list groups a user is part of.
- Add code runtime function to list users who're members of a group.
- Add code runtime function to submit a score to a leaderboard.
- Send in-app notification on friend request.
- Send in-app notification on friend request accept.
- Send in-app notification when a Facebook friend signs into the game for the first time.
- Send in-app notification to group admins when a user requests to join a private group.
- Send in-app notification to the user when they are added to a group or their request to join a private group is accepted.
- Send in-app notification to the user when someone wants to DM chat.

### Changed
- Use a Lua table with content field when creating new notifications.
- Use a Lua table with metadata field when creating new groups.
- Use a Lua table with metadata field when updating a user.
- Updated configuration variable names. The most important one is `DB` which is now `database.address`.
- Moved all `nakamax` functions into `nakama` runtime module.
- An invalid config file or invalid cmdflag now prevents the server from startup.
- A matchmake token now expires after 30 instead of 15 seconds.
- The code runtime `os.date()` function now returns correct day of year.
- The code runtime context passed to function hooks now use PascalCase case in fields names. For example `context.user_id` is now `context.UserId`.
- Remove `admin` sub-command.
- A group leave operation now returns a specific error code when the last admin attempts to leave.
- A group self list operations now return the user's membership state with each group.

## [1.0.0-rc.1] - 2017-07-18
### Added
- New storage list feature.
- Ban users and create groups from within the code runtime.
- Update users from within the code runtime.
- New In-App Purchase validation feature.
- New In-App Notification feature.

### Changed
- Run Facebook friends import after registration completes.
- Adjust command line flags to be follow pattern in the config file.
- Extend the server protocol to be batch-orientated for more message types.
- Update code runtime modules to use plural function names for batch operations.
- The code runtime JSON encoder/decoder now support root level JSON array literals.
- The code runtime storage functions now expect and return Lua tables for values.
- Login attempts with an ID that does not exist will return a new dedicated error code.
- Register attempts with an ID that already exists will return a new dedicated error code.

### Fixed
- The runtime code for the after hook message was set to "before" incorrectly.
- The user ID was not passed into the function context in "after" authentication messages.
- Authentication messages required hook names which began with "." and "\_".
- A device ID used in a link message which was already in use now returns "link in use" error code.

## [0.13.1] - 2017-06-08
### Added
- Runtime Base64 and Base16 conversion util functions.

### Fixed
- Update storage write permissions validation.
- Runtime module path must derive from `--data-dir` flag value.
- Fix parameter mapping in leaderboard haystack query.

## [0.13.0] - 2017-05-29
### Added
- Lua script runtime for custom code.
- Node status now also reports a startup timestamp.
- New matchmaking feature.
- Optionally send match data to a subset of match participants.
- Fetch users by handle.
- Add friend by handle.
- Filter by IDs in leaderboard list message.
- User storage messages can now set records with public read permission.

### Changed
- The build system now suffixes Windows binaries with `exe` extension.

### Fixed
- Set correct initial group member count when group is created.
- Do not update group count when join requests are rejected.
- Use cast with leaderboard BEST score submissions due to new strictness in database type conversion.
- Storage records can now correctly be marked with no owner (global).

## [0.12.2] - 2017-04-22
### Added
- Add `--logtostdout` flag to redirect log output to console.
- Add build rule to create Docker release images.

### Changed
- Update Zap logging library to latest stable version.
- The `--verbose` flag no longer alters the logging output to print to both terminal and file.
- The log output is now in JSON format.
- Update the healthcheck endpoint to be "/" (root path) of the main server port.

### Fixed
- Fix a race when the heartbeat ticker might not be stopped after a connection is closed.

## [0.12.1] - 2017-03-28
### Added
- Optionally allow JSON encoding in user login/register operations and responses.

### Changed
- Improve user email storage and comparison.
- Allow group batch fetch by both ID and name.
- Increase heartbeat server time precision.
- Rework the embedded dashboard.
- Support 64 characters with `SystemInfo.deviceUniqueIdentifier` on Windows with device ID link messages.

### Fixed
- Fix Facebook unlink operation.

## [0.12.0] - 2017-03-19
### Added
- Dynamic leaderboards feature.
- Presence updates now report the user's handle.
- Add error codes to the server protocol.

### Changed
- The build system now strips up to current dir in recorded source file paths at compile.
- Group names must now be unique.

### Fixed
- Fix regression loading config file.

## [0.11.3] - 2017-02-25
### Added
- Add CORS headers for browser games.

### Changed
- Update response types to realtime match create/join operations.

### Fixed
- Make sure dependent build rules are run with `relupload` rule.
- Fix match presence list generated when joining matches.

## [0.11.2] - 2017-02-17
### Added
- Include Dockerfile and Docker instructions.
- Use a default limit in topic message listings if one is not provided.
- Improve log messages in topic presence diff checks.
- Report self presence in realtime match create and join.

### Changed
- Improve warn message when database is created in migrate subcommand.
- Print database connections to logs on server start.
- Use byte slices with most database operations.
- Standardize match presence field names across chat and realtime protocol.
- Improve concurrency for closed sockets.

### Fixed
- Enforce concurrency control on outgoing socket messages.
- Fix session lookup in realtime message router.
- Fix input validation when chat messages are sent.
- Fix how IDs are handled in various login options.
- Fix presence service shutdown sequence.
- More graceful handling of session operations while connection is closed.
- Fix batch user fetch query construction.
- Fix duplicate leaves reported in topic presence diff messages.

## [0.11.1] - 2017-02-12
### Changed
- Server configuration in dashboard is now displayed as YAML.
- Update server protocol to simplify presence messages across chat and multiplayer.

### Fixed
- Work around a limitation in cockroachdb with type information in group sub-queries.

## [0.11.0] - 2017-02-09
### Added
- Add `--verbose` flag to enable debug logs in server.
- Database name can now be set in migrations and at server startup. i.e. `nakama --db root@127.0.0.1:26257/mydbname`.
- Improve SQL compatibility.

### Changed
- Update db schema to support 64 characters with device IDs. This enables `SystemInfo.deviceUniqueIdentifier` to be used as a source for device IDs on Windows 10.
- Logout messages now close the server-side connection and won't reply.
- Rename logout protocol message type from `TLogout` to `Logout`.
- Update server protocol for friend messages to use IDs as bytes.

### Fixed
- Fix issue where random handle generator wasn't seeded properly.
- Improve various SQL storage, friend, and group queries.
- Send close frame message in the websocket to gracefully close a client connection.
- Build system will now detect modifications to `migrations/...` files and run dependent rules.

## [0.10.0] - 2017-01-14
### Added
- Initial public release.

