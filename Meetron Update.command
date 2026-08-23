#!/usr/bin/env bash

set -u

repo_root="$(cd "$(dirname "$0")" && pwd)"
"$repo_root/scripts/update-meetron.sh"
update_status=$?

show_notice() {
  message="$1"
  if command -v osascript >/dev/null 2>&1; then
    osascript - "$message" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run arguments
  display dialog (item 1 of arguments) with title "Meetron Update" buttons {"OK"} default button "OK"
end run
APPLESCRIPT
  fi
}

printf '\n'
case "$update_status" in
  0)
    printf 'Meetronの更新が完了しました。Google Chromeを終了して、もう一度開いてください。\n'
    show_notice 'Meetronの更新が完了しました。新しいChrome拡張を読み込むため、Google Chromeを終了して、もう一度開いてください。'
    ;;
  21)
    printf 'Meetronと音声PKGの更新が完了しました。Macを再起動してください。\n'
    show_notice 'Meetronと音声PKGの更新が完了しました。新しい音声ドライバを読み込むため、Macを再起動してください。'
    ;;
  30)
    printf '既存のMeetronが見つかりませんでした。新規セットアップを実行してください。\n' >&2
    show_notice '既存のMeetronが見つかりませんでした。同じフォルダの「Meetron Setup.command」を開いてください。'
    ;;
  31)
    printf '開発中の変更を保護するため、更新を停止しました。\n' >&2
    show_notice '既存フォルダに未コミットの変更があります。開発中のファイルを保護するため更新を停止しました。'
    ;;
  *)
    printf '更新は完了していません。上のメッセージをAIアシスタントへ共有してください。\n' >&2
    show_notice 'Meetronの更新中に問題が発生しました。ターミナルに表示されたメッセージをAIアシスタントへ共有してください。'
    ;;
esac

printf 'Returnキーを押すと閉じます。\n'
read -r _
exit "$update_status"
