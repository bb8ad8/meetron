#!/usr/bin/env node

import { getAudioStatus } from "./audio-backend.mjs";
import { connectToChromeOverCDP } from "./playwright-cdp.mjs";
import {
  installZoomExternalAppLaunchGuard,
  normalizeZoomUrl,
  isZoomHostname,
  mountZoomBrowserInvitation,
  reconcileZoomWebSession,
  zoomDirectWebClientUrl,
  zoomAudioOptionSelector,
} from "../src/providers/zoom-web/zoom-web-provider.mjs";
import {
  clickFirstVisible,
  closeOtherPages,
  firstBrowserContext,
  locatorIsVisible as visible,
  pageMatchesHostname,
} from "../src/browser/meeting-browser.mjs";
import { resolveMeetingAudioDevices } from "../src/audio/meeting-audio-devices.mjs";
import {
  parsePreparationOptions,
  PREPARATION_EXIT_CODES,
  preparationUsage,
} from "../src/core/preparation-cli.mjs";
import { createPreparationResult } from "../src/core/participant-state.mjs";

function usage() {
  process.stdout.write(preparationUsage({
    providerLabel: "Zoom",
    scriptName: "prepare-zoom.mjs",
    allowUrlStdin: true,
  }));
}

let options;
try {
  options = parsePreparationOptions(process.argv.slice(2), { allowUrlStdin: true });
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  usage();
  process.exit(2);
}
if (options.help) { usage(); process.exit(0); }

let meeting;
try {
  meeting = normalizeZoomUrl(options.url);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}

Object.assign(options, await resolveMeetingAudioDevices(options, getAudioStatus));

const browser = await connectToChromeOverCDP(options.cdp);
const context = await firstBrowserContext(browser);
await installZoomExternalAppLaunchGuard(context);

for (const origin of [new URL(meeting.url).origin, "https://app.zoom.us"]) {
  await context.grantPermissions(["microphone", "camera"], { origin }).catch(() => {});
}

const existingZoomPages = context.pages().filter((candidate) =>
  pageMatchesHostname(candidate, isZoomHostname));
let page = [...context.pages()].reverse().find((candidate) => candidate.url() === "about:blank")
  || await context.newPage();
await closeOtherPages(existingZoomPages, page);

