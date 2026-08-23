#!/usr/bin/env node

import assert from "node:assert/strict";
import { defineAudioBackend } from "../src/audio/audio-backend-contract.mjs";
import { defineCredentialStore } from "../src/platform/credential-store-contract.mjs";
import { defineInstaller } from "../src/platform/installer-contract.mjs";
import { definePlatformAdapter } from "../src/platform/platform-contract.mjs";
import { getPlatformAdapter, supportedPlatforms } from "../src/platform/platform-registry.mjs";

const macos = getPlatformAdapter("darwin");
const paths = macos.resolvePaths({
  repoRoot: "/tmp/meetron-source",
  home: "/Users/meetron-test",
  env: {},
});
assert.equal(macos.meetingMuteShortcut, "Meta+d");
assert.equal(paths.runtimeDir, "/tmp/meetron-source/.meeting-copilot-runtime");
assert.equal(
  paths.dedicatedProfileDir,
  "/Users/meetron-test/Library/Application Support/MeetingCopilot/GPTParticipantChrome",
);
assert.deepEqual(supportedPlatforms(), ["darwin"]);

const overridden = macos.resolvePaths({
  repoRoot: "/tmp/meetron-source",
  home: "/Users/meetron-test",
  env: {
    MEETING_COPILOT_RUNTIME_DIR: "/tmp/meetron-runtime",
    MEETING_COPILOT_PROFILE_DIR: "/tmp/meetron-profile",
  },
});
assert.equal(overridden.runtimeDir, "/tmp/meetron-runtime");
assert.equal(overridden.dedicatedProfileDir, "/tmp/meetron-profile");

assert.throws(
  () => getPlatformAdapter("win32"),
  (error) => error.code === "PLATFORM_UNSUPPORTED" &&
    error.details.supportedPlatforms.includes("darwin"),
);
assert.throws(
  () => definePlatformAdapter({ id: "invalid", label: "Invalid" }),
  (error) => error.code === "INVALID_PLATFORM_ADAPTER",
);

const audioBackend = defineAudioBackend({
  id: "test-audio",
  label: "Test Audio",
  meetingToAI: { name: "Meeting to AI", uid: "test.meeting-to-ai" },
  aiToMeeting: { name: "AI to Meeting", uid: "test.ai-to-meeting" },
});
assert.equal(audioBackend.aiToMeeting.uid, "test.ai-to-meeting");
assert.throws(
  () => defineAudioBackend({ id: "invalid", label: "Invalid" }),
  (error) => error.code === "INVALID_AUDIO_BACKEND",
);

const credentialStore = defineCredentialStore({
  id: "test-credentials",
  async get() {},
  async set() {},
  async delete() {},
});
assert.equal(credentialStore.id, "test-credentials");
assert.throws(
  () => defineCredentialStore({ id: "invalid", async get() {} }),
  (error) => error.code === "INVALID_CREDENTIAL_STORE",
);

const installer = defineInstaller({
  id: "test-installer",
  async getStatus() {},
  async install() {},
  async uninstall() {},
});
assert.equal(installer.id, "test-installer");
assert.throws(
  () => defineInstaller({ id: "invalid", async install() {} }),
  (error) => error.code === "INVALID_INSTALLER",
);

process.stdout.write("Platform, audio, credential, and installer contracts passed.\n");
