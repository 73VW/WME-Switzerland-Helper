# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.2] - 2025-12-11

### Fixed
- Fixed public transport stops loading all stops on script reload when checkbox was pre-checked. Layer state is now restored after `wme-ready` event to ensure venues data is available before filtering duplicate stops.

## [1.2.1] - 2025-12-10

### Changed
- Initial release with Swiss map layers and public transport stops integration.
