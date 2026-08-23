# Releasing Meetron Community

Only maintainers with access to the Developer ID and notarization credentials
can create the public Meetron Audio package. Never place signing keys,
notarization credentials, meeting URLs, account data, or local runtime files in
a release directory.

## 1. Prepare the source

1. Start from a clean worktree on the intended release commit.
2. Update `package.json`, `package-lock.json`, and
   `extension/manifest.json` to the same Meetron version.
3. Update the native audio version in its Swift source and packaging defaults
   when the audio component changed.
4. Move relevant entries from `CHANGELOG.md`'s Unreleased section into a dated
   release section.
5. Confirm `README.md`, `SUPPORT.md`, `SECURITY.md`, `PRIVACY.md`, and
   `THIRD_PARTY_NOTICES.md` are current.

## 2. Verify the source

```bash
npm ci
npm test
npm audit --audit-level=high
npm run test:native
npm run package:audio
npm run test:package
```

The full local test must run with Google Chrome installed. CI may skip browser
fixtures only because its runners do not have the required interactive Chrome
environment.

## 3. Build Meetron Audio

Create a new version rather than overwriting an existing notarized artifact.

```bash
npm run package:audio:release
MEETRON_REQUIRE_NOTARIZED=1 npm run test:package -- \
  dist/release/MeetronAudio-AUDIO_VERSION.pkg
```

Verify all of the following before continuing:

- `pkgutil --check-signature` identifies `Developer ID Installer: Yuki Inaba`.
- `xcrun stapler validate` succeeds.
- `spctl --assess --type install` accepts the package.
- The package contains arm64 and x86_64 binaries with macOS 13.0 deployment
  targets.
- The adjacent SHA-256 file validates.

## 4. Optionally build a Community archive

```bash
npm run package:community -- \
  --audio-pkg dist/release/MeetronAudio-AUDIO_VERSION.pkg
```

The public source is available from Git clone and GitHub's standard Download
ZIP, so a dedicated Community archive is optional. The packager is useful for
offline transfer or for bundling the audio PKG with the source. It refuses a
dirty worktree unless `--allow-dirty` is supplied for a local test. That
override adds `LOCAL-TEST` to the file and root-directory name so it cannot be
confused with a release artifact. Never publish a `LOCAL-TEST` artifact.

## 5. Test the distributed files

Use a different Mac or a clean macOS user account. Test both a new setup and an
upgrade from the latest public version.

- Confirm Gatekeeper accepts the audio PKG.
- Confirm source-distributed `.command` files accurately follow the documented
  Gatekeeper exception flow when a downloaded source directory is quarantined.
- Confirm a working BlackHole installation is preserved and does not trigger
  Meetron Audio installation.
- Confirm an older Meetron Audio receipt triggers only the required PKG update.
- Confirm neither path changes macOS default input or output.
- Confirm the unpacked extension continues to use the same path after update.
- Run a non-confidential Google Meet test and an optional Zoom beta test.

## 6. Publish

1. Create an annotated SemVer tag.
2. Create a GitHub Release from that tag.
3. Attach the notarized audio PKG and its SHA-256 file. If a dedicated Community
   ZIP is published, attach its SHA-256 file as well and verify that neither
   filename contains `LOCAL-TEST`.
4. Copy the matching CHANGELOG section into the release notes and clearly mark
   beta features and best-effort platforms.
5. Do not move or replace assets after publication; publish a new patch version.