await context.addInitScript(({ inputDeviceId, inputLabel, outputDeviceId, outputLabel }) => {
  if (!(location.hostname === "zoom.us" || location.hostname.endsWith(".zoom.us"))) return;
  const markDedicatedParticipant = () => {
    if (!document.documentElement) return false;
    document.documentElement.setAttribute("data-meetron-dedicated-participant", "true");
    return true;
  };
  if (!markDedicatedParticipant()) {
    const markerObserver = new MutationObserver(() => {
      if (markDedicatedParticipant()) markerObserver.disconnect();
    });
    markerObserver.observe(document, { childList: true });
  }
  const state = {
    inputDeviceId,
    inputLabel,
    outputDeviceId,
    outputLabel,
    inputRequests: 0,
    inputTracks: [],
    videoRequests: 0,
    outputAttempts: 0,
    outputSuccesses: 0,
    failures: [],
  };
  Object.defineProperty(globalThis, "__meetronZoomAudioRouting", {
    configurable: true,
    value: state,
  });

  const resolveDeviceId = async (kind, label, fallbackId) => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const normalized = label.trim().toLowerCase();
    const device = devices.find((candidate) =>
      candidate.kind === kind && candidate.label.trim().toLowerCase().startsWith(normalized));
    return device?.deviceId || fallbackId;
  };

  if (globalThis.MediaDevices?.prototype?.getUserMedia) {
    const nativeGetUserMedia = MediaDevices.prototype.getUserMedia;
    MediaDevices.prototype.getUserMedia = async function meetronZoomGetUserMedia(constraints = {}) {
      const videoRequested = Boolean(constraints?.video);
      if (videoRequested) state.videoRequests += 1;
      if (!constraints?.audio) {
        // Meetron never sends video. Returning an empty stream prevents Zoom's
        // preview from activating the physical camera before its UI is muted.
        return videoRequested ? new MediaStream() : nativeGetUserMedia.call(this, constraints);
      }
      const requestedAudio = typeof constraints.audio === "object" ? constraints.audio : {};
      state.inputRequests += 1;
      const localInputDeviceId = await resolveDeviceId("audioinput", inputLabel, inputDeviceId);
      state.inputDeviceId = localInputDeviceId;
      const stream = await nativeGetUserMedia.call(this, {
        ...constraints,
        video: false,
        audio: { ...requestedAudio, deviceId: { exact: localInputDeviceId } },
      });
      for (const track of stream.getAudioTracks()) {
        state.inputTracks.push({
          deviceId: track.getSettings?.().deviceId || "",
          label: track.label || "",
        });
      }
      return stream;
    };
  }

  const routeElement = async (element) => {
    if (typeof element?.setSinkId !== "function") return;
    const localOutputDeviceId = await resolveDeviceId("audiooutput", outputLabel, outputDeviceId);
    state.outputDeviceId = localOutputDeviceId;
    if (element.sinkId === localOutputDeviceId) return;
    state.outputAttempts += 1;
    try {
      await element.setSinkId(localOutputDeviceId);
      state.outputSuccesses += 1;
    }
    catch (error) { state.failures.push(error.message); throw error; }
  };
  const routeQuietly = (element) => { void routeElement(element).catch(() => {}); };
  const NativeAudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (NativeAudioContext && typeof NativeAudioContext.prototype.setSinkId === "function") {
    function MeetronZoomAudioContext(contextOptions = {}) {
      const context = new NativeAudioContext(contextOptions);
      void resolveDeviceId("audiooutput", outputLabel, outputDeviceId)
        .then((localOutputDeviceId) => {
          state.outputDeviceId = localOutputDeviceId;
          state.outputAttempts += 1;
          return context.setSinkId(localOutputDeviceId);
        })
        .then(() => { state.outputSuccesses += 1; })
        .catch((error) => { state.failures.push(error.message); });
      return context;
    }
    Object.setPrototypeOf(MeetronZoomAudioContext, NativeAudioContext);
    MeetronZoomAudioContext.prototype = NativeAudioContext.prototype;
    if (globalThis.AudioContext === NativeAudioContext) globalThis.AudioContext = MeetronZoomAudioContext;
    if (globalThis.webkitAudioContext === NativeAudioContext) globalThis.webkitAudioContext = MeetronZoomAudioContext;
  }
  const nativeCreateElement = Document.prototype.createElement;
  Document.prototype.createElement = function meetronZoomCreateElement(...createArgs) {
    const element = nativeCreateElement.apply(this, createArgs);
    if (element instanceof HTMLMediaElement) routeQuietly(element);
    return element;
  };
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function meetronZoomPlay(...playArgs) {
    return routeElement(this).then(() => nativePlay.apply(this, playArgs));
  };
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLMediaElement) routeQuietly(node);
        if (node instanceof Element) node.querySelectorAll("audio,video").forEach(routeQuietly);
      }
    }
  }).observe(document, { childList: true, subtree: true });
}, {
  inputDeviceId: "",
  inputLabel: options.microphoneDevice,
  outputDeviceId: "",
  outputLabel: options.speakerDevice,
});

await page.bringToFront();
page.setDefaultTimeout(5_000);

async function clickIfVisible(locator) {
  return clickFirstVisible([locator], { force: true, timeout: 5_000 });
}

let browserJoinRequested = false;
let invitationPage = null;
let invitationFrame = null;
let webClientUrl = zoomDirectWebClientUrl(meeting.url);

const isWebClientPage = (candidate) => {
  if (!candidate || candidate.isClosed()) return false;
  try {
    const url = new URL(candidate.url());
    return isZoomHostname(url.hostname) && /\/wc\//.test(url.pathname);
  } catch {
    return false;
  }
};

