#!/usr/bin/env node

import { chromium } from "playwright-core";
import {
  getZoomWebStatus,
  leaveZoomWeb,
  reconcileZoomWebSession,
  setZoomWebMicrophone,
  zoomAudioOptionSelector,
} from "../src/providers/zoom-web/zoom-web-provider.mjs";

const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext();

async function locatorIsVisible(locator) {
  return (await locator.count()) > 0 && (await locator.first().isVisible());
}

const preparationPage = await context.newPage();
await preparationPage.setContent(
  '<!doctype html><html data-meetron-zoom-preparation="true"><title>Zoom - Meetron</title></html>',
);
const preparation = await getZoomWebStatus(browser, locatorIsVisible);
if (preparation.connection !== "prejoin" || preparation.title !== "Zoom - Meetron") {
  throw new Error(`Zoom preparation page was reported as not running: ${JSON.stringify(preparation)}`);
}
await preparationPage.close();

const selectorPage = await context.newPage();
await selectorPage.setContent(`
  <ul role="menu">
    <li role="menuitemradio" aria-label="マイクを選択 Meetron: AI to Meeting (Virtual)" aria-checked="false">Meetron: AI to Meeting (Virtual)</li>
    <li role="menuitemradio" aria-label="スピーカーを選択 Meetron: Meeting to AI (Virtual)" aria-checked="true">Meetron: Meeting to AI (Virtual)</li>
  </ul>
`);
if (
  (await selectorPage.locator(zoomAudioOptionSelector("microphone")).count()) !== 1 ||
  (await selectorPage.locator(zoomAudioOptionSelector("speaker")).count()) !== 1
) {
  throw new Error("Zoom localized audio menu selectors did not match Chrome 151 markup.");
}
await selectorPage.close();
await context.route("https://us02web.zoom.us/**", (route) =>
  route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html><html><head><title>Zoom fixture</title></head><body><iframe id="webclient" src="https://app.zoom.us/wc/12345678901/client"></iframe></body></html>`,
  }),
);
await context.route("https://app.zoom.us/wc/12345678901/client", (route) =>
  route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html><html><body>
      <button id="audio" aria-label="オーディオに接続">Audio</button>
      <div id="audio-dialog" hidden>
        <button id="computer-audio">Join with Computer Audio</button>
      </div>
      <button id="leave" aria-label="Leave">Leave</button>
      <button id="camera" aria-label="ビデオをオフにする">Camera</button>
      <script>
        document.querySelector('#audio').addEventListener('click', () => {
          document.querySelector('#audio-dialog').hidden = false;
        });
        document.querySelector('#computer-audio').addEventListener('click', () => {
          document.querySelector('#audio-dialog').remove();
          const control = document.querySelector('#audio');
          control.id = 'mic';
          control.setAttribute('aria-label', 'Unmute');
        });
        document.body.addEventListener('click', (event) => {
          if (event.target.id === 'mic') {
            event.target.setAttribute(
              'aria-label',
              event.target.getAttribute('aria-label') === 'Unmute' ? 'Mute' : 'Unmute',
            );
          }
          if (event.target.id === 'camera') {
            event.target.setAttribute('aria-label', 'ビデオをオンにする');
          }
        });
      </script>
    </body></html>`,
  }),
);
const page = await context.newPage();
await page.goto("https://us02web.zoom.us/wc/12345678901/join?pwd=must-be-redacted");

const webClientFrame = page.frames().find((frame) => frame !== page.mainFrame());
await webClientFrame.evaluate(() => {
  const preview = document.createElement("button");
  preview.id = "preview-audio-control-button";
  preview.setAttribute("aria-label", "ミュート解除");
  document.body.prepend(preview);
});

const before = await getZoomWebStatus(browser, locatorIsVisible);
const reconciled = await reconcileZoomWebSession(browser, locatorIsVisible, {
  status: before,
  desiredMicrophone: "muted",
});
const afterReconcile = await getZoomWebStatus(browser, locatorIsVisible);
if (
  !reconciled.ready ||
  !reconciled.cameraChanged ||
  afterReconcile.microphone !== "muted" ||
  afterReconcile.camera !== "off"
) {
  const diagnosticFrame = page.frames().find((frame) => frame !== page.mainFrame());
  const diagnostic = await diagnosticFrame.evaluate(() => ({
    html: document.body.innerHTML,
    audioVisible: Boolean(document.querySelector("#audio")?.getClientRects().length),
  }));
  throw new Error(`Zoom computer audio fixture did not reconcile: ${JSON.stringify({ before, reconciled, afterReconcile, diagnostic })}`);
}
await webClientFrame.locator("#preview-audio-control-button").evaluate((element) => element.remove());
await webClientFrame.evaluate(() => {
  const notice = document.createElement("p");
  notice.id = "waiting-room-notice";
  notice.textContent = "ホストが参加しました。あなたが入室していることがホストに知らされました。";
  document.body.append(notice);
  for (const control of document.querySelectorAll("#leave, #mic, #audio")) {
    control.hidden = true;
  }
});
const waiting = await getZoomWebStatus(browser, locatorIsVisible);
await webClientFrame.locator("#waiting-room-notice").evaluate((element) => {
  element.remove();
  for (const control of document.querySelectorAll("#leave, #mic, #audio")) {
    control.hidden = false;
  }
});
const unmuted = await setZoomWebMicrophone(browser, locatorIsVisible, "unmuted");
const muted = await setZoomWebMicrophone(browser, locatorIsVisible, "muted");
if (
    before.connection !== "joined" ||
    before.audioConnection !== "disconnected" ||
    before.microphone !== "unavailable" ||
    !reconciled.ready ||
    !reconciled.audioJoinRequested ||
    afterReconcile.audioConnection !== "connected" ||
    afterReconcile.microphone !== "muted" ||
    waiting.connection !== "waiting" ||
  before.url.includes("pwd") ||
  unmuted.after !== "unmuted" ||
  unmuted.interaction !== "dom-click" ||
  !unmuted.verified ||
  muted.after !== "muted" ||
  !muted.verified
) {
  throw new Error(`Unexpected Zoom provider state: ${JSON.stringify({ before, reconciled, afterReconcile, unmuted, muted })}`);
}

const left = await leaveZoomWeb(browser, locatorIsVisible);
if (!left.left || !left.tabClosed || !page.isClosed()) {
  throw new Error(`Zoom provider did not close the meeting page: ${JSON.stringify(left)}`);
}
await browser.close();
process.stdout.write("Zoom Web provider status, microphone, redaction, and leave passed.\n");
