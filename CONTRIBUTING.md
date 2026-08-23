# Contributing

Contributions are welcome. This project automates frequently changing consumer web interfaces, so changes should stay small, fail closed around audio and microphone controls, and include focused tests.

## Development

Requirements for standard JavaScript, shell, extension, and browser work are macOS 13 or later, Google Chrome, Node.js 22 or 24 LTS, and npm. Xcode Command Line Tools are required only when changing or locally building the native audio components.

```bash
npm ci
npm test
```

Native audio source changes additionally require:

```bash
npm run test:native
npm run build:audio
```

Release package changes additionally require a development build with `npm run package:audio` followed by `npm run test:package`. Maintainers create the public, signed and notarized artifact with `npm run package:audio:release`; it is isolated under `dist/release/` and must pass the notarized package test before upload. The packaged `meetron-audioctl` is written in Swift, but no Swift toolchain is required to install or run the distributed PKG.

The browser UI test uses the locally installed Google Chrome. Set `MEETING_COPILOT_SKIP_BROWSER_TEST=1` only when Chrome is unavailable; run the full test before proposing user-interface or automation changes.

The one-click updater deliberately updates the existing checkout path so both Chrome profiles keep their unpacked-extension registration. It must preserve `.git`, `.meeting-copilot.env`, `.meeting-copilot-runtime`, and dedicated profile data; abort on tracked Git changes; and keep a working BlackHole or legacy custom backend instead of forcing the Meetron Audio PKG. Add migration coverage to `tests/updater-test.mjs` for every updater behavior change.

## Architecture and meeting providers

Meetron separates stable orchestration from provider-specific browser automation:

- `src/core/` owns protocol, session, preparation-result, and participant-state contracts.
- `src/browser/` owns provider-neutral Playwright helpers and dedicated Chrome page handling.
- `src/audio/` owns provider-neutral backend and meeting-device contracts.
- `src/platform/` owns platform, credential-store, installer, and OS-specific path or shortcut contracts.
  The current Community implementation registers only the macOS adapter;
  unsupported platforms must return `PLATFORM_UNSUPPORTED` instead of silently
  falling back to macOS paths.
- `src/providers/<provider>/` owns URL validation, selectors, status detection, microphone control, leaving, and provider capabilities.
- `src/providers/provider-registry.mjs` is the only runtime lookup point for a meeting provider.
- `scripts/prepare-*.mjs` own pre-join flows because provider DOMs and media initialization differ substantially. They must return the common `connection`, `microphone`, and `camera` fields from `createPreparationResult()`.
- `scripts/native-host.mjs` and the extension use canonical `session.*` and `participant.*` commands. Published `meeting.*`, `meet.*`, `dedicatedMeet`, and `meetMicrophone` names exist only as compatibility aliases.

To add a provider:

1. Add a provider module with a strict HTTPS URL normalizer and redacted `displayUrl`.
2. Declare its label, preparation entry point, and safety capabilities.
3. Implement `getStatus`, `setMicrophone`, and `leave`, then register the runtime provider.
4. Add a pre-join script that uses the shared CLI, browser, audio, and result helpers.
5. Add fixture tests for localized UI, microphone verification, admission states, URL-secret redaction, and leaving.

Do not put provider selectors or brand-specific state names in the Native Host, extension, or core modules. Audio and microphone failures must fail closed: never request admission when the pre-join microphone or camera safety state is unknown, except for an explicit manual-action result that leaves the dedicated browser open.

## Pull requests

- Do not commit `.meeting-copilot.env`, `.meeting-copilot-runtime`, meeting URLs, Project IDs, logs, cookies, or dedicated Chrome profiles.
- Add tests for command authorization, URL validation, microphone verification, and other changed behavior.
- Update user documentation when setup, permissions, storage, or operating steps change.
- Keep external dependencies minimal and document why a new dependency is necessary.
- Keep allocations, locks, file IO, and logging out of the audio driver's real-time callback.
- Confirm `npm audit --audit-level=high` before submitting.

## Developer Certificate of Origin

Meetron uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/)
instead of a copyright assignment. Sign off every commit with:

```bash
git commit -s
```

The `Signed-off-by` line certifies that you have the right to submit the work
under this project's GPL-3.0-only license. Do not sign off work copied from a
source whose license is unknown or incompatible. Existing third-party code and
Apple sample-derived code must retain their notices in
`THIRD_PARTY_NOTICES.md` and the relevant source directory.

By contributing, you agree that your contribution is licensed under
GPL-3.0-only and certify it under DCO 1.1. The project does not currently
require copyright assignment or grant a separate commercial relicensing right.