async function webClientDocumentReady(candidate, { requireKnownSurface = false } = {}) {
  if (!isWebClientPage(candidate)) return false;
  const knownSurface = candidate.locator("#webclient, #input-for-name, button.preview-join-button");
  if (await knownSurface.count().catch(() => 0)) return true;
  if (requireKnownSurface) return false;
  const [title, bodyText, readyState] = await Promise.all([
    candidate.title().catch(() => ""),
    candidate.locator("body").innerText().catch(() => ""),
    candidate.evaluate(() => document.readyState).catch(() => "loading"),
  ]);
  if (/ERR_|site can.t be reached|ページにアクセスできません|このサイトにアクセスできません/i.test(bodyText)) {
    return false;
  }
  return readyState !== "loading" && /Zoom/i.test(title);
}

async function navigateWebClient(candidate, targetUrl) {
  let navigationError = null;
  let navigationCompleted = false;
  try {
    const response = await candidate.goto(targetUrl, { waitUntil: "domcontentloaded" });
    navigationCompleted = Boolean(response?.ok());
  } catch (error) {
    navigationError = error;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await webClientDocumentReady(candidate, { requireKnownSurface: !navigationCompleted })) {
      return { ready: true, navigationError, navigationCompleted };
    }
    await candidate.waitForTimeout(250).catch(() => {});
  }
  return { ready: false, navigationError, navigationCompleted };
}

let promotedPage = page;
let promotion = await navigateWebClient(promotedPage, webClientUrl);

if (!promotion.ready || !promotion.navigationCompleted) {
  // Regional or revised Zoom invitations can still require the public launch
  // page to mint their Web Client URL. Keep that slower path as a sandboxed
  // fallback, while the normal path avoids the native-app page entirely.
  invitationPage = promotedPage;
  invitationFrame = await mountZoomBrowserInvitation(invitationPage, meeting.url);
  await invitationFrame.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  await clickIfVisible(invitationFrame.getByRole("button", { name: /^(閉じる|Close)$/i }));
  const browserJoin = invitationFrame.getByRole("button", {
    name: /ブラウザから参加|Join from browser/i,
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (/\/wc\//.test(invitationFrame.url()) || await invitationFrame.locator("#webclient").count()) break;
    if (!browserJoinRequested && await visible(browserJoin)) {
      await browserJoin.first().click({ force: true }).catch(() => {});
      browserJoinRequested = true;
    }
    await invitationPage.waitForTimeout(250);
  }
  if (!/\/wc\//.test(invitationFrame.url()) && !(await invitationFrame.locator("#webclient").count())) {
    throw new Error("Zoom browser participation option was not available.");
  }
  await invitationFrame.waitForURL(/https:\/\/[^/]*zoom\.us\/wc\//, { timeout: 20_000 }).catch(() => {});
  webClientUrl = /\/wc\//.test(invitationFrame.url()) ? invitationFrame.url() : "";
  if (!webClientUrl) {
    const webClient = invitationFrame.locator("#webclient").first();
    const source = await webClient.getAttribute("src");
    if (source) webClientUrl = new URL(source, invitationFrame.url()).href;
  }
  if (!webClientUrl) throw new Error("Zoom Web Client URL was not created.");
  promotedPage = await context.newPage();
  promotion = await navigateWebClient(promotedPage, webClientUrl);
}

// Some Chrome/CDP combinations report a generated Zoom navigation as aborted
// even when opening the same URL as a fresh browser target succeeds. Preserve
// the sandboxed invitation while attempting that independent fallback.
if (!promotion.ready || !promotion.navigationCompleted) {
  if (promotedPage !== invitationPage) {
    await promotedPage.close({ runBeforeUnload: false }).catch(() => {});
  }
  const pagePromise = context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
  const session = await browser.newBrowserCDPSession();
  await session.send("Target.createTarget", { url: "about:blank" }).catch(() => {});
  await session.detach().catch(() => {});
  promotedPage = await pagePromise;
  if (promotedPage) {
    const pageSession = await context.newCDPSession(promotedPage).catch(() => null);
    await pageSession?.send("Page.navigate", { url: webClientUrl }).catch(() => {});
    await pageSession?.detach().catch(() => {});
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await webClientDocumentReady(promotedPage)) {
        promotion = {
          ready: true,
          navigationError: promotion.navigationError,
          navigationCompleted: true,
        };
        break;
      }
      await promotedPage.waitForTimeout(250).catch(() => {});
    }
  }
}

if (!promotion.ready || !promotedPage) {
  await promotedPage?.close({ runBeforeUnload: false }).catch(() => {});
  const diagnostic = createPreparationResult({
    providerId: meeting.providerId,
    meetingUrl: meeting.displayUrl,
    connection: "manual-action-required",
    microphone: "unavailable",
    camera: "unknown",
    actionRequired: "web-client-navigation",
    browserJoinRequested,
    invitationPreserved: !invitationPage.isClosed(),
  });
  process.stdout.write(`${JSON.stringify(diagnostic, null, 2)}\n`);
  process.exit(PREPARATION_EXIT_CODES.manualActionRequired);
}

page = promotedPage;
if (invitationPage && invitationPage !== promotedPage) {
  await invitationPage.close({ runBeforeUnload: false }).catch(() => {});
}
await page.bringToFront();
await page.waitForTimeout(300);

for (let attempt = 0; attempt < 2; attempt += 1) {
  const webClient = page.locator("#webclient");
  if (!(await webClient.count())) break;
  const source = await webClient.first().getAttribute("src");
  if (!source) break;
  const nestedNavigation = await navigateWebClient(page, new URL(source, page.url()).href);
  if (!nestedNavigation.ready) {
    throw new Error("Zoom Web Client nested navigation failed.");
  }
  await page.waitForTimeout(300);
}

const frame = page;
const routingDevices = await frame.locator("body").evaluate(async (_body, { inputName, outputName }) => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const find = (kind, name) => devices.find((device) =>
    device.kind === kind && device.label.trim().toLowerCase().startsWith(name.trim().toLowerCase()));
  const input = find("audioinput", inputName);
  const output = find("audiooutput", outputName);
  const state = globalThis.__meetronZoomAudioRouting;
  if (state && input) {
    state.inputDeviceId = input.deviceId;
    state.inputLabel = input.label;
  }
  if (state && output) {
    state.outputDeviceId = output.deviceId;
    state.outputLabel = output.label;
  }
  return {
    input: input ? { deviceId: input.deviceId, label: input.label } : null,
    output: output ? { deviceId: output.deviceId, label: output.label } : null,
    available: devices.map(({ kind, label }) => ({ kind, label })),
  };
}, { inputName: options.microphoneDevice, outputName: options.speakerDevice });

