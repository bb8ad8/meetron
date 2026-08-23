#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  activateLocator,
  clickFirstVisible,
  safePageUrl,
  waitForValue,
} from "../src/browser/meeting-browser.mjs";

function fakeLocator({ visible = true, clickError = null } = {}) {
  const calls = [];
  const locator = {
    calls,
    first() { return this; },
    nth() { return this; },
    async count() { return 1; },
    async isVisible() { return visible; },
    async click(options) {
      calls.push({ method: "click", options });
      if (clickError) throw clickError;
    },
    async evaluate(callback) {
      const element = { click: () => calls.push({ method: "dom-click" }) };
      return callback(element);
    },
  };
  return locator;
}

const stable = fakeLocator();
assert.equal(await activateLocator(stable), "click");
assert.equal(stable.calls[0].method, "click");

const cdpViewportMismatch = fakeLocator({ clickError: new Error("outside viewport") });
assert.equal(await activateLocator(cdpViewportMismatch), "dom-click");
assert.deepEqual(cdpViewportMismatch.calls.map(({ method }) => method), ["click", "dom-click"]);

const preferDom = fakeLocator();
assert.equal(await activateLocator(preferDom, { method: "dom" }), "dom-click");
assert.deepEqual(preferDom.calls.map(({ method }) => method), ["dom-click"]);

const hidden = fakeLocator({ visible: false });
const visible = fakeLocator();
assert.equal(await clickFirstVisible([hidden, visible]), true);
assert.equal(visible.calls[0].method, "click");

let readCount = 0;
assert.equal(
  await waitForValue(
    async () => (++readCount >= 3 ? "ready" : "pending"),
    "ready",
    { timeout: 100, interval: 1 },
  ),
  "ready",
);
assert.equal(readCount, 3);

assert.equal(
  safePageUrl({ url: () => "https://app.zoom.us/wc/123/join?pwd=secret#fragment" }),
  "https://app.zoom.us/wc/123/join",
);
assert.equal(safePageUrl({ url: () => "not a url" }), "");

process.stdout.write("Shared meeting browser interactions passed.\n");
