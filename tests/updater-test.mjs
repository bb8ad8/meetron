#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDir = mkdtempSync(resolve(tmpdir(), "meetron-updater-test-"));
const targetRoot = resolve(temporaryDir, "legacy-installation");
const backupRoot = resolve(temporaryDir, "backups");

function createLegacyTarget(root) {
  mkdirSync(resolve(root, "extension"), { recursive: true });
  mkdirSync(resolve(root, "scripts"), { recursive: true });
  mkdirSync(resolve(root, ".meeting-copilot-runtime"), { recursive: true });
  writeFileSync(
    resolve(root, "package.json"),
    `${JSON.stringify({ name: "meetron", version: "0.8.1" }, null, 2)}\n`,
  );
  writeFileSync(
    resolve(root, "extension/manifest.json"),
    `${JSON.stringify({ manifest_version: 3, name: "Meetron Controls", version: "0.8.1" }, null, 2)}\n`,
  );
  writeFileSync(resolve(root, "scripts/native-host.sh"), "#!/usr/bin/env bash\n");
  writeFileSync(
    resolve(root, ".meeting-copilot.env"),
    "MEETING_COPILOT_CHATGPT_PROJECT_URL='https://chatgpt.com/g/g-p-test/project'\n",
  );
  writeFileSync(resolve(root, ".meeting-copilot-runtime/sentinel"), "preserved\n");
}

function initializeGit(root) {
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "add", "package.json", "extension/manifest.json", "scripts/native-host.sh"]);
  execFileSync(
    "git",
    [
      "-C", root,
      "-c", "user.name=Meetron Test",
      "-c", "user.email=meetron-test@example.invalid",
      "commit", "-qm", "legacy fixture",
    ],
  );
}

function runUpdater(root, overrides = {}, args = []) {
  return spawnSync(
    resolve(repoRoot, "scripts/update-meetron.sh"),
    ["--target", root, ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        MEETRON_UPDATE_BACKUP_DIR: backupRoot,
        MEETRON_UPDATE_SKIP_NPM: "1",
        MEETRON_UPDATE_SKIP_AUDIO_INSTALL: "1",
        ...overrides,
      },
    },
  );
}

try {
  createLegacyTarget(targetRoot);
  initializeGit(targetRoot);
  const blackHoleUpdate = runUpdater(targetRoot, {
    MEETRON_UPDATE_INSTALLED_AUDIO_VERSION: "none",
    MEETRON_UPDATE_AUDIO_BACKEND: "blackhole",
    MEETRON_UPDATE_AUDIO_READY: "true",
  });
  assert.equal(blackHoleUpdate.status, 0, blackHoleUpdate.stderr || blackHoleUpdate.stdout);
  assert.match(blackHoleUpdate.stdout, /Keeping the compatible blackhole audio backend/);
  assert.match(blackHoleUpdate.stdout, /planned action: legacy/);
  assert.equal(JSON.parse(readFileSync(resolve(targetRoot, "package.json"), "utf8")).version, "0.9.0");
  assert.equal(
    JSON.parse(readFileSync(resolve(targetRoot, "extension/manifest.json"), "utf8")).version,
    "0.9.0",
  );
  assert.match(readFileSync(resolve(targetRoot, ".meeting-copilot.env"), "utf8"), /g-p-test/);
  assert.equal(
    readFileSync(resolve(targetRoot, ".meeting-copilot-runtime/sentinel"), "utf8").trim(),
    "preserved",
  );

  const packagedAudioUpdate = runUpdater(targetRoot, {
    MEETRON_UPDATE_INSTALLED_AUDIO_VERSION: "0.1.1",
    MEETRON_UPDATE_AUDIO_BACKEND: "blackhole",
    MEETRON_UPDATE_AUDIO_READY: "true",
  });
  assert.equal(packagedAudioUpdate.status, 0, packagedAudioUpdate.stderr || packagedAudioUpdate.stdout);
  assert.match(packagedAudioUpdate.stdout, /planned action: install/);
  assert.match(packagedAudioUpdate.stdout, /previous Meetron update were verified/);

  const dirtyTarget = resolve(temporaryDir, "dirty-installation");
  createLegacyTarget(dirtyTarget);
  initializeGit(dirtyTarget);
  writeFileSync(resolve(dirtyTarget, "scripts/native-host.sh"), "#!/usr/bin/env bash\n# developer change\n");
  const dirtyUpdate = runUpdater(
    dirtyTarget,
    {},
    ["--dry-run"],
  );
  assert.equal(dirtyUpdate.status, 31);
  assert.match(dirtyUpdate.stderr, /uncommitted tracked changes/);

  process.stdout.write(
    "Updater preserves local state, supports BlackHole, upgrades packaged audio, and protects dirty Git trees.\n",
  );
} finally {
  rmSync(temporaryDir, { recursive: true, force: true });
}