if (!routingDevices.input) {
  throw new Error(
    `Zoom microphone device was not found: ${options.microphoneDevice} (available: ${routingDevices.available.map(({ kind, label }) => `${kind}:${label}`).join(", ")})`,
  );
}
if (!routingDevices.output) {
  throw new Error(
    `Zoom speaker device was not found: ${options.speakerDevice} (available: ${routingDevices.available.map(({ kind, label }) => `${kind}:${label}`).join(", ")})`,
  );
}
await frame.locator("body").evaluate((_body, { input, output }) => {
  const state = globalThis.__meetronZoomAudioRouting;
  if (!state) return;
  state.inputDeviceId = input.deviceId;
  state.inputLabel = input.label;
  state.outputDeviceId = output.deviceId;
  state.outputLabel = output.label;
}, routingDevices);
const nameInput = frame.locator("#input-for-name");
try {
  await nameInput.waitFor({ state: "visible", timeout: 20_000 });
} catch {
  const bodyText = await frame.locator("body").innerText().catch(() => "");
  if (/このミーティングリンクは無効|ミーティングは終了|invalid meeting link|meeting has ended/i.test(bodyText)) {
    throw new Error("Zoom rejected the invitation because the meeting link is invalid or expired.");
  }
  throw new Error("Zoom Web Client pre-join screen did not become ready.");
}

// Zoom can show camera and microphone education dialogs in either language and
// can show them sequentially. Grant access, then enforce muted/camera-off below.
for (let attempt = 0; attempt < 3; attempt += 1) {
  const useMedia = frame.getByRole("button", {
    name: /マイクとカメラを使用|Use microphone and camera/i,
  });
  if (!(await clickIfVisible(useMedia))) break;
  await page.waitForTimeout(300);
}

