# Changelog

Meetron follows [Semantic Versioning](https://semver.org/). This file records
user-visible changes; implementation-only refactors stay in Git history.

## [Unreleased]

## [0.9.0] - 2026-08-24

### Added

- Zoom Web App beta support with invitation URL detection, browser join,
  localized pre-join handling, Meetron audio routing, microphone control, and
  leaving.
- Provider-neutral session, participant-state, browser, and local protocol
  contracts for Google Meet and Zoom.
- Platform, audio-backend, credential-store, and installer contracts that keep
  macOS implementation details out of the public core.
- Community source archive validation, DCO enforcement, contribution templates,
  support policy, and a reproducible release checklist.
- A source-distribution updater that preserves the existing unpacked-extension
  path, local configuration, runtime state, Git metadata, and dedicated Chrome
  profile.
- Migration support that keeps a working BlackHole 2ch / 16ch backend without
  installing or modifying Meetron Audio.

### Changed

- Product and extension versions are prepared for `0.9.0`; Meetron Audio is
  prepared for `0.1.2`.
- Chrome automation connects with Playwright CDP compatibility defaults needed
  by recent Chrome versions.
- Meeting microphone control now shares provider-neutral behavior while
  retaining provider-specific selectors and verification.
- Popup diagnostics are presented as user-facing state instead of a raw log.

### Security

- Zoom invitation passcodes use standard input between long-running local
  processes and are excluded from persisted state, logs, and extension storage.
- Native Messaging commands use a versioned allowlisted protocol and validate
  the calling extension origin.
- Unknown camera, microphone, audio-routing, or admission states fail closed.

## [0.8.1] - 2026-08-22

### Added

- Signed and notarized Meetron Audio PKG distribution for macOS 13 or later.
- Browser-scoped audio routing that leaves macOS default input and output
  unchanged.
- Universal Binary packaging and Apple Silicon / Intel CI coverage.

### Changed

- Renamed the public project and repository from Meeting Copilot to Meetron
  while preserving compatibility identifiers used by installed users.

## [0.8.0] - 2026-08-21

### Added

- Initial self-hosted Meetron Audio driver and native Core Audio controller.
- Required aggregate CI check for supported macOS runners.

[Unreleased]: https://github.com/bb8ad8/meetron/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/bb8ad8/meetron/releases/tag/v0.9.0
[0.8.1]: https://github.com/bb8ad8/meetron/releases/tag/v0.8.1
[0.8.0]: https://github.com/bb8ad8/meetron/releases/tag/v0.8.0
