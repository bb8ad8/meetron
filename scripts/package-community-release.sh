#!/usr/bin/env bash

set -euo pipefail
export COPYFILE_DISABLE=1

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="$repo_root/dist/community"
audio_pkg=''
allow_dirty=0
dry_run=0

usage() {
  cat <<'EOF'
Usage: ./scripts/package-community-release.sh [options]

Creates a source-first Meetron Community ZIP. Local configuration, runtime
state, dependencies, ignored design documents, build outputs, and signing
credentials are excluded. A signed and notarized audio PKG may be included.

Options:
  --audio-pkg PATH    Include and verify a notarized MeetronAudio-*.pkg.
  --output-dir DIR    Output directory (default: dist/community).
  --allow-dirty       Allow a dirty worktree for local packaging tests only.
  --dry-run           Validate inputs and print the planned artifact.
  -h, --help          Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --audio-pkg)
      shift
      audio_pkg="${1:-}"
      ;;
    --output-dir)
      shift
      output_dir="${1:-}"
      ;;
    --allow-dirty)
      allow_dirty=1
      ;;
    --dry-run)
      dry_run=1
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

node_binary="$(command -v node 2>/dev/null || true)"
if [ -z "$node_binary" ] || [ ! -x "$node_binary" ]; then
  printf '[ERROR] Node.js 22 or 24 LTS is required.\n' >&2
  exit 1
fi
node_version="$($node_binary --version)"
node_major="$(printf '%s' "$node_version" | sed 's/^v//' | cut -d. -f1)"
case "$node_major" in
  22|24) ;;
  *)
    printf '[ERROR] Node.js 22 or 24 LTS is required (found %s).\n' "$node_version" >&2
    exit 1
    ;;
esac

release_metadata="$("$node_binary" --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { resolve } from "node:path";
  const root = process.argv[1];
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const extension = JSON.parse(readFileSync(resolve(root, "extension/manifest.json"), "utf8"));
  if (pkg.name !== "meetron" || !/^\d+\.\d+\.\d+$/.test(pkg.version)) process.exit(1);
  if (extension.name !== "Meetron Controls" || extension.version !== pkg.version) process.exit(1);
  process.stdout.write(`${pkg.version}\n${extension.version}\n`);
' "$repo_root")" || {
  printf '[ERROR] package.json and extension/manifest.json versions are invalid or different.\n' >&2
  exit 1
}
version="$(printf '%s\n' "$release_metadata" | sed -n '1p')"

git_root="$(git -C "$repo_root" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$git_root" ] || [ "$git_root" != "$repo_root" ]; then
  printf '[ERROR] Community archives must be created from the Git repository root.\n' >&2
  exit 1
fi

if [ "$allow_dirty" -ne 1 ]; then
  if [ -n "$(git -C "$repo_root" status --porcelain --untracked-files=all)" ]; then
    printf '[ERROR] Public Community archives require a clean Git worktree.\n' >&2
    printf 'Commit the release contents first. Use --allow-dirty only for a local test.\n' >&2
    exit 1
  fi
fi

if [ -n "$audio_pkg" ]; then
  if [ ! -f "$audio_pkg" ]; then
    printf '[ERROR] Audio package was not found: %s\n' "$audio_pkg" >&2
    exit 1
  fi
  case "$(basename "$audio_pkg")" in
    MeetronAudio-*.pkg) ;;
    *)
      printf '[ERROR] Unexpected audio package name: %s\n' "$(basename "$audio_pkg")" >&2
      exit 1
      ;;
  esac
  checksum_path="$audio_pkg.sha256"
  if [ ! -f "$checksum_path" ]; then
    printf '[ERROR] Audio package checksum was not found: %s\n' "$checksum_path" >&2
    exit 1
  fi
  (
    cd "$(dirname "$audio_pkg")"
    shasum -a 256 -c "$(basename "$checksum_path")"
  ) >/dev/null
  signature_output="$(pkgutil --check-signature "$audio_pkg" 2>&1)" || {
    printf '[ERROR] Audio package signature validation failed.\n%s\n' "$signature_output" >&2
    exit 1
  }
  if ! printf '%s\n' "$signature_output" | grep -F 'Developer ID Installer: Yuki Inaba' >/dev/null ||
    ! printf '%s\n' "$signature_output" | grep -F 'Notarization: trusted by the Apple notary service' >/dev/null; then
    printf '[ERROR] Audio package is not the expected signed and notarized release.\n' >&2
    exit 1
  fi
  if ! spctl --assess --type install --verbose=2 "$audio_pkg" >/dev/null 2>&1; then
    printf '[ERROR] Gatekeeper rejected the audio package.\n' >&2
    exit 1
  fi
fi

