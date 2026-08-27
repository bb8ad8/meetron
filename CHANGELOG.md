# Changelog

Meetron follows [Semantic Versioning](https://semver.org/). This file records
user-visible changes; implementation-only refactors stay in Git history.

## [Unreleased]

### Fixed

- Zoom Webが`/wc/join/<会議ID>`から同一ページ内でURLを書き換える場合も、常駐操作パネルを表示してNative Host操作を許可。

## [0.10.1] - 2026-08-27

### Changed

- 会議画面の送信時に、撮影・送信中・完了・失敗を見分けられるシャッター／ステータスエフェクトを追加し、視差軽減設定にも対応。

## [0.10.0] - 2026-08-27

### Added

- Google Meet／Zoomの常駐パネルから、専用Chromeに表示中の会議画面をメモリ内JPEGとしてChatGPT Voiceの会話へ送る操作を追加。
- 同じGoogleアカウントが別デバイスですでに会議へ参加している場合の「このデバイスでも参加」フローに対応。

### Changed

- ChatGPT Webの現行統合Voice UIにある「音声設定」コントロールでもVoice起動状態を検出。
- ChatGPTへの画像添付を添付ボタン優先・複数シグナル・長めの待機で確認し、送信完了も入力欄またはユーザーメッセージで検証。失敗時は段階別コードとサニタイズ済み診断ログを残す。
- Meetのカメラ状態を自動確認できない場合を手動参加待ちとして扱い、参加前のマイク解除タイムアウトによって専用Chromeが終了しないよう修正。
- 拡張UIのマイク操作を明示的なミュート状態の設定へ変更し、通常の状態取得から重い会議修復処理を分離。Meet操作は待機の少ないDOM経路を優先し、表示はクリック直後に切り替えて失敗時だけ元へ戻す。

### Security

- 画面送信はGoogle Meet／Zoomの会議ページ上で行う明示的なユーザー操作だけを許可し、重複送信を防止。画像ファイルはローカルへ保存しない。

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

[Unreleased]: https://github.com/bb8ad8/meetron/compare/v0.10.1...HEAD
[0.10.1]: https://github.com/bb8ad8/meetron/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/bb8ad8/meetron/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/bb8ad8/meetron/releases/tag/v0.9.0
[0.8.1]: https://github.com/bb8ad8/meetron/releases/tag/v0.8.1
[0.8.0]: https://github.com/bb8ad8/meetron/releases/tag/v0.8.0
