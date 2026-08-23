#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { connectToChromeOverCDP } from "../scripts/playwright-cdp.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = await mkdtemp(resolve(tmpdir(), "meetron-prepare-zoom-"));
const port = await new Promise((resolvePort, reject) => {
  const server = net.createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const allocated = server.address().port;
    server.close(() => resolvePort(allocated));
  });
});

const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--disable-background-networking",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let browser;
try {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false)) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  browser = await connectToChromeOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  await context.addInitScript(() => {
    const nativeEnumerate = navigator.mediaDevices?.enumerateDevices?.bind(navigator.mediaDevices);
    if (!nativeEnumerate) return;
    navigator.mediaDevices.enumerateDevices = async () => {
      const devices = await nativeEnumerate();
      const input = devices.find((device) => device.kind === "audioinput");
      const output = devices.find((device) => device.kind === "audiooutput") || input;
      return [
        ...devices,
        { kind: "audioinput", deviceId: input.deviceId, label: "Meetron: AI to Meeting (Virtual)" },
        { kind: "audiooutput", deviceId: output.deviceId, label: "Meetron: Meeting to AI (Virtual)" },
      ];
    };
  });
  const deviceShim = `<script>
    const nativeEnumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => {
      const devices = await nativeEnumerate();
      const input = devices.find((device) => device.kind === 'audioinput');
      const output = devices.find((device) => device.kind === 'audiooutput') || input;
      return [
        ...devices,
        { kind: 'audioinput', deviceId: input.deviceId, label: 'Meetron: AI to Meeting (Virtual)' },
        { kind: 'audiooutput', deviceId: output.deviceId, label: 'Meetron: Meeting to AI (Virtual)' },
      ];
    };
  </script>`;
  let invitationRequests = 0;
  let invitationSandbox = "";
  let directWebClientRequests = 0;
  let guardedWebClientRequests = 0;
  let topLevelPromotionAttempts = 0;
  await context.route("https://us02web.zoom.us/**", async (route) => {
    invitationRequests += 1;
    const parent = route.request().frame().parentFrame();
    invitationSandbox = await parent
      ?.locator("#meetron-zoom-invitation")
      .getAttribute("sandbox") || "";
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body>${deviceShim}<script>const appLaunch = document.createElement('iframe'); appLaunch.src = 'zoomus://zoom.us/join?confno=12345678901'; document.body.append(appLaunch);</script><button aria-label="Close">Close</button><button id="browser" onclick="location.href='https://app.zoom.us/wc/12345678901/join?pwd=fixture&amp;guarded=' + globalThis.__meetronZoomExternalLaunchGuard?.blocked">Join from browser</button></body></html>`,
    });
  });
  await context.route("https://app.zoom.us/wc/12345678901/join**", (route) => {
    directWebClientRequests += 1;
    if (new URL(route.request().url()).searchParams.get("guarded") === "1") {
      guardedWebClientRequests += 1;
    }
    const requestFrame = route.request().frame();
    if (requestFrame === requestFrame.page().mainFrame()) {
      topLevelPromotionAttempts += 1;
      if (topLevelPromotionAttempts === 1) {
        return route.fulfill({
          status: 503,
          contentType: "text/html",
          body: "<!doctype html><title>Temporary navigation failure</title>",
        });
      }
    }
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body>${deviceShim}<iframe id="webclient" src="https://app.zoom.us/wc/12345678901/client"></iframe></body></html>`,
    });
  });
  await context.route("https://app.zoom.us/wc/12345678901/client", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <input id="input-for-pwd">
        <input id="input-for-name">
        <input type="checkbox" checked>
        <div id="audio-wrapper">
          <button aria-label="More audio controls" onclick="document.querySelector('#audio-wrapper').classList.toggle('show');document.querySelector('#audio-menu').hidden=!document.querySelector('#audio-menu').hidden">Audio options</button>
          <div id="audio-menu" hidden>
            <a role="button" aria-label="Select a microphone Meetron: AI to Meeting (Virtual) unselect" onclick="selectDevice('microphone', this)">Meetron: AI to Meeting (Virtual)</a>
            <a role="button" aria-label="Select a speaker Meetron: Meeting to AI (Virtual) unselect" onclick="selectDevice('speaker', this)">Meetron: Meeting to AI (Virtual)</a>
          </div>
        </div>
        <button id="preview-audio-control-button" aria-label="Mute" onclick="window.__micToggleAttempts=(window.__micToggleAttempts||0)+1;if(window.__micToggleAttempts>=2)this.setAttribute('aria-label','Unmute')">Mute</button>
        <button id="preview-video-control-button" aria-label="Turn off video" onclick="this.setAttribute('aria-label','Turn on video')">Video</button>
        <button class="preview-join-button" onclick="document.body.innerHTML='<button aria-label=&quot;Unmute my microphone&quot;>Unmute</button><button aria-label=&quot;Leave Meeting&quot;>Leave</button>'">Join</button>
        <script>
          navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
            window.__fixtureVideoTracks = stream.getVideoTracks().length;
          });
          function selectDevice(kind, selected) {
            document.querySelectorAll('a[aria-label^="Select a ' + kind + '"]').forEach((option) => {
              const selectedState = option === selected && kind !== 'speaker' ? ' selected' : ' unselect';
              option.setAttribute('aria-label', option.getAttribute('aria-label').replace(/ (?:unselect|selected)$/, selectedState));
            });
            document.querySelector('#audio-wrapper').classList.remove('show');
            document.querySelector('#audio-menu').hidden = true;
            if (kind === 'speaker') {
              window.__micToggleAttempts = 0;
              document.querySelector('#preview-audio-control-button').setAttribute('aria-label', 'Mute');
            }
          }
        </script>
      </body></html>`,
    }),
  );

  let stdout = "";
  try {
    ({ stdout } = await execFileAsync(
      process.execPath,
      [
      resolve(repoRoot, "scripts/prepare-zoom.mjs"),
      "--cdp",
      `http://127.0.0.1:${port}`,
      "--url",
      "https://us02web.zoom.us/j/12345678901?pwd=fixture-secret",
      "--name",
      "GPT-Live",
      "--microphone-device",
      "Meetron: AI to Meeting",
      "--speaker-device",
      "Meetron: Meeting to AI",
      "--join",
      ],
      { cwd: repoRoot, timeout: 60_000 },
    ));
  } catch (error) {
    throw new Error(
      `Zoom preparation command failed (invitation=${invitationRequests}, direct=${directWebClientRequests}, top=${topLevelPromotionAttempts}, guarded=${guardedWebClientRequests}): ${error.stderr || error.message}`,
    );
  }
  const result = JSON.parse(stdout);
  const sandboxTokens = new Set(invitationSandbox.split(/\s+/).filter(Boolean));
  if (
    invitationRequests !== 1 ||
    !sandboxTokens.has("allow-scripts") ||
    !sandboxTokens.has("allow-same-origin") ||
    sandboxTokens.has("allow-popups") ||
    sandboxTokens.has("allow-top-navigation") ||
    sandboxTokens.has("allow-top-navigation-by-user-activation") ||
    sandboxTokens.has("allow-top-navigation-to-custom-protocols") ||
    directWebClientRequests < 1 ||
    guardedWebClientRequests < 1 ||
    topLevelPromotionAttempts < 2 ||
    result.connection !== "joined" ||
    result.microphone !== "muted" ||
    result.camera !== "off" ||
    result.meetingUrl.includes("pwd") ||
    !result.nameConfigured ||
    !result.microphoneMuted ||
    !result.cameraDisabled ||
    !result.zoomAudioDevices?.microphone?.configured ||
    !result.zoomAudioDevices?.speaker?.configured ||
    result.zoomAudioDevices?.speaker?.selected !== false ||
    result.zoomAudioDevices?.speaker?.requested !== true ||
    result.audioRouting?.inputLabel !== "Meetron: AI to Meeting (Virtual)" ||
    result.audioRouting?.outputLabel !== "Meetron: Meeting to AI (Virtual)" ||
    result.audioRouting?.videoRequests < 1
  ) {
    throw new Error(`Unexpected Zoom preparation result: ${stdout}`);
  }
  const preparedPage = context.pages().find((candidate) => /app\.zoom\.us\/wc\//.test(candidate.url()));
  if (!preparedPage || await preparedPage.locator("#meetron-zoom-invitation").count()) {
    throw new Error("Zoom Web Client was not promoted out of the invitation sandbox.");
  }
  if (await preparedPage.evaluate(() => globalThis.__fixtureVideoTracks) !== 0) {
    throw new Error("Zoom preparation exposed a physical or fake camera track.");
  }
} finally {
  await browser?.close().catch(() => {});
  chrome.kill();
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

process.stdout.write("Zoom mixed-language prejoin preparation and routing passed.\n");
