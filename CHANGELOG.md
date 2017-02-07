# Change Log
All notable changes to this project are documented below.

The format is based on [keep a changelog](http://keepachangelog.com/) and this project uses [semantic versioning](http://semver.org/).

## [Unreleased]

### Added

- Add verbose command-line flag to enable debug logging and console output.

### Changed
- Update db schema to support 64 characters with device IDs. This enables `SystemInfo.deviceUniqueIdentifier` to be used as a source for device IDs on Windows 10.
- Logout messages now close the connection as well and won't reply.
- Change Logout message type from `TLogout` to `Logout`.
- Update TFriendAdd, TFriendRemove, TFriendBlock to accept UserID as bytes.

### Fixed

- Fix issue where random handle generator wasn't seeded properly.
- Fix issues in executing Friend and Storage queries.
- Fix sending Close frame message in the Websocket to gracefully close connection.

## [0.10.0] - 2017-01-14
### Added
- Initial public release.
