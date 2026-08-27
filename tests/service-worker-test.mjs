#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let messageListener;
let nativeMessageListener;
let nativeConnections = 0;

const chrome = {
  runtime: {
    id: "jlikakgdldiihhflkobhnpfegjlcakdd",
    getURL: (path) => `chrome-extension://jlikakgdldiihhflkobhnpfegjlcakdd${path}`,
    connectNative: () => {
      nativeConnections += 1;
      return {
        onMessage: { addListener: (listener) => { nativeMessageListener = listener; } },
        onDisconnect: { addListener: () => {} },
        postMessage: (message) => {
          nativeMessageListener?.({ ...message, ok: true, data: {} });
        },
      };
    },
    onMessage: {
      addListener: (listener) => {
        messageListener = listener;
      },
    },
  },
};

const source = await readFile(resolve(repoRoot, "extension/service-worker.js"), "utf8");
vm.runInNewContext(source, { chrome, URL, Error, Map, Set, Promise, setTimeout, clearTimeout });

function request(type, sender) {
  let response;
  const asynchronous = messageListener(
    { channel: "meeting-copilot", type: "native-request", request: { type, payload: {} } },
    sender,
    (value) => {
      response = value;
    },
  );
  return { asynchronous, response };
}

const foreign = request("status.get", {
  id: "another-extension",
  url: "https://meet.google.com/abc-defg-hij",
});
const privilegedFromMeet = request("setup.audio.configure", {
  id: chrome.runtime.id,
  url: "https://meet.google.com/abc-defg-hij",
});
const invalidMeetPath = request("status.get", {
  id: chrome.runtime.id,
  url: "https://meet.google.com/landing",
});
const invalidZoomPath = request("status.get", {
  id: chrome.runtime.id,
  url: "https://app.zoom.us/profile",
});

if (
  foreign.asynchronous !== false ||
  foreign.response?.ok !== false ||
  privilegedFromMeet.asynchronous !== false ||
  privilegedFromMeet.response?.ok !== false ||
  invalidMeetPath.asynchronous !== false ||
  invalidMeetPath.response?.ok !== false ||
  invalidZoomPath.asynchronous !== false ||
  invalidZoomPath.response?.ok !== false ||
  nativeConnections !== 0
) {
  throw new Error("Service worker accepted an unauthorized Native Host request.");
}

let screenshotResponse;
const screenshotAsynchronous = messageListener(
  {
    channel: "meeting-copilot",
    type: "native-request",
    request: { type: "visual-context.screenshot.send", payload: {} },
  },
  {
    id: chrome.runtime.id,
    url: "https://meet.google.com/abc-defg-hij",
  },
  (value) => { screenshotResponse = value; },
);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
if (screenshotAsynchronous !== true || screenshotResponse?.ok !== true) {
  throw new Error("Service worker rejected an authorized Meet screenshot request.");
}

let zoomScreenshotResponse;
const zoomScreenshotAsynchronous = messageListener(
  {
    channel: "meeting-copilot",
    type: "native-request",
    request: { type: "visual-context.screenshot.send", payload: {} },
  },
  {
    id: chrome.runtime.id,
    url: "https://app.zoom.us/wc/join/12345678901",
  },
  (value) => { zoomScreenshotResponse = value; },
);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
if (zoomScreenshotAsynchronous !== true || zoomScreenshotResponse?.ok !== true) {
  throw new Error("Service worker rejected an authorized Zoom screenshot request.");
}

let zoomResponse;
const zoomAsynchronous = messageListener(
  {
    channel: "meeting-copilot",
    type: "native-request",
    request: { type: "participant.mic.set", payload: { state: "unmuted" } },
  },
  {
    id: chrome.runtime.id,
    url: "https://app.zoom.us/wc/join/12345678901",
  },
  (value) => { zoomResponse = value; },
);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
if (zoomAsynchronous !== true || zoomResponse?.ok !== true || nativeConnections !== 1) {
  throw new Error("Service worker rejected an authorized Zoom meeting control request.");
}

let reconcileResponse;
const reconcileAsynchronous = messageListener(
  {
    channel: "meeting-copilot",
    type: "native-request",
    request: { type: "session.reconcile", payload: {} },
  },
  {
    id: chrome.runtime.id,
    url: "https://app.zoom.us/wc/12345678901/join",
  },
  (value) => { reconcileResponse = value; },
);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
if (reconcileAsynchronous !== true || reconcileResponse?.ok !== true) {
  throw new Error("Service worker rejected the dedicated Zoom reconciliation request.");
}

process.stdout.write("Service worker sender authorization passed.\n");
