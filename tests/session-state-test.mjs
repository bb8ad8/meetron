#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  assertSessionOwnership,
  createSessionState,
  migrateSessionState,
} from "../src/core/session-state.mjs";

const state = createSessionState({
  meeting: {
    providerId: "google-meet",
    url: "https://meet.google.com/abc-defg-hij",
    displayUrl: "https://meet.google.com/abc-defg-hij",
    meetingKey: "abc-defg-hij",
  },
  audioBackendId: "custom",
  now: new Date("2026-08-22T00:00:00.000Z"),
});
assert.match(state.sessionId, /^[0-9a-f-]{36}$/);
assert.equal(state.protocolVersion, 1);
assert.equal(state.providerId, "google-meet");
assert.equal(state.audioBackendId, "custom");
assert.equal(state.status, "starting");

const zoomState = createSessionState({
  meeting: {
    providerId: "zoom-web",
    url: "https://zoom.us/j/123456789?pwd=do-not-store",
    displayUrl: "https://zoom.us/j/123456789",
    meetingKey: "zoom.us:123456789",
  },
});
assert.equal(zoomState.meetingUrl, "https://zoom.us/j/123456789");
assert.doesNotMatch(JSON.stringify(zoomState), /do-not-store/);

const legacy = migrateSessionState({ status: "completed", meetingUrl: state.meetingUrl });
assert.equal(legacy.protocolVersion, 1);
assert.equal(legacy.providerId, "google-meet");
assert.equal(legacy.sessionId, null);

assert.doesNotThrow(() => assertSessionOwnership(state, state.sessionId));
assert.throws(
  () => assertSessionOwnership(state, "00000000-0000-0000-0000-000000000000"),
  (error) => error.code === "STALE_SESSION",
);

process.stdout.write("Session identity and legacy migration passed.\n");
