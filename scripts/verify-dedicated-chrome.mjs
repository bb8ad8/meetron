#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let profileDir = "";
let port = "";

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--profile-dir") profileDir = process.argv[++index] || "";
  else if (argument === "--port") port = process.argv[++index] || "";
  else if (argument === "--help" || argument === "-h") {
    process.stdout.write("Usage: node scripts/verify-dedicated-chrome.mjs --profile-dir DIR --port PORT\n");
    process.exit(0);
  } else {
    process.stderr.write(`Unknown option: ${argument}\n`);
    process.exit(2);
  }
}

if (!profileDir || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
  process.stderr.write("A dedicated profile directory and valid local port are required.\n");
  process.exit(2);
}

const { stdout: processList } = await execFileAsync("/bin/ps", ["-axo", "pid=,command="], {
  timeout: 10_000,
});
const expectedProfileArgument = `--user-data-dir=${profileDir} --no-first-run`;
const expectedPortArgument = `--remote-debugging-port=${port}`;
const chromePids = processList
  .split("\n")
  .map((line) => {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    return match ? { pid: Number(match[1]), command: match[2] } : null;
  })
  .filter(
    (entry) =>
      entry &&
      entry.command.includes("/Contents/MacOS/") &&
      !entry.command.includes("/Helper") &&
      entry.command.includes("--remote-debugging-address=127.0.0.1") &&
      entry.command.includes(expectedPortArgument) &&
      entry.command.includes(expectedProfileArgument),
  )
  .map((entry) => entry.pid);

let listenerPids = [];
try {
  const { stdout } = await execFileAsync(
    "/usr/sbin/lsof",
    ["-nP", "-t", `-iTCP@127.0.0.1:${port}`, "-sTCP:LISTEN"],
    { timeout: 10_000 },
  );
  listenerPids = stdout
    .split("\n")
    .map(Number)
    .filter(Number.isInteger);
} catch {
  // lsof exits with status 1 when no process is listening.
}

const pid = chromePids.find((candidate) => listenerPids.includes(candidate));
if (!pid) {
  process.stderr.write("The local automation endpoint does not belong to the dedicated Chrome profile.\n");
  process.exit(1);
}

try {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const version = await response.json();
  if (typeof version.webSocketDebuggerUrl !== "string") {
    throw new Error("Missing Chrome debugger URL");
  }
} catch (error) {
  process.stderr.write(`The dedicated Chrome automation endpoint is unavailable: ${error.message}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ verified: true, pid, port: Number(port), profileDir })}\n`);
