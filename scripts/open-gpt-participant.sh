#!/usr/bin/env bash

set -eu

dry_run=0
auto_prepare=0
join_meeting=0
join_delay="${MEETING_COPILOT_JOIN_DELAY:-2}"
restart_profile=0
manual_join_required=0
meeting_url=''
url_stdin=0
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
environment_cdp_port="${MEETING_COPILOT_CDP_PORT:-}"

if [ -f "$repo_root/.meeting-copilot.env" ]; then
  # shellcheck disable=SC1091
  . "$repo_root/.meeting-copilot.env"
fi
if [ -n "$environment_cdp_port" ]; then
  MEETING_COPILOT_CDP_PORT="$environment_cdp_port"
fi

usage() {
  cat <<'EOF'
Usage: ./scripts/open-gpt-participant.sh [options] MEETING_URL

Opens a Google Meet or Zoom tab in the shared Meetron Chrome profile.

Environment variables:
  MEETING_COPILOT_CHROME_PATH   Override the Google Chrome .app path.
  MEETING_COPILOT_PROFILE_DIR   Override the dedicated user data directory.
  MEETING_COPILOT_NAME          Participant name shown in instructions.
  MEETING_COPILOT_CDP_PORT      Local automation port (default: 9223).
  MEETING_COPILOT_JOIN_DELAY    Seconds to wait before admission request (default: 2).

Options:
  --auto-prepare       Configure the selected provider without joining.
  --join               Prepare and request admission automatically.
  --join-delay SEC     Override the delay before requesting admission.
  --restart-profile    Restart the whole shared profile; this also closes ChatGPT.
  --url-stdin          Read the meeting invitation URL from standard input.
  --dry-run            Print the launch command without opening Chrome.

Examples:
  ./scripts/open-gpt-participant.sh https://meet.google.com/xxx-yyyy-zzz
  ./scripts/open-gpt-participant.sh --auto-prepare --restart-profile https://meet.google.com/xxx-yyyy-zzz
  ./scripts/open-gpt-participant.sh --join --restart-profile https://meet.google.com/xxx-yyyy-zzz
  ./scripts/open-gpt-participant.sh --join https://zoom.us/j/123456789
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      dry_run=1
      ;;
    --auto-prepare)
      auto_prepare=1
      ;;
    --join)
      auto_prepare=1
      join_meeting=1
      ;;
    --join-delay)
      shift
      join_delay="${1:-}"
      ;;
    --restart-profile)
      restart_profile=1
      ;;
    --url-stdin)
      url_stdin=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [ -n "$meeting_url" ]; then
        printf 'Only one meeting URL may be supplied.\n' >&2
        usage >&2
        exit 2
      fi
      meeting_url="$1"
      ;;
  esac
  shift
done

if [ "$url_stdin" -eq 1 ]; then
  if [ -n "$meeting_url" ]; then
    printf 'Do not combine --url-stdin with a positional meeting URL.\n' >&2
    exit 2
  fi
  IFS= read -r meeting_url
fi

case "$join_delay" in
  ''|*[!0-9]*)
    printf '%s\n' '--join-delay must be a non-negative integer.' >&2
    exit 2
    ;;
esac

if [ -z "$meeting_url" ]; then
  printf 'A meeting URL is required.\n' >&2
  usage >&2
  exit 2
fi

set +e
meeting_provider_data="$(printf '%s' "$meeting_url" | node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { pathToFileURL } from "node:url";
    const { getMeetingProvider, normalizeMeeting } = await import(pathToFileURL(`${process.argv[1]}/src/providers/provider-registry.mjs`));
    const { createProviderPreparationPlan } = await import(pathToFileURL(`${process.argv[1]}/src/providers/provider-automation.mjs`));
  try {
    const meeting = normalizeMeeting(readFileSync(0, "utf8").trim());
    const provider = getMeetingProvider(meeting.providerId);
    const plan = createProviderPreparationPlan(provider, meeting, {
      cdp: "http://127.0.0.1:9223",
      participantName: "GPT-Live",
    });
    process.stdout.write([
      meeting.providerId,
      meeting.displayUrl,
      provider.label,
      plan.preparationScript,
      plan.urlTransport,
      String(provider.automation.supportsJoinDelay),
      plan.initialUrl,
    ].join("\n"));
  }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exit(2); }
' "$repo_root")"
provider_status=$?
set -e
if [ "$provider_status" -ne 0 ]; then
  exit "$provider_status"
