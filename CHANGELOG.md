# Change Log
All notable changes to this project are documented below.

The format is based on [keep a changelog](http://keepachangelog.com/) and this project uses [semantic versioning](http://semver.org/).

## [Unreleased]
### Added
- Add `--verbose` flag to enable debug logs in server.
- Database name can now be set in migrations and at server startup. i.e. `nakama --db root@127.0.0.1:26257/mydbname`.
- Improve SQL compatibility.

### Changed
- Update db schema to support 64 characters with device IDs. This enables `SystemInfo.deviceUniqueIdentifier` to be used as a source for device IDs on Windows 10.
- Logout messages now close the server-side connection and won't reply.
- Rename logout protocol message type from `TLogout` to `Logout`.
- Update server protocol for friend messages to use IDs as bytes.

### Fixed
- Fix issue where random handle generator wasn't seeded properly.
- Improve various SQL storage, friend, and group queries.
- Send close frame message in the websocket to gracefully close a client connection.
- Build system will now detect modifications to `migrations/...` files and run dependent rules.

## [0.10.0] - 2017-01-14
### Added
- Initial public release.
