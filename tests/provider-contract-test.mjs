#!/usr/bin/env node

import assert from "node:assert/strict";
import { normalizeGoogleMeetUrl } from "../src/providers/google-meet/google-meet-provider.mjs";
import {
  getMeetingProvider,
  normalizeMeeting,
  supportedMeetingProviders,
} from "../src/providers/provider-registry.mjs";
import {
  normalizeZoomUrl,
  zoomBrowserInvitationUrl,
  zoomDirectWebClientUrl,
} from "../src/providers/zoom-web/zoom-web-provider.mjs";
import { createProviderPreparationPlan } from "../src/providers/provider-automation.mjs";

const normalized = normalizeMeeting(" https://meet.google.com/ABC-defg-HIJ/?utm_source=test#fragment ");
assert.deepEqual(normalized, {
  providerId: "google-meet",
  url: "https://meet.google.com/abc-defg-hij",
  displayUrl: "https://meet.google.com/abc-defg-hij",
  meetingKey: "abc-defg-hij",
});
assert.deepEqual(supportedMeetingProviders(), ["google-meet", "zoom-web"]);

for (const invalid of [
  "https://example.com/abc-defg-hij",
  "http://meet.google.com/abc-defg-hij",
  "https://user:pass@meet.google.com/abc-defg-hij",
  "https://meet.google.com:444/abc-defg-hij",
  "https://meet.google.com/lookup/secret",
]) {
  assert.throws(() => normalizeGoogleMeetUrl(invalid));
}

const zoom = normalizeMeeting(
  "https://us02web.zoom.us/j/12345678901?pwd=secret-passcode&utm_source=calendar#fragment",
);
assert.deepEqual(zoom, {
  providerId: "zoom-web",
  url: "https://us02web.zoom.us/j/12345678901?pwd=secret-passcode",
  displayUrl: "https://us02web.zoom.us/j/12345678901",
  meetingKey: "us02web.zoom.us:12345678901",
  containsSecret: true,
});
assert.equal(
  normalizeZoomUrl("https://app.zoom.us/wc/123456789/join?pwd=a-b_c").providerId,
  "zoom-web",
);
assert.equal(
  zoomDirectWebClientUrl("https://us02web.zoom.us/j/123456789?pwd=a-b_c"),
  "https://app.zoom.us/wc/123456789/join?pwd=a-b_c",
);
assert.equal(
  zoomBrowserInvitationUrl("https://us02web.zoom.us/j/123456789?pwd=a-b_c"),
  "https://us02web.zoom.us/j/123456789?pwd=a-b_c#success",
);
for (const invalid of [
  "http://zoom.us/j/123456789",
  "https://evilzoom.us/j/123456789",
  "https://zoom.us.evil.example/j/123456789",
  "https://user:pass@zoom.us/j/123456789",
  "https://zoom.us:444/j/123456789",
  "https://zoom.us/j/not-a-number",
  "https://zoom.us/profile",
]) {
  assert.throws(() => normalizeZoomUrl(invalid));
}

const provider = getMeetingProvider("google-meet");
assert.equal(provider.id, "google-meet");
assert.equal(provider.label, "Google Meet");
assert.equal(provider.capabilities.postJoinMicrophone, "unmuted");
assert.equal(provider.automation.preparationScript, "prepare-meet.mjs");
assert.equal(provider.automation.initialPage, "meeting-display-url");
assert.equal(typeof provider.getStatus, "function");
assert.equal(typeof provider.reconcileSession, "function");
assert.equal(typeof provider.setMicrophone, "function");
assert.equal(typeof provider.leave, "function");
assert.throws(() => getMeetingProvider("unknown-provider"));
const zoomProvider = getMeetingProvider("zoom-web");
assert.equal(zoomProvider.capabilities.postJoinMicrophone, "muted");
assert.equal(zoomProvider.automation.urlTransport, "stdin");
assert.equal(zoomProvider.automation.initialPage, "blank");

const meetPlan = createProviderPreparationPlan(provider, normalized, {
  cdp: "http://127.0.0.1:9223",
  participantName: "GPT-Live",
  requestJoin: true,
  joinDelay: 7,
});
assert.equal(meetPlan.initialUrl, normalized.displayUrl);
assert.equal(meetPlan.preparationScript, "prepare-meet.mjs");
assert.deepEqual(meetPlan.args.slice(-3), ["--join", "--join-delay", "7"]);

const zoomPlan = createProviderPreparationPlan(zoomProvider, zoom, {
  cdp: "http://127.0.0.1:9223",
  participantName: "GPT-Live",
  requestJoin: true,
});
assert.equal(zoomPlan.initialUrl, "about:blank");
assert.equal(zoomPlan.urlTransport, "stdin");
assert.equal(zoomPlan.stdin, zoom.url);
assert.equal(zoomPlan.args.includes("--url-stdin"), true);
assert.equal(zoomPlan.args.includes("--join-delay"), false);

process.stdout.write("Meeting provider registry contract passed.\n");
