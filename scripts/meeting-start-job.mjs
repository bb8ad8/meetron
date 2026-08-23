#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSessionOwnership } from "../src/core/session-state.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = resolve(
  process.env.MEETING_COPILOT_RUNTIME_DIR || resolve(repoRoot, ".meeting-copilot-runtime"),
);
const statePath = resolve(runtimeDir, "meeting-launch.json");
const setupStatePath = resolve(runtimeDir, "setup.json");
const logPath = resolve(runtimeDir, "meeting-launch.log");
const readsUrlFromStdin = process.argv[2] === "--url-stdin";
const meetingUrl = readsUrlFromStdin ? readFileSync(0, "utf8").trim() : process.argv[2];
const meetingDisplay = process.argv[3] || meetingUrl;
const sessionId = process.argv[4] || null;
const providerId = process.argv[5] || "google-meet";
const audioBackendId = process.argv[6] || "legacy";

function writeState(state) {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const current = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : null;
  assertSessionOwnership(current, sessionId);
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify({ ...current, ...state, sessionId, providerId, audioBackendId }, null, 2)}\n`,
    { mode: 0o600 },
  );
  renameSync(temporaryPath, statePath);
}

function resetSetupConfirmation(field) {
  try {
    const current = JSON.parse(readFileSync(setupStatePath, "utf8"));
    const temporaryPath = `${setupStatePath}.${process.pid}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({ ...current, [field]: false, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      { mode: 0o600 },
    );
    renameSync(temporaryPath, setupStatePath);
  } catch {
    // Missing setup state is already treated as incomplete by the Native Host.
  }
}

function failureMessage(code, signal) {
  switch (code) {
    case 10:
      resetSetupConfirmation("chatgptLoginConfirmed");
      return "共用の専用ChromeでChatGPTにログインしてから、もう一度開始してください";
    case 13:
      resetSetupConfirmation("googleLoginConfirmed");
      return "共用の専用ChromeでGoogleにログインしてから、もう一度開始してください";
    case 14:
      return "Google Meetの参加リクエストが拒否されました";
    case 15:
      return "Google Meetの参加状態を確認できませんでした";
    default: {
      let detail = "";
      try {
        detail = readFileSync(logPath, "utf8")
          .split("\n")
          .reverse()
          .map((line) => line.trim())
          .find((line) => line.startsWith("Error: "))
          ?.replace(/^Error:\s*/, "")
          .replace(/([?&](?:pwd|passcode|password|zak|tk)=)[^&\s"']+/gi, "$1[REDACTED]")
          .slice(0, 300) || "";
      } catch {
        // Fall back to the exit code when the detached launch log is unavailable.
      }
      return detail
        ? `起動処理に失敗しました: ${detail}`
        : `起動処理が終了コード ${code ?? signal} で停止しました`;
    }
  }
}

const baseState = {
  meetingUrl: meetingDisplay,
  sessionId,
  providerId,
  audioBackendId,
  pid: process.pid,
  startedAt: new Date().toISOString(),
};

writeState({ ...baseState, status: "running" });

const child = spawn(resolve(repoRoot, "scripts/start-meetron.sh"), ["--url-stdin"], {
  cwd: repoRoot,
  env: process.env,
  stdio: ["pipe", "inherit", "inherit"],
});
child.stdin.on("error", () => {});
child.stdin.end(`${meetingUrl}\n`);

child.on("error", (error) => {
  writeState({
    ...baseState,
    status: "failed",
    finishedAt: new Date().toISOString(),
    error: error.message,
  });
  process.exit(1);
});

child.on("close", (code, signal) => {
  const succeeded = code === 0;
  writeState({
    ...baseState,
    status: succeeded ? "completed" : "failed",
    finishedAt: new Date().toISOString(),
    exitCode: code,
    signal,
    ...(!succeeded && { error: failureMessage(code, signal) }),
  });
  process.exit(succeeded ? 0 : 1);
});
