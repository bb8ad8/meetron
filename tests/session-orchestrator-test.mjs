#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  runSessionLaunchPipeline,
  SessionOrchestrator,
} from "../src/core/session-orchestrator.mjs";

const calls = [];
let currentState = null;
const meeting = {
  providerId: "zoom-web",
  url: "https://zoom.us/j/123456789?pwd=secret",
  displayUrl: "https://zoom.us/j/123456789",
  meetingKey: "zoom.us:123456789",
  containsSecret: true,
};
const orchestrator = new SessionOrchestrator({
  normalizeMeeting: (value) => {
    assert.match(value, /zoom\.us/);
    return meeting;
  },
  getProvider: () => ({
    label: "Zoom Web App",
    capabilities: { postJoinMicrophone: "muted" },
  }),
  getCurrentState: () => currentState,
  getAudioStatus: async () => ({ backend: "custom" }),
  createState: ({ meeting: normalized, audioBackendId }) => ({
    sessionId: "session-1",
    providerId: normalized.providerId,
    audioBackendId,
    status: "starting",
  }),
  launch: async ({ meeting: normalized, state }) => {
    calls.push("launch");
    assert.equal(normalized, meeting);
    return { ...state, pid: 42 };
  },
  cancelLaunch: async () => { calls.push("cancel"); return { cancelled: true }; },
  getMeetingStatus: async () => {
    calls.push("status");
    return { connection: "joined", microphone: "unmuted" };
  },
  setMicrophone: async () => { calls.push("mute"); return { verified: true }; },
  stopVoice: async () => { calls.push("voice"); return { stopped: true }; },
  leaveMeeting: async () => { calls.push("leave"); return { left: true }; },
  restoreAudio: async () => { calls.push("audio"); return { restored: true }; },
  persistStopped: async () => { calls.push("persist"); },
});

assert.deepEqual(orchestrator.validateMeeting(meeting.url), {
  valid: true,
  providerId: "zoom-web",
  providerLabel: "Zoom Web App",
  displayUrl: meeting.displayUrl,
  containsSecret: true,
  capabilities: { postJoinMicrophone: "muted" },
});
assert.deepEqual(await orchestrator.start({ meetingUrl: meeting.url }), {
  sessionId: "session-1",
  providerId: "zoom-web",
  audioBackendId: "custom",
  status: "starting",
  pid: 42,
});

currentState = { status: "running" };
await assert.rejects(
  orchestrator.start({ meetingUrl: meeting.url }),
  (error) => error.code === "SESSION_ALREADY_RUNNING",
);
currentState = null;
const stopped = await orchestrator.stop();
assert.equal(stopped.stopped, true);
assert.deepEqual(stopped.warnings, []);
assert.deepEqual(calls, ["launch", "cancel", "status", "mute", "voice", "leave", "audio", "persist"]);

const pipelineCalls = [];
const pipelineOperations = Object.fromEntries([
  "installControlUi",
  "configureAudio",
  "startVoice",
  "prepareParticipant",
  "setPostJoinMicrophone",
  "closeParticipantBrowser",
  "restoreAudio",
].map((name) => [name, async (...args) => { pipelineCalls.push([name, ...args]); }]));
const pipeline = await runSessionLaunchPipeline({
  provider: {
    id: "google-meet",
    label: "Google Meet",
    capabilities: { postJoinMicrophone: "unmuted" },
  },
  operations: pipelineOperations,
});
assert.equal(pipeline.providerId, "google-meet");
assert.deepEqual(pipelineCalls, [
  ["installControlUi"],
  ["configureAudio"],
  ["startVoice"],
  ["prepareParticipant"],
  ["setPostJoinMicrophone", "unmuted"],
]);

const failureCalls = [];
await assert.rejects(runSessionLaunchPipeline({
  provider: {
    id: "zoom-web",
    label: "Zoom Web App",
    capabilities: { postJoinMicrophone: "muted" },
  },
  operations: {
    installControlUi: async () => failureCalls.push("install"),
    configureAudio: async () => failureCalls.push("audio-configure"),
    startVoice: async () => failureCalls.push("voice"),
    prepareParticipant: async () => { failureCalls.push("participant"); throw new Error("failed"); },
    setPostJoinMicrophone: async () => failureCalls.push("mic"),
    closeParticipantBrowser: async () => failureCalls.push("browser-close"),
    restoreAudio: async () => failureCalls.push("audio-restore"),
  },
}));
assert.deepEqual(failureCalls, [
  "install",
  "audio-configure",
  "voice",
  "participant",
  "browser-close",
  "audio-restore",
]);

process.stdout.write("Shared session lifecycle orchestration passed.\n");