artifact_label="Community"
if [ "$allow_dirty" -eq 1 ]; then
  artifact_label="Community-LOCAL-TEST"
  printf '[WARN] Dirty-worktree artifact is marked LOCAL-TEST and must not be published.\n' >&2
fi
archive_name="Meetron-$version-$artifact_label.zip"
if [ "$dry_run" -eq 1 ]; then
  printf '[DRY RUN] Community archive: %s/%s\n' "$output_dir" "$archive_name"
  if [ -n "$audio_pkg" ]; then
    printf '[DRY RUN] Include notarized audio package: %s\n' "$audio_pkg"
  else
    printf '[DRY RUN] Source-only archive; no audio package selected.\n'
  fi
  exit 0
fi

mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
archive_path="$output_dir/$archive_name"
archive_checksum_path="$archive_path.sha256"
if [ -e "$archive_path" ] || [ -e "$archive_checksum_path" ]; then
  printf '[ERROR] Refusing to overwrite an existing Community artifact: %s\n' "$archive_path" >&2
  exit 1
fi

temporary_base="${TMPDIR:-/tmp}"
stage_parent="$(mktemp -d "$temporary_base/meetron-community.XXXXXX")"
cleanup() {
  case "$stage_parent" in
    "$temporary_base"/meetron-community.*) rm -rf -- "$stage_parent" ;;
    *) printf '[WARN] Refusing to remove unexpected temporary path: %s\n' "$stage_parent" >&2 ;;
  esac
}
trap cleanup EXIT

stage_root="$stage_parent/Meetron-$version-$artifact_label"
mkdir -p "$stage_root"
rsync -a "$repo_root/" "$stage_root/" \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'docs/' \
  --exclude 'dist/' \
  --exclude '.meeting-copilot.env' \
  --exclude '.meeting-copilot-runtime/' \
  --exclude '.build/' \
  --exclude '.DS_Store' \
  --exclude '._*' \
  --exclude '*.log' \
  --exclude '*.p8' \
  --exclude '*.p12' \
  --exclude '*.cer' \
  --exclude '*.key' \
  --exclude '*.certSigningRequest' \
  --exclude 'id_rsa*' \
  --exclude 'id_ed25519*' \
  --exclude 'credentials*.json' \
  --exclude 'cookies*.json' \
  --exclude 'MeetronAudio-*.pkg' \
  --exclude 'MeetronAudio-*.pkg.sha256'

if [ -n "$audio_pkg" ]; then
  cp "$audio_pkg" "$stage_root/"
  (
    cd "$stage_root"
    shasum -a 256 "$(basename "$audio_pkg")" > "$(basename "$audio_pkg").sha256"
  )
fi

test -x "$stage_root/Meetron Setup.command"
test -x "$stage_root/Meetron Update.command"
test -x "$stage_root/scripts/setup-meetron.sh"
test -x "$stage_root/scripts/update-meetron.sh"

for forbidden in \
  '.git' 'node_modules' 'docs' 'dist' '.meeting-copilot.env' \
  '.meeting-copilot-runtime'; do
  if [ -e "$stage_root/$forbidden" ]; then
    printf '[ERROR] Forbidden release path was staged: %s\n' "$forbidden" >&2
    exit 1
  fi
done

if find "$stage_root" -type f \( \
  -name '*.p8' -o -name '*.p12' -o -name '*.cer' -o \
  -name '*.key' -o -name 'id_rsa*' -o -name 'id_ed25519*' -o \
  -name 'credentials*.json' -o -name 'cookies*.json' -o \
  -name '*.certSigningRequest' -o -name '.DS_Store' -o -name '._*' \
\) -print -quit | grep . >/dev/null; then
  printf '[ERROR] A credential or macOS metadata file was staged.\n' >&2
  exit 1
fi

# ZIP records filesystem timestamps. Normalize every staged entry so identical
# source and PKG bytes produce an identical Community archive.
find "$stage_root" -exec /usr/bin/touch -h -t 200001010000.00 {} +

(
  cd "$stage_parent"
  /usr/bin/zip -qry "$archive_path" "$(basename "$stage_root")"
)
(
  cd "$output_dir"
  shasum -a 256 "$archive_name" > "$archive_name.sha256"
)

entries="$(unzip -Z1 "$archive_path")"
if printf '%s\n' "$entries" | grep -E '(^|/)(\.git|node_modules|docs|dist|\.meeting-copilot-runtime)(/|$)|(^|/)\.meeting-copilot\.env$|(^|/)\._|\.p8$|\.p12$|\.cer$|\.key$|(^|/)id_(rsa|ed25519)|(^|/)(credentials|cookies)[^/]*\.json$|\.certSigningRequest$' >/dev/null; then
  printf '[ERROR] Forbidden entry detected in the completed archive.\n' >&2
  exit 1
fi

printf '[OK] Created %s\n' "$archive_path"
printf '[OK] Created %s\n' "$archive_checksum_path"
