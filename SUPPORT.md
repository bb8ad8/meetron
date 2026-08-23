# Support

Meetron Community is an experimental, source-distributed OSS project. Support
is best effort and is provided only for the latest version on the default
branch or the latest GitHub Release.

## Support matrix

| Component | Status |
| --- | --- |
| macOS 26 on Apple Silicon | Primary development and real-meeting test environment |
| macOS 13 or later on Apple Silicon | Supported; older releases are not supported |
| macOS 13 or later on Intel | Best effort; Universal Binary and CI build coverage |
| Google Chrome official build | Required |
| Node.js 22 or 24 LTS | Supported |
| Google Meet | Beta |
| Zoom Web App guest join | Optional beta |
| Zoom desktop application automation | Not supported |
| Windows, Linux, mobile | Not supported in the current Community release |
| BlackHole 2ch / 16ch | Existing-user migration backend only |

Chrome, ChatGPT Web, Google Meet, and Zoom Web App are upstream services whose
interfaces can change without notice. A supported local environment does not
guarantee uninterrupted automation after an upstream UI change.

## Before opening an issue

1. Update to the latest version without discarding local changes.
2. Run `npm ci` and `npm test`.
3. Run `./scripts/check-env.sh`.
4. Reproduce with a meeting that contains no confidential information.
5. Remove meeting URLs, Zoom passcodes, Project identifiers, cookies, account
   names, and authentication information from every attachment.

Include the Meetron version, macOS version, chip architecture, Chrome version,
Node.js version, selected audio backend, expected result, actual result, and a
minimal reproduction. A redacted
`.meeting-copilot-runtime/meeting-launch.log` may be useful.

Use GitHub Issues for reproducible bugs and focused feature proposals. General
setup assistance, organization-specific policy questions, and support for old
releases may be closed without investigation.

Do not open a public issue for a security vulnerability. Follow
[SECURITY.md](SECURITY.md) instead.