await nameInput.fill(options.name);
const rememberName = frame.locator('input[type="checkbox"]');
if (await visible(rememberName)) await rememberName.first().uncheck().catch(() => {});

const passcodeInput = frame.locator("#input-for-pwd");
if (await visible(passcodeInput)) {
  const populated = await passcodeInput.first().evaluate((element) => Boolean(element.value));
  const passcode = new URL(meeting.url).searchParams.get("pwd") || "";
  if (!populated && passcode) await passcodeInput.first().fill(passcode);
  const ready = await passcodeInput.first().evaluate((element) => Boolean(element.value));
  if (!ready) throw new Error("Zoom requires a meeting passcode that was not present in the invitation URL.");
}

async function selectZoomAudioDevice(kind, deviceName) {
  const moreAudio = frame.locator('button[aria-label="More audio controls" i]').first();
  if (!(await visible(moreAudio))) {
    return { available: false, selected: false, configured: false, requested: false };
  }

  const option = frame
    .locator(zoomAudioOptionSelector(kind))
    .filter({ hasText: deviceName })
    .first();
  const openMenu = async () => {
    const shown = await moreAudio.evaluate((element) => element.parentElement?.classList.contains("show"));
    if (!shown) await moreAudio.evaluate((element) => element.click());
    await page.waitForTimeout(200);
  };

  await openMenu();
  if (!(await visible(option))) {
    await page.keyboard.press("Escape").catch(() => {});
    return { available: true, selected: false, configured: false, requested: false };
  }

  const readSelection = async () => option.evaluate((element) => {
    const action = element.getAttribute("aria-label") || "";
    const selected =
      / selected$/i.test(action) ||
      element.getAttribute("aria-checked") === "true" ||
      element.getAttribute("aria-selected") === "true" ||
      element.getAttribute("data-selected") === "true" ||
      /(?:^|\s)(?:active|selected)(?:\s|$)/i.test(element.className) ||
      Boolean(element.querySelector('[aria-checked="true"], [aria-selected="true"], [data-selected="true"], [class*="check" i]'));
    return { action, selected };
  });

  let selection = await readSelection();
  let requested = false;
  if (!selection.selected) {
    await option.evaluate((element) => element.click());
    requested = true;
    await page.waitForTimeout(500);
    await openMenu().catch(() => {});
    if (await visible(option)) selection = await readSelection();
  }
  await page.keyboard.press("Escape").catch(() => {});
  return {
    available: true,
    selected: selection.selected,
    // Zoom sometimes closes and rebuilds this menu before it exposes a
    // machine-readable selected state. A successful DOM click is still strong
    // evidence that the requested device was applied. Admission can replace
    // the settings menu entirely, so this pre-join evidence must be retained.
    configured: selection.selected || requested,
    requested,
    action: selection.action,
  };
}

let zoomAudioDevices = {
  microphone: { available: false, selected: false, configured: false, requested: false },
  speaker: { available: false, selected: false, configured: false, requested: false },
};

async function ensureControlOff(selector, onAction, offAction, offSvg, label, { optional = false } = {}) {
  const control = frame.locator(selector).first();
  try {
    await control.waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    if (optional) return { action: "unavailable", disabled: true, svg: "" };
    throw error;
  }
  let lastState = { action: "", svg: "" };

  const readState = () => control.evaluate((element) => ({
    action: element.getAttribute("aria-label") || "",
    disabled: element.disabled || element.getAttribute("aria-disabled") === "true",
    svg: [...element.querySelectorAll("svg")]
      .map((svg) => svg.getAttribute("class") || "")
      .join(" "),
  }));
  const isOff = (state) =>
    offAction.test(state.action) || offSvg.test(state.svg) || /Disallowed/i.test(state.svg);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await readState();
    lastState = state;
    if (isOff(state)) {
      await page.waitForTimeout(400);
      const stableState = await readState();
      lastState = stableState;
      if (isOff(stableState)) return stableState;
      continue;
    }
    if (state.disabled) throw new Error(`Zoom ${label} control is disabled without a safe off state.`);
    if (!onAction.test(state.action)) break;

    // Zoom rebuilds the media controller after device changes. A DOM click is
    // more reliable than a viewport click during that transition.
    await control.evaluate((element) => element.click());
    for (let poll = 0; poll < 10; poll += 1) {
      await page.waitForTimeout(200);
      const changedState = await readState();
      lastState = changedState;
      if (!isOff(changedState)) continue;
      await page.waitForTimeout(400);
      const stableState = await readState();
      lastState = stableState;
      if (isOff(stableState)) return stableState;
    }

    if (attempt === 2 && label === "microphone") {
      await page.keyboard.press("Alt+A").catch(() => {});
      await page.waitForTimeout(600);
    }
  }
  throw new Error(
    `Zoom ${label} could not be verified as off (action: ${lastState.action || "missing"}, icon: ${lastState.svg || "missing"}).`,
  );
}

