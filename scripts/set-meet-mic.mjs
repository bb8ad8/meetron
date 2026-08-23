#!/usr/bin/env node

// Compatibility entry point for existing users and scripts. New integrations
// should call set-participant-mic.mjs with an explicit provider.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    resolve(scriptsDir, "set-participant-mic.mjs"),
    "--provider",
    "google-meet",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env: process.env },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
