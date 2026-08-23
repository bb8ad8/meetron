#!/usr/bin/env bash

set -eu

if [ "$#" -ne 1 ]; then
  printf 'Usage: ./scripts/start-meetron.sh MEETING_URL | --url-stdin\n' >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$1" = '--url-stdin' ]; then
  IFS= read -r meeting_url
else
  meeting_url="$1"
fi
if [ -z "$meeting_url" ]; then
  printf 'A meeting URL is required.\n' >&2
  exit 2
fi

# Keep the historical environment file and variable names for installed users.
# Native Host-provided ports take precedence over an older local env file.
environment_cdp_port="${MEETING_COPILOT_CDP_PORT:-}"
if [ -f "$repo_root/.meeting-copilot.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$repo_root/.meeting-copilot.env"
  set +a
fi
if [ -n "$environment_cdp_port" ]; then
  MEETING_COPILOT_CDP_PORT="$environment_cdp_port"
  export MEETING_COPILOT_CDP_PORT
fi

# This shell entry point remains for CLI and older installations. The shared
# JavaScript engine owns the actual Meet/Zoom launch lifecycle.
printf '%s\n' "$meeting_url" | node "$repo_root/scripts/session-launch.mjs" --url-stdin