fi
meeting_provider_id="$(printf '%s\n' "$meeting_provider_data" | sed -n '1p')"
meeting_display_url="$(printf '%s\n' "$meeting_provider_data" | sed -n '2p')"
meeting_provider="$(printf '%s\n' "$meeting_provider_data" | sed -n '3p')"
preparation_script="$(printf '%s\n' "$meeting_provider_data" | sed -n '4p')"
url_transport="$(printf '%s\n' "$meeting_provider_data" | sed -n '5p')"
supports_join_delay="$(printf '%s\n' "$meeting_provider_data" | sed -n '6p')"
launch_url="$(printf '%s\n' "$meeting_provider_data" | sed -n '7p')"

find_chrome() {
  for app_path in \
    '/Applications/Google Chrome.app' \
    "$HOME/Applications/Google Chrome.app"; do
    if [ -d "$app_path" ]; then
      printf '%s\n' "$app_path"
      return 0
    fi
  done
  return 1
}

chrome_path="${MEETING_COPILOT_CHROME_PATH:-}"
if [ -z "$chrome_path" ]; then
  chrome_path="$(find_chrome || true)"
fi

if [ -z "$chrome_path" ] || [ ! -d "$chrome_path" ]; then
  printf 'Google Chrome was not found.\n' >&2
  printf 'Set MEETING_COPILOT_CHROME_PATH to the browser .app path.\n' >&2
  exit 1
fi

profile_dir="${MEETING_COPILOT_PROFILE_DIR:-$HOME/Library/Application Support/MeetingCopilot/GPTParticipantChrome}"
participant_name="${MEETING_COPILOT_NAME:-GPT-Live}"
cdp_port="${MEETING_COPILOT_CDP_PORT:-9223}"

printf 'Provider:     %s\n' "$meeting_provider"
printf 'Browser:      %s\n' "$chrome_path"
printf 'Profile data: %s\n' "$profile_dir"
printf 'Display name: %s (set or verify in the meeting UI)\n' "$participant_name"

chrome_binary="$chrome_path/Contents/MacOS/${chrome_path##*/}"
chrome_binary="${chrome_binary%.app}"

if [ "$dry_run" -eq 1 ]; then
  if [ "$auto_prepare" -eq 1 ]; then
    printf '[DRY RUN] open -na %q --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=%q --use-fake-ui-for-media-stream --user-data-dir=%q --no-first-run --new-window %q\n' \
      "$chrome_path" "$cdp_port" "$profile_dir" "$launch_url"
  else
    printf '[DRY RUN] open -na %q --args --user-data-dir=%q --no-first-run --new-window %q\n' \
      "$chrome_path" "$profile_dir" "$launch_url"
  fi
  if [ "$join_meeting" -eq 1 ]; then
    if [ "$supports_join_delay" = 'true' ]; then
      printf '[DRY RUN] prepare Meet, wait %s seconds, and request admission\n' "$join_delay"
    else
      printf '[DRY RUN] prepare %s and request admission\n' "$meeting_provider"
    fi
  fi
  exit 0
fi

if [ ! -x "$chrome_binary" ]; then
  printf 'Chrome executable was not found at %s.\n' "$chrome_binary" >&2
  exit 1
fi

mkdir -p "$profile_dir"

find_profile_pids() {
  ps -axo pid=,command= | awk -v profile="--user-data-dir=$profile_dir" '
    index($0, profile) && $0 ~ /Contents\/MacOS\// && $0 !~ /Helper/ { print $1 }
  '
}

dedicated_endpoint_ready() {
  node "$repo_root/scripts/verify-dedicated-chrome.mjs" \
    --profile-dir "$profile_dir" --port "$cdp_port" >/dev/null 2>&1
}

if [ ! -d "$repo_root/node_modules/playwright-core" ]; then
  printf 'playwright-core is required. Run: npm ci\n' >&2
  exit 1
fi

launch_chrome=1
profile_pids="$(find_profile_pids)"
if [ -n "$profile_pids" ]; then
  if [ "$restart_profile" -eq 1 ]; then
    printf '[INFO] Restarting shared Meetron Chrome profile.\n'
    for profile_pid in $profile_pids; do
      kill "$profile_pid" 2>/dev/null || true
    done

    attempts=0
    while [ -n "$(find_profile_pids)" ] && [ "$attempts" -lt 20 ]; do
      sleep 0.25
      attempts=$((attempts + 1))
    done
  elif dedicated_endpoint_ready; then
    launch_chrome=0
    printf '[INFO] Reusing shared Meetron Chrome profile.\n'
  else
    printf 'The shared Chrome profile is running without its automation endpoint.\n' >&2
    printf 'Close it, then run the command again.\n' >&2
    exit 1
  fi
