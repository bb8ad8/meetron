#!/usr/bin/env bash

set -euo pipefail

source_root="$(cd "$(dirname "$0")/.." && pwd)"
target_override="${MEETRON_UPDATE_TARGET:-}"
no_open="${MEETRON_UPDATE_NO_OPEN:-0}"
skip_npm="${MEETRON_UPDATE_SKIP_NPM:-0}"
skip_audio_install="${MEETRON_UPDATE_SKIP_AUDIO_INSTALL:-0}"
required_audio_version="${MEETRON_UPDATE_AUDIO_VERSION:-0.1.2}"
dry_run=0

usage() {
  cat <<'EOF'
Usage: ./scripts/update-meetron.sh [--dry-run] [--target DIRECTORY]

Updates an existing Meetron source installation in place so Chrome keeps the
same unpacked-extension path. User configuration, runtime state, Git metadata,
and dedicated Chrome profile data are preserved.

Options:
  --dry-run           Detect and validate the existing installation only.
  --target DIRECTORY  Override automatic detection of the existing checkout.
  -h, --help          Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      dry_run=1
      ;;
    --target)
      shift
      target_override="${1:-}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

find_node() {
  if [ -n "${MEETING_COPILOT_NODE_PATH:-}" ] && [ -x "$MEETING_COPILOT_NODE_PATH" ]; then
    printf '%s\n' "$MEETING_COPILOT_NODE_PATH"
    return
  fi
  command -v node 2>/dev/null || true
}

node_binary="$(find_node)"
if [ -z "$node_binary" ] || [ ! -x "$node_binary" ]; then
  printf '[ERROR] Node.js 22 or 24 LTS is required to update Meetron.\n' >&2
  exit 1
fi
node_version="$($node_binary --version)"
node_major="$(printf '%s' "$node_version" | sed 's/^v//' | cut -d. -f1)"
case "$node_major" in
  22|24) ;;
  *)
    printf '[ERROR] Node.js 22 or 24 LTS is required to update Meetron (found %s).\n' "$node_version" >&2
    exit 1
    ;;
esac

source_version="$($node_binary -e '
  const value = require(process.argv[1]);
  if (value.name !== "meetron" || typeof value.version !== "string") process.exit(1);
  process.stdout.write(value.version);
' "$source_root/package.json")"

validate_target() {
  candidate="$1"
  [ -d "$candidate" ] || return 1
  [ -f "$candidate/package.json" ] || return 1
  [ -f "$candidate/extension/manifest.json" ] || return 1
  [ -f "$candidate/scripts/native-host.sh" ] || return 1
  "$node_binary" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const root = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"));
    if (!["meetron", "meeting-copilot"].includes(pkg.name)) process.exit(1);
    if (manifest.name !== "Meetron Controls") process.exit(1);
  ' "$candidate"
}

canonical_directory() {
  (cd "$1" && pwd)
}

target_from_manifest() {
  manifest_path="$1"
  [ -f "$manifest_path" ] || return 1
  host_path="$($node_binary -e '
    const fs = require("node:fs");
    try {
      const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (manifest.name !== "com.meeting_copilot.host" || typeof manifest.path !== "string") process.exit(1);
      process.stdout.write(manifest.path);
    } catch { process.exit(1); }
  ' "$manifest_path")" || return 1
  candidate="$(dirname "$(dirname "$host_path")")"
  validate_target "$candidate" || return 1
  canonical_directory "$candidate"
}

detect_target() {
  if [ -n "$target_override" ]; then
    validate_target "$target_override" || {
      printf '[ERROR] The selected directory is not a Meetron installation: %s\n' "$target_override" >&2
      return 1
    }
    canonical_directory "$target_override"
    return
  fi

  for manifest_path in \
    "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.meeting_copilot.host.json" \
    "$HOME/Library/Application Support/MeetingCopilot/GPTParticipantChrome/NativeMessagingHosts/com.meeting_copilot.host.json"; do
    if candidate="$(target_from_manifest "$manifest_path" 2>/dev/null)"; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  return 1
}

