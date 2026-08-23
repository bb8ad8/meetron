#!/usr/bin/env node

import { execFileSync } from "node:child_process";

function usage() {
  process.stdout.write("Usage: node scripts/check-dco.mjs BASE_SHA HEAD_SHA\n");
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

const [base, head] = process.argv.slice(2);
const validRevision = /^[0-9a-f]{7,40}$/i;
if (!validRevision.test(base || "") || !validRevision.test(head || "")) {
  usage();
  process.stderr.write("BASE_SHA and HEAD_SHA must be Git commit identifiers.\n");
  process.exit(2);
}

let output;
try {
  output = execFileSync(
    "git",
    ["log", "--format=%H%x1f%an%x1f%ae%x1f%B%x1e", `${base}..${head}`],
    { encoding: "utf8" },
  );
} catch (error) {
  process.stderr.write(`Unable to inspect pull request commits: ${error.message}\n`);
  process.exit(1);
}

const failures = [];
const records = output.split("\x1e").map((record) => record.trim()).filter(Boolean);
for (const record of records) {
  const [sha, authorName, authorEmail, ...bodyParts] = record.split("\x1f");
  const body = bodyParts.join("\x1f");
  const signoffs = [...body.matchAll(/^Signed-off-by:\s*(.+?)\s*<([^>]+)>\s*$/gim)];
  const authorSigned = signoffs.some((match) =>
    match[1].trim() === authorName.trim() &&
    match[2].trim().toLowerCase() === authorEmail.trim().toLowerCase());
  if (!authorSigned) failures.push({ sha, authorName, authorEmail });
}

if (failures.length) {
  process.stderr.write("DCO sign-off is missing or does not match the commit author:\n");
  for (const failure of failures) {
    process.stderr.write(
      `- ${failure.sha.slice(0, 12)} ${failure.authorName} <${failure.authorEmail}>\n`,
    );
  }
  process.stderr.write("Recreate or amend each commit with: git commit -s\n");
  process.exit(1);
}

process.stdout.write(`DCO check passed for ${records.length} commit(s).\n`);