const microphoneState = await ensureControlOff(
  "#preview-audio-control-button",
  /^(ミュート|Mute|Turn off microphone)$/i,
  /^(ミュート解除|Unmute|Turn on microphone|オーディオに(?:参加|接続)|Join Audio|Connect to Audio)$/i,
  /SvgAudioUnmute/i,
  "microphone",
);
const cameraState = await ensureControlOff(
  "#preview-video-control-button",
  /ビデオをオフ|Stop video|Turn off (?:camera|video)/i,
  /ビデオをオン|Start video|Turn on (?:camera|video)/i,
  /SvgVideo(?:On|Start)/i,
  "camera",
  { optional: true },
);

// Zoom can rebuild its microphone stream when a device is selected. Establish
// the safe preview state first, select the real Zoom UI devices (WebRTC output
// bypasses setSinkId hooks), then verify muted state again after reinitializing.
zoomAudioDevices = {
  microphone: await selectZoomAudioDevice("microphone", options.microphoneDevice),
  speaker: await selectZoomAudioDevice("speaker", options.speakerDevice),
};
await page.waitForTimeout(2_500);
await ensureControlOff(
  "#preview-audio-control-button",
  /^(ミュート|Mute|Turn off microphone)$/i,
  /^(ミュート解除|Unmute|Turn on microphone|オーディオに(?:参加|接続)|Join Audio|Connect to Audio)$/i,
  /SvgAudioUnmute/i,
  "microphone",
);

if (
  options.join &&
  (!zoomAudioDevices.microphone.configured || !zoomAudioDevices.speaker.configured)
) {
  const diagnostic = createPreparationResult({
    providerId: meeting.providerId,
    meetingUrl: meeting.displayUrl,
    connection: "manual-action-required",
    microphone: "muted",
    camera: "off",
    actionRequired: "audio-device-check",
    microphoneMuted: true,
    cameraDisabled: true,
    zoomAudioDevices,
  });
  process.stdout.write(`${JSON.stringify(diagnostic, null, 2)}\n`);
  process.exit(PREPARATION_EXIT_CODES.manualActionRequired);
}

let connection = "prejoin";
const waitingRoomPattern = /待機室|ホストがあなたの参加を許可|あなたが入室していることがホストに知らされました|ホストが参加しました|waiting room|host will let you in|host has been notified/i;
const readRouting = () => frame.locator("body").evaluate(() => {
  const state = globalThis.__meetronZoomAudioRouting;
  return state ? {
    inputLabel: state.inputLabel,
    outputLabel: state.outputLabel,
    inputRequests: state.inputRequests,
    inputTracks: state.inputTracks,
    videoRequests: state.videoRequests,
    outputAttempts: state.outputAttempts,
    outputSuccesses: state.outputSuccesses,
    failures: state.failures,
  } : null;
});

let routing = await readRouting();
const inputRouteFailed = routing?.inputRequests > 0 && routing.inputTracks.length === 0;
const outputRouteFailed = routing?.outputAttempts > 0 && routing.outputSuccesses === 0;
if (!routing || inputRouteFailed || outputRouteFailed) {
  throw new Error(`Zoom audio input routing hook failed: ${routing?.failures?.join(", ") || "no Meetron input track"}`);
}

