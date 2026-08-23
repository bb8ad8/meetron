#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = Object.fromEntries(await Promise.all(
  [
    "native-host.mjs",
    "meeting-start-job.mjs",
    "start-meetron.sh",
    "session-launch.mjs",
    "open-gpt-participant.sh",
  ]
    .map(async (name) => [name, await readFile(resolve(repoRoot, "scripts", name), "utf8")]),
));

assert.match(sources["native-host.mjs"], /meeting-start-job\.mjs"\),\s*"--url-stdin"/s);
assert.match(sources["native-host.mjs"], /child\.stdin\.end\(`\$\{meetingUrl\}\\n`\)/);
assert.match(sources["meeting-start-job.mjs"], /start-meetron\.sh"\), \["--url-stdin"\]/);
assert.match(sources["start-meetron.sh"], /session-launch\.mjs" --url-stdin/);
assert.match(sources["session-launch.mjs"], /scripts\/open-gpt-participant\.sh/);
assert.match(sources["session-launch.mjs"], /\["--url-stdin", "--join"\]/);
assert.match(sources["session-launch.mjs"], /input: `\$\{meeting\.url\}\\n`/);
assert.match(sources["open-gpt-participant.sh"], /--url-stdin/);

process.stdout.write("Meeting invitation secrets use standard-input transport.\n");
