#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(resolve(tmpdir(), "meetron-dco-test-"));
const author = ["-c", "user.name=Meetron Contributor", "-c", "user.email=contributor@example.invalid"];

function git(args) {
  return execFileSync("git", ["-C", temporary, ...author, ...args], { encoding: "utf8" }).trim();
}

try {
  git(["init", "-q"]);
  writeFileSync(resolve(temporary, "fixture.txt"), "base\n");
  git(["add", "fixture.txt"]);
  git(["commit", "-qm", "base"]);
  const base = git(["rev-parse", "HEAD"]);

  writeFileSync(resolve(temporary, "fixture.txt"), "signed\n");
  git(["commit", "-qam", "signed change", "--signoff"]);
  const signedHead = git(["rev-parse", "HEAD"]);
  const signed = spawnSync(
    process.execPath,
    [resolve(repoRoot, "scripts/check-dco.mjs"), base, signedHead],
    { cwd: temporary, encoding: "utf8" },
  );
  assert.equal(signed.status, 0, signed.stderr);

  writeFileSync(resolve(temporary, "fixture.txt"), "unsigned\n");
  git(["commit", "-qam", "unsigned change"]);
  const unsignedHead = git(["rev-parse", "HEAD"]);
  const unsigned = spawnSync(
    process.execPath,
    [resolve(repoRoot, "scripts/check-dco.mjs"), signedHead, unsignedHead],
    { cwd: temporary, encoding: "utf8" },
  );
  assert.equal(unsigned.status, 1);
  assert.match(unsigned.stderr, /DCO sign-off is missing/);

  process.stdout.write("DCO enforcement accepts signed and rejects unsigned commits.\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