fi

if [ "$launch_chrome" -eq 1 ]; then
  open -na "$chrome_path" --args \
    --remote-debugging-address=127.0.0.1 \
    "--remote-debugging-port=$cdp_port" \
    --use-fake-ui-for-media-stream \
    "--user-data-dir=$profile_dir" \
    --no-first-run \
    --new-window \
    "$launch_url"
fi

attempts=0
while ! dedicated_endpoint_ready; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 40 ]; then
    printf 'Chrome automation endpoint did not start on port %s.\n' "$cdp_port" >&2
    exit 1
  fi
  sleep 0.25
done

if [ "$auto_prepare" -eq 1 ]; then
  prepare_args=(
    --cdp "http://127.0.0.1:$cdp_port"
    --name "$participant_name"
  )
  if [ "$url_transport" = 'argument' ]; then
    prepare_args+=(--url "$meeting_url")
  else
    prepare_args+=(--url-stdin)
  fi
  if [ "$join_meeting" -eq 1 ]; then
    prepare_args+=(--join)
    if [ "$supports_join_delay" = 'true' ]; then
      prepare_args+=(--join-delay "$join_delay")
    fi
  fi

  set +e
  if [ "$url_transport" = 'argument' ]; then
    node "$repo_root/scripts/$preparation_script" "${prepare_args[@]}"
  else
    printf '%s' "$meeting_url" | node "$repo_root/scripts/$preparation_script" "${prepare_args[@]}"
  fi
  prepare_status=$?
  set -e

  case "$prepare_status" in
    0) ;;
    13)
      printf '\nAutomatic admission requires signing in to Google in this dedicated Meet browser.\n' >&2
      printf 'Sign in once, then rerun the same command.\n' >&2
      exit 13
      ;;
    14)
      printf '\nGoogle Meet rejected the admission request. Check host access settings or use an invited Google account.\n' >&2
      exit 14
      ;;
    15)
      printf '\nMeet accepted the click, but its resulting state could not be determined. Check the browser window.\n' >&2
      exit 15
      ;;
    16)
      manual_join_required=1
      ;;
    *)
      exit "$prepare_status"
      ;;
  esac
else
  printf '%s' "$meeting_url" | node "$repo_root/scripts/open-chrome-page.mjs" \
    --cdp "http://127.0.0.1:$cdp_port" \
    --url-stdin >/dev/null
fi

if [ "$auto_prepare" -eq 1 ]; then
  if [ "$meeting_provider_id" = 'zoom-web' ]; then
    if [ "$manual_join_required" -eq 1 ]; then
      cat <<EOF

Zoom needs one manual confirmation, so the dedicated Chrome window remains open.
Verify microphone "Meetron: AI to Meeting", speaker "Meetron: Meeting to AI", and muted state.
If the pre-join button is visible, click it once; otherwise wait for host approval.
EOF
    elif [ "$join_meeting" -eq 1 ]; then
      cat <<EOF

Zoom admission was requested with Meetron audio routing enabled.
The meeting microphone remains muted until it is explicitly enabled.
EOF
    else
      cat <<EOF

Zoom is prepared with Meetron audio routing. Verify the preview and join when ready.
EOF
    fi
  elif [ "$join_meeting" -eq 1 ]; then
    if [ "$manual_join_required" -eq 1 ]; then
      cat <<EOF

Meet camera state could not be determined automatically.
Check that the camera is off, then join manually in the dedicated Chrome window.
The meeting microphone remains muted until admission is detected.

See README.md for the audio routing and verification sequence.
EOF
    else
      cat <<EOF

Meet admission was requested. The meeting microphone remains muted.

See README.md for the audio routing and verification sequence.
EOF
    fi
  else
    cat <<EOF

Browser prepared. Verify the pre-join screen, then request to join manually.
The meeting microphone remains muted until the routing test is ready.

See README.md for the audio routing and verification sequence.
EOF
  fi
else
  audio_status="$(node "$repo_root/scripts/audio-backend.mjs" status)"
  meeting_microphone="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).routing.meetingMicrophone.name)' "$audio_status")"
  meeting_speaker="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).routing.meetingSpeaker.name)' "$audio_status")"
  cat <<EOF

Browser opened. Before joining:
  1. Set the participant name to ${participant_name}.
  2. Set microphone/input to ${meeting_microphone}.
  3. Set speaker/output to ${meeting_speaker}.
  4. Keep the meeting microphone muted until the routing test is ready.

See README.md for the audio routing and verification sequence.
EOF
fi
