#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  exactDevicePattern,
  resolveMeetingAudioDevices,
} from "../src/audio/meeting-audio-devices.mjs";
import {
  createParticipantStatus,
  createPreparationResult,
  createReconciliationResult,
} from "../src/core/participant-state.mjs";
import { parsePreparationOptions } from "../src/core/preparation-cli.mjs";

const options = parsePreparationOptions([
  "--url", "https://meet.google.com/abc-defg-hij",
  "--name", "Custom Bot",
  "--join",
  "--join-delay", "0",
]);
assert.equal(options.join, true);
assert.equal(options.joinDelay, 0);
assert.equal(options.name, "Custom Bot");
assert.throws(() => parsePreparationOptions(["--unknown"]));
assert.throws(() => parsePreparationOptions(["--join-delay", "invalid"]));

let audioStatusCalls = 0;
const devices = await resolveMeetingAudioDevices(
  { microphoneDevice: "", speakerDevice: "Custom Speaker" },
  async () => {
    audioStatusCalls += 1;
    return {
      routing: {
        meetingMicrophone: { name: "Custom [Mic]" },
        meetingSpeaker: { name: "Ignored Speaker" },
      },
    };
  },
);
assert.deepEqual(devices, {
  microphoneDevice: "Custom [Mic]",
  speakerDevice: "Custom Speaker",
});
assert.equal(audioStatusCalls, 1);
assert.equal(exactDevicePattern("Custom [Mic]").test("CUSTOM [MIC] (Virtual)"), true);

assert.deepEqual(
  createPreparationResult({
    providerId: "google-meet",
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    connection: "waiting",
    microphone: "muted",
    camera: "off",
  }),
  {
    providerId: "google-meet",
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    connection: "waiting",
    microphone: "muted",
    camera: "off",
  },
);
assert.throws(() => createPreparationResult({
  providerId: "test",
  meetingUrl: "https://example.com",
  connection: "provider-specific-state",
}));

assert.deepEqual(
  createParticipantStatus({
    browserConnected: true,
    connection: "joined",
    microphone: "muted",
    camera: "on",
    audioConnection: "connected",
  }),
  {
    browserConnected: true,
    connection: "joined",
    microphone: "muted",
    camera: "on",
    audioConnection: "connected",
  },
);
assert.deepEqual(createReconciliationResult({ ready: true, changed: false }), {
  ready: true,
  changed: false,
});
assert.throws(() => createParticipantStatus({
  browserConnected: true,
  connection: "joined",
  microphone: "provider-specific",
}));
assert.throws(() => createReconciliationResult({ ready: "yes", changed: false }));

process.stdout.write("Shared preparation contracts passed.\n");
