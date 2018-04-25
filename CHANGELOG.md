# Change Log
All notable changes to this project are documented below.

The format is based on [keep a changelog](http://keepachangelog.com/) and this project uses [semantic versioning](http://semver.org/).

## [Unreleased]

## [1.4.3] - 2018-04-25
### Changed
- Improve storage remove transactional behaviour.

## [1.4.2] - 2018-04-22
### Changed
- Improve handling of transactional retries.

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