target_root="$(detect_target)" || {
  printf '[ERROR] Existing Meetron installation was not found.\n' >&2
  printf 'Run Meetron Setup.command for a new installation instead.\n' >&2
  exit 30
}
source_root="$(canonical_directory "$source_root")"

case "$target_root" in
  /|"$HOME"|"$HOME/")
    printf '[ERROR] Refusing to update an unsafe target path: %s\n' "$target_root" >&2
    exit 1
    ;;
esac

printf 'Meetron updater\n'
printf '%s\n' '==============='
printf 'Current installation: %s\n' "$target_root"
printf 'Update source:        %s\n' "$source_root"
printf 'Target version:       %s\n' "$source_version"

update_manifest_path="$target_root/.meeting-copilot-runtime/update-manifest.json"

verify_previous_update_manifest() {
  [ -f "$update_manifest_path" ] || return 1
  "$node_binary" -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const [root, manifestPath] = process.argv.slice(1);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!manifest.files || typeof manifest.files !== "object") process.exit(1);
    for (const [relative, expected] of Object.entries(manifest.files)) {
      const absolute = path.resolve(root, relative);
      if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.statSync(absolute, { throwIfNoEntry: false })?.isFile()) process.exit(1);
      const actual = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
      if (actual !== expected) process.exit(1);
    }
  ' "$target_root" "$update_manifest_path"
}

if [ "$source_root" != "$target_root" ] && [ -d "$target_root/.git" ]; then
  if ! git -C "$target_root" diff --cached --quiet --ignore-submodules -- 2>/dev/null; then
    printf '[ERROR] The existing Git checkout has staged changes.\n' >&2
    printf 'Meetron did not overwrite developer changes. Commit or preserve them first.\n' >&2
    exit 31
  fi
  tracked_changes="$(git -C "$target_root" status --porcelain --untracked-files=no 2>/dev/null || true)"
  if [ -n "$tracked_changes" ] && ! verify_previous_update_manifest; then
    printf '[ERROR] The existing Git checkout has uncommitted tracked changes.\n' >&2
    printf 'Meetron did not overwrite developer changes. Commit or preserve them first.\n' >&2
    exit 31
  fi
  if [ -n "$tracked_changes" ]; then
    printf '[OK] Files written by the previous Meetron update were verified.\n'
  fi
fi

if [ "$dry_run" -eq 1 ]; then
  printf '[DRY RUN] Existing installation is safe to update in place.\n'
  exit 0
fi

if [ "$source_root" != "$target_root" ]; then
  backup_base="${MEETRON_UPDATE_BACKUP_DIR:-$HOME/Library/Application Support/Meetron/Backups}"
  backup_root="$backup_base/$(date '+%Y%m%d-%H%M%S')"
  mkdir -p "$backup_root"
  rsync -a "$target_root/" "$backup_root/" \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude 'docs/' \
    --exclude 'dist/' \
    --exclude '.meeting-copilot.env' \
    --exclude '.meeting-copilot-runtime/' \
    --exclude '.build/' \
    --exclude '.DS_Store'

  rsync -a "$source_root/" "$target_root/" \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude 'docs/' \
    --exclude 'dist/' \
    --exclude '.meeting-copilot.env' \
    --exclude '.meeting-copilot-runtime/' \
    --exclude '.build/' \
    --exclude 'MeetronAudio-*.pkg' \
    --exclude 'MeetronAudio-*.pkg.sha256' \
    --exclude '.DS_Store'
  printf '[OK] Previous source files were backed up to: %s\n' "$backup_root"
fi

installed_version="$($node_binary -e '
  const value = require(process.argv[1]);
  process.stdout.write(value.version || "");
' "$target_root/package.json")"
if [ "$installed_version" != "$source_version" ]; then
  printf '[ERROR] Updated source version could not be verified.\n' >&2
  exit 1
fi
printf '[OK] Meetron source updated to %s.\n' "$installed_version"