if (options.join) {
  const join = frame.locator("button.preview-join-button");
  await join.first().waitFor({ state: "visible", timeout: 10_000 });
  await join.first().evaluate((element) => element.click());
  const body = frame.locator("body");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const text = await body.innerText().catch(() => "");
    if (waitingRoomPattern.test(text)) {
      connection = "waiting";
      break;
    }
    if (/ミーティングに参加しています|Joining (?:the )?meeting/i.test(text)) {
      await page.waitForTimeout(250);
      continue;
    }
    const leave = frame.getByRole("button", { name: /退出|ミーティングを退出|Leave|Leave Meeting/i });
    if (await visible(leave)) {
      await page.waitForTimeout(400);
      const settledText = await body.innerText().catch(() => "");
      if (waitingRoomPattern.test(settledText)) {
        connection = "waiting";
        break;
      }
      const meetingToolbar = frame.locator(
        'button[aria-label="audio" i], button[aria-label^="mute my microphone" i], button[aria-label^="unmute my microphone" i], button[aria-label*="participants list pane" i]',
      );
      if (await visible(meetingToolbar)) {
        connection = "joined";
        break;
      }
    }
    if (/パスコードが正しくありません|incorrect passcode|unable to join|参加できません/i.test(text)) {
      throw new Error("Zoom rejected the meeting passcode or admission request.");
    }
    await page.waitForTimeout(250);
  }
  if (connection === "prejoin") {
    const diagnostic = createPreparationResult({
      providerId: meeting.providerId,
      meetingUrl: meeting.displayUrl,
      connection: "manual-action-required",
      microphone: "muted",
      camera: "off",
      actionRequired: "admission-status-check",
      joinButtonVisible: await visible(join),
      joinButtonDisabled: await join.first().isDisabled().catch(() => false),
      leaveButtonVisible: await visible(
        frame.getByRole("button", { name: /退出|ミーティングを退出|Leave|Leave Meeting/i }),
      ),
      microphoneMuted: true,
      cameraDisabled: true,
      zoomAudioDevices,
    });
    process.stdout.write(`${JSON.stringify(diagnostic, null, 2)}\n`);
    process.exit(PREPARATION_EXIT_CODES.manualActionRequired);
  }

  if (connection === "joined") {
    await page.waitForTimeout(1_500);
    const settledText = await body.innerText().catch(() => "");
    if (waitingRoomPattern.test(settledText)) connection = "waiting";
  }

  // Output media objects are commonly created only after the admission click.
  // A camera-not-found notice is non-fatal because Meetron always keeps video
  // disabled, but an audio routing failure must immediately remove the bot.
  await clickIfVisible(frame.getByRole("button", { name: /^(了解しました|Got it|OK)$/i }));
  await page.waitForTimeout(500);

  if (connection === "joined") {
    const readiness = await reconcileZoomWebSession(browser, visible, {
      desiredMicrophone: "muted",
    });
    if (!readiness.ready) {
      throw new Error(
        `Zoom computer audio could not be connected after admission (${readiness.reason || "unknown"}).`,
      );
    }
  }

  routing = await readRouting();
  const admittedOutputFailed = routing?.outputAttempts > 0 && routing.outputSuccesses === 0;
  if (!routing || admittedOutputFailed) {
    const leave = frame.getByRole("button", { name: /^(退出|Leave|Leave Meeting)$/i });
    if (await clickIfVisible(leave)) {
      await page.waitForTimeout(200);
      await clickIfVisible(frame.getByRole("button", { name: /ミーティングを退出|Leave Meeting/i }));
    }
    throw new Error(`Zoom audio output routing failed after admission: ${routing?.failures?.join(", ") || "missing"}`);
  }
}

process.stdout.write(`${JSON.stringify(createPreparationResult({
  providerId: meeting.providerId,
  meetingUrl: meeting.displayUrl,
  connection,
  microphone: "muted",
  camera: "off",
  nameConfigured: true,
  microphoneMuted: true,
  cameraDisabled: true,
  zoomAudioDevices,
  audioRouting: {
    ...routing,
    inputTracks: routing.inputTracks.map(({ label }) => ({ label })),
    failures: routing.outputSuccesses > 0 ? [] : routing.failures,
  },
}), null, 2)}\n`);
process.exit(0);
