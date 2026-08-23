#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectToChromeOverCDP } from "./playwright-cdp.mjs";
import { locatorIsVisible } from "../src/browser/meeting-browser.mjs";
import { getMeetingProvider } from "../src/providers/provider-registry.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = resolve(
  process.env.MEETING_COPILOT_RUNTIME_DIR || resolve(repoRoot, ".meeting-copilot-runtime"),
);
const microphoneStatePath = resolve(runtimeDir, "meet-mic.json");
const options = {
  cdp: "http://127.0.0.1:9223",
  provider: "google-meet",
  assumeBefore: "",
  state: "",
  wait: 0,
};

function usage() {
  process.stdout.write(`Usage: node scripts/set-participant-mic.mjs [options]\n\nOptions:\n  --provider ID          Meeting provider (default: google-meet)\n  --cdp URL              Chrome DevTools endpoint (default: ${options.cdp})\n  --state STATE          muted, unmuted, or toggle\n  --wait SEC             Wait for admission before changing the mic (default: 0)\n  --assume-before STATE  Use muted or unmuted if the provider control is hidden\n  -h, --help             Show this help\n`);
}

const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  switch (args[index]) {
    case "--provider": options.provider = args[++index] || ""; break;
    case "--cdp": options.cdp = args[++index] || ""; break;
    case "--state": options.state = args[++index] || ""; break;
    case "--assume-before": options.assumeBefore = args[++index] || ""; break;
    case "--wait": options.wait = Number(args[++index]); break;
    case "-h":
    case "--help": usage(); process.exit(0); break;
    default:
      process.stderr.write(`Unknown argument: ${args[index]}\n`);
      usage();
      process.exit(2);
  }
}

if (!["muted", "unmuted", "toggle"].includes(options.state)) {
  process.stderr.write("--state must be muted, unmuted, or toggle.\n");
  process.exit(2);
}
if (options.assumeBefore && !["muted", "unmuted"].includes(options.assumeBefore)) {
  process.stderr.write("--assume-before must be muted or unmuted.\n");
  process.exit(2);
}
if (!Number.isFinite(options.wait) || options.wait < 0) {
  process.stderr.write("--wait must be a non-negative number.\n");
  process.exit(2);
}

let provider;
try {
  provider = getMeetingProvider(options.provider);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}

function meetingKey(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return "";
  }
}

function readTrackedState(meetingUrl) {
  if (!existsSync(microphoneStatePath)) return "";
  try {
    const tracked = JSON.parse(readFileSync(microphoneStatePath, "utf8"));
    return tracked.providerId === options.provider &&
      meetingKey(tracked.meetingUrl) === meetingKey(meetingUrl) &&
      ["muted", "unmuted"].includes(tracked.state)
      ? tracked.state
      : "";
  } catch {
    return "";
  }
}

function writeTrackedState(result) {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const temporaryPath = `${microphoneStatePath}.${process.pid}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify({
      meetingUrl: result.url,
      providerId: options.provider,
      state: result.after,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  renameSync(temporaryPath, microphoneStatePath);
}

const browser = await connectToChromeOverCDP(options.cdp);
const status = await provider.getStatus(browser, locatorIsVisible);
const desiredState = options.state === "toggle"
  ? status.microphone === "muted"
    ? "unmuted"
    : status.microphone === "unmuted"
      ? "muted"
      : "toggle"
  : options.state;
const result = await provider.setMicrophone(browser, locatorIsVisible, desiredState, {
  assumeBefore: options.assumeBefore,
  trackedBefore: readTrackedState(status.url),
  waitMs: options.wait * 1_000,
});
writeTrackedState(result);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(0);