mkdir -p "$target_root/.meeting-copilot-runtime"
chmod 700 "$target_root/.meeting-copilot-runtime"
"$node_binary" -e '
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  const path = require("node:path");
  const [source, target, output, version] = process.argv.slice(1);
  const excludedTopLevel = new Set([
    ".git", "node_modules", "docs", "dist", ".meeting-copilot.env", ".meeting-copilot-runtime",
  ]);
  const files = {};
  function walk(directory, relative = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (!relative && excludedTopLevel.has(entry.name)) continue;
      if (entry.name === ".build" || entry.name === ".DS_Store") continue;
      if (/^MeetronAudio-.*\.pkg(?:\.sha256)?$/.test(entry.name)) continue;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(child, childRelative);
      else if (entry.isFile()) {
        const installed = path.join(target, childRelative);
        if (!fs.statSync(installed, { throwIfNoEntry: false })?.isFile()) process.exit(1);
        files[childRelative] = crypto.createHash("sha256").update(fs.readFileSync(installed)).digest("hex");
      }
    }
  }
  walk(source);
  const temporary = `${output}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ version, files }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, output);
' "$source_root" "$target_root" "$update_manifest_path" "$source_version"

if [ "$skip_npm" != "1" ]; then
  npm_binary="$(command -v npm 2>/dev/null || true)"
  if [ -z "$npm_binary" ] || [ ! -x "$npm_binary" ]; then
    printf '[ERROR] npm was not found next to the installed Node.js runtime.\n' >&2
    exit 1
  fi
  (cd "$target_root" && "$npm_binary" ci)
  "$target_root/scripts/install-control-ui.sh" --quiet
  printf '[OK] Dependencies and Native Messaging Host were updated.\n'
else
  printf '[TEST] Dependency and Native Host installation skipped.\n'
fi

version_at_least() {
  installed="$1"
  required="$2"
  /usr/bin/awk -v installed="$installed" -v required="$required" 'BEGIN {
    split(installed, actual, ".")
    split(required, wanted, ".")
    for (segment = 1; segment <= 3; segment++) {
      if (actual[segment] !~ /^[0-9]+$/ || wanted[segment] !~ /^[0-9]+$/) exit 1
      if ((actual[segment] + 0) > (wanted[segment] + 0)) exit 0
      if ((actual[segment] + 0) < (wanted[segment] + 0)) exit 1
    }
    exit 0
  }'
}

receipt_id='io.github.bb8ad8.meetron.audio.pkg'
if [ "${MEETRON_UPDATE_INSTALLED_AUDIO_VERSION+x}" = 'x' ]; then
  installed_audio_version="$MEETRON_UPDATE_INSTALLED_AUDIO_VERSION"
  [ "$installed_audio_version" = 'none' ] && installed_audio_version=''
else
  installed_audio_version="$(pkgutil --pkg-info "$receipt_id" 2>/dev/null | sed -n 's/^version: //p' || true)"
fi

audio_backend="${MEETRON_UPDATE_AUDIO_BACKEND:-}"
audio_ready="${MEETRON_UPDATE_AUDIO_READY:-}"
if [ -z "$audio_backend" ] || [ -z "$audio_ready" ]; then
  audio_status="$($node_binary "$target_root/scripts/audio-backend.mjs" status)"
  audio_backend="$($node_binary -e 'const s=JSON.parse(process.argv[1]);process.stdout.write(s.backend || "")' "$audio_status")"
  audio_ready="$($node_binary -e 'const s=JSON.parse(process.argv[1]);process.stdout.write(String(s.ready === true))' "$audio_status")"
fi

# Older BlackHole installations normally include SwitchAudioSource. If that
# helper is missing, Core Audio's own device inventory still lets the updater
# preserve a complete legacy route instead of unnecessarily forcing a new PKG.
configured_audio_preference="$("$node_binary" -e '
  const fs = require("node:fs");
  try {
    const text = fs.readFileSync(process.argv[1], "utf8");
    const match = text.match(/^MEETING_COPILOT_AUDIO_BACKEND=[\x27"]?([^\x27"\r\n]+)[\x27"]?$/m);
    process.stdout.write((match?.[1] || "").trim());
  } catch {}
' "$target_root/.meeting-copilot.env")"
if [ -z "$installed_audio_version" ] && [ "$audio_ready" != 'true' ] &&
  { [ -z "$configured_audio_preference" ] || [ "$configured_audio_preference" = 'auto' ] || [ "$configured_audio_preference" = 'blackhole' ]; } &&
  [ -x /usr/sbin/system_profiler ]; then
  core_audio_inventory="$(/usr/sbin/system_profiler SPAudioDataType 2>/dev/null || true)"
  if printf '%s\n' "$core_audio_inventory" | grep -F 'BlackHole 2ch:' >/dev/null &&
    printf '%s\n' "$core_audio_inventory" | grep -F 'BlackHole 16ch:' >/dev/null; then
    audio_backend='blackhole'
    audio_ready='true'
  fi
fi

if [ -n "$installed_audio_version" ] && version_at_least "$installed_audio_version" "$required_audio_version"; then
  printf '[OK] Meetron Audio %s is already installed.\n' "$installed_audio_version"
  audio_action='current'
elif [ -z "$installed_audio_version" ] && [ "$audio_ready" = 'true' ] &&
  { [ "$audio_backend" = 'blackhole' ] || [ "$audio_backend" = 'legacy-custom' ]; }; then
  printf '[OK] Keeping the compatible %s audio backend. Meetron Audio PKG is not required.\n' "$audio_backend"
  audio_action='legacy'
else
  audio_action='install'
fi

if [ "$skip_audio_install" = "1" ]; then
  printf '[TEST] Audio package installation skipped (planned action: %s).\n' "$audio_action"
  exit 0
fi

if [ "$audio_action" != 'install' ]; then
  printf '\nMeetron %s was updated successfully.\n' "$source_version"
  printf 'Quit and reopen Google Chrome to load extension version %s.\n' "$source_version"
  exit 0
fi

package_path=''
for candidate in \
  "$source_root/MeetronAudio-$required_audio_version.pkg" \
  "$source_root/dist/release/MeetronAudio-$required_audio_version.pkg" \
  "$target_root/MeetronAudio-$required_audio_version.pkg" \
  "$HOME/Downloads/MeetronAudio-$required_audio_version.pkg"; do
  if [ -f "$candidate" ]; then
    package_path="$candidate"
    break
  fi
done
if [ -z "$package_path" ]; then
  printf '[ERROR] MeetronAudio-%s.pkg was not found next to the updater.\n' "$required_audio_version" >&2
  exit 1
fi

set +e
verification_output="$(MEETRON_SETUP_PKG_PATH="$package_path" MEETRON_SETUP_NO_OPEN=1 \
  MEETRON_SETUP_AUDIO_VERSION="$required_audio_version" \
  "$target_root/scripts/setup-meetron.sh" --check-only 2>&1)"
verification_status=$?
set -e
printf '%s\n' "$verification_output"
if [ "$verification_status" -ne 20 ]; then
  printf '[ERROR] The audio package did not pass the update preflight.\n' >&2
  exit 1
fi

if [ "$no_open" = "1" ]; then
  printf '[NEXT] Open and install: %s\n' "$package_path"
  exit 20
fi

open -R "$package_path"
open "$package_path"
printf '[WAIT] Complete the macOS Installer. Meetron will detect version %s automatically.\n' "$required_audio_version"

attempts=0
while [ "$attempts" -lt 450 ]; do
  current_audio_version="$(pkgutil --pkg-info "$receipt_id" 2>/dev/null | sed -n 's/^version: //p' || true)"
  if [ -n "$current_audio_version" ] && version_at_least "$current_audio_version" "$required_audio_version"; then
    printf '[OK] Meetron Audio %s installation completed.\n' "$current_audio_version"
    printf 'Restart macOS to load the updated audio driver and Chrome extension.\n'
    exit 21
  fi
  sleep 2
  attempts=$((attempts + 1))
done

printf '[ERROR] Meetron Audio installation was not completed within 15 minutes.\n' >&2
exit 1
