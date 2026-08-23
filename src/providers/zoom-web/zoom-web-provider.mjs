import { createRuntimeProvider } from "../provider-contract.mjs";
import { MeetronError } from "../../core/errors.mjs";
import {
  activateLocator,
  allBrowserPages,
  safePageUrl,
  waitForValue,
} from "../../browser/meeting-browser.mjs";

const MEETING_PATHS = Object.freeze([
  /^\/j\/(\d{9,11})\/?$/,
  /^\/wc\/join\/(\d{9,11})\/?$/,
  /^\/wc\/(\d{9,11})\/join\/?$/,
]);

export function isZoomHostname(hostname) {
  const value = String(hostname || "").toLowerCase();
  return value === "zoom.us" || /^[a-z0-9-]+\.zoom\.us$/.test(value);
}

export function zoomAudioOptionSelector(kind) {
  if (!new Set(["microphone", "speaker"]).has(kind)) {
    throw new MeetronError("INVALID_AUDIO_DEVICE_KIND", `Unsupported Zoom audio device kind: ${kind}`);
  }
  const localizedKind = kind === "microphone" ? "マイク" : "スピーカー";
  return [
    `[role="menuitemradio"][aria-label^="${localizedKind}を選択"]`,
    `[role="menuitemradio"][aria-label^="Select a ${kind}" i]`,
    `a[aria-label^="${localizedKind}を選択"]`,
    `a[aria-label^="Select a ${kind}" i]`,
  ].join(", ");
}

export function normalizeZoomUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new MeetronError("INVALID_MEETING_URL", "有効なZoom招待URLを入力してください");
  }

  const pathMatch = MEETING_PATHS.map((pattern) => url.pathname.match(pattern)).find(Boolean);
  if (
    url.protocol !== "https:" ||
    !isZoomHostname(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !pathMatch
  ) {
    throw new MeetronError(
      "UNSUPPORTED_MEETING_URL",
      "https://zoom.us/j/123456789 形式のZoom招待URLを入力してください",
    );
  }

  const meetingId = pathMatch[1];
  const passcode = url.searchParams.get("pwd");
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  if (passcode) url.searchParams.set("pwd", passcode);
  url.hash = "";

  const displayUrl = new URL(url);
  displayUrl.search = "";
  return {
    providerId: "zoom-web",
    url: url.toString(),
    displayUrl: displayUrl.toString(),
    meetingKey: `${url.hostname}:${meetingId}`,
    containsSecret: Boolean(passcode),
  };
}

export function zoomBrowserInvitationUrl(value) {
  const meeting = normalizeZoomUrl(value);
  const invitation = new URL(meeting.url);
  // Zoom's launch page treats this fragment as confirmation that the native
  // app launch step has already completed. The browser sandbox below remains
  // the enforcement boundary; this marker only avoids a redundant attempt.
  invitation.hash = "success";
  return invitation.toString();
}

export function zoomDirectWebClientUrl(value) {
  const meeting = normalizeZoomUrl(value);
  const meetingId = meeting.meetingKey.slice(meeting.meetingKey.lastIndexOf(":") + 1);
  const webClient = new URL(`https://app.zoom.us/wc/${meetingId}/join`);
  const passcode = new URL(meeting.url).searchParams.get("pwd");
  if (passcode) webClient.searchParams.set("pwd", passcode);
  return webClient.toString();
}

export async function installZoomExternalAppLaunchGuard(context) {
  await context.addInitScript(() => {
    if (!(location.hostname === "zoom.us" || location.hostname.endsWith(".zoom.us"))) return;

    const externalZoomProtocol = /^(?:zoommtg|zoomus|zoomusm):/i;
    const guardState = { blocked: 0, schemes: [] };
    Object.defineProperty(globalThis, "__meetronZoomExternalLaunchGuard", {
      configurable: true,
      value: guardState,
    });
    const block = (value) => {
      const candidate = String(value || "");
      if (!externalZoomProtocol.test(candidate)) return false;
      guardState.blocked += 1;
      const scheme = candidate.slice(0, candidate.indexOf(":"));
      if (!guardState.schemes.includes(scheme)) guardState.schemes.push(scheme);
      return true;
    };

    // Zoom's current launch page uses a hidden iframe for the automatic
    // desktop-app handoff. Cover the equivalent link/window paths as well so
    // a page revision cannot surface a native application modal in Meetron's
    // dedicated browser.
    const iframeSource = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
    if (iframeSource?.set) {
      Object.defineProperty(HTMLIFrameElement.prototype, "src", {
        ...iframeSource,
        set(value) {
          if (!block(value)) iframeSource.set.call(this, value);
        },
      });
    }

    const nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function meetronZoomSetAttribute(name, value) {
      const navigationAttribute = /^(?:src|href|action)$/i.test(String(name));
      if (navigationAttribute && block(value)) return;
      return nativeSetAttribute.call(this, name, value);
    };

    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function meetronZoomAnchorClick() {
      if (block(this.href)) return;
      return nativeAnchorClick.call(this);
    };

    const nativeOpen = globalThis.open;
    globalThis.open = function meetronZoomWindowOpen(url, ...args) {
      if (block(url)) return null;
      return nativeOpen.call(this, url, ...args);
    };

    document.addEventListener("click", (event) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor || !block(anchor.href)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  });
}

export async function mountZoomBrowserInvitation(page, value) {
  const invitationUrl = zoomBrowserInvitationUrl(value);
  // A secure local-looking origin is required because browsers do not expose
  // enumerateDevices/getUserMedia to an about:blank top-level document.
  const shellUrl = "https://meetron.localhost/zoom-preparation";
  const shellMarkup = `<!doctype html>
<html lang="ja" data-meetron-zoom-preparation="true">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Zoom - Meetron</title>
    <style>
      html,body,#meetron-zoom-invitation{border:0;height:100%;margin:0;padding:0;width:100%}
      #meetron-zoom-status{align-items:center;background:#f8f9fa;color:#202124;display:flex;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;inset:0;justify-content:center;position:fixed;z-index:1}
    </style>
  </head>
  <body>
    <div id="meetron-zoom-status">MeetronがZoomを準備しています…</div>
    <iframe
      id="meetron-zoom-invitation"
      title="Zoom meeting invitation"
      sandbox="allow-downloads allow-forms allow-same-origin allow-scripts"
      allow="autoplay; camera; microphone"
    ></iframe>
  </body>
</html>`;
  await page.route(shellUrl, (route) => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: shellMarkup,
  }));
  try {
    await page.goto(shellUrl, { waitUntil: "domcontentloaded" });
  } finally {
    await page.unroute(shellUrl);
  }
  const invitation = page.locator("#meetron-zoom-invitation");
  await invitation.evaluate((element, source) => {
    element.addEventListener("load", () => {
      document.querySelector("#meetron-zoom-status")?.remove();
    }, { once: true });
    element.src = source;
  }, invitationUrl);
  const handle = await invitation.elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("Zoom invitation sandbox could not be created.");
  await frame.waitForURL((candidate) => {
    try {
      return isZoomHostname(new URL(candidate).hostname);
    } catch {
      return false;
    }
  }, { timeout: 15_000 });
  await frame.waitForLoadState("domcontentloaded", { timeout: 15_000 });
  return frame;
}

export const zoomWebDefinition = Object.freeze({
  id: "zoom-web",
  label: "Zoom Web App",
  automation: Object.freeze({
    initialPage: "blank",
    preparationScript: "prepare-zoom.mjs",
    urlTransport: "stdin",
    supportsJoinDelay: false,
  }),
  capabilities: Object.freeze({
    audioSelection: "provider-ui-and-browser-hook",
    camera: "optional-off",
    postJoinMicrophone: "muted",
    waitingRoom: true,
  }),
  matchUrl(value) {
    try {
      normalizeZoomUrl(value);
      return true;
    } catch {
      return false;
    }
  },
  normalizeUrl: normalizeZoomUrl,
});

export function findZoomPage(browser) {
  return allBrowserPages(browser)
    .reverse()
    .find((candidate) => {
      try {
        return isZoomHostname(new URL(candidate.url()).hostname);
      } catch {
        return false;
      }
    });
}

async function zoomSurface(page) {
  return (await page.locator("#webclient").count()) > 0
    ? page.frameLocator("#webclient")
    : page;
}

function zoomMicrophoneControls(surface) {
  return {
    turnOn: surface.locator(
      'button:not(#preview-audio-control-button)[aria-label^="ミュート解除"], button:not(#preview-audio-control-button)[aria-label^="オーディオをオン"], button:not(#preview-audio-control-button)[aria-label^="Unmute" i], button:not(#preview-audio-control-button)[aria-label^="Turn on microphone" i]',
    ),
    turnOff: surface.locator(
      'button:not(#preview-audio-control-button)[aria-label="ミュート"], button:not(#preview-audio-control-button)[aria-label^="オーディオをミュート"], button:not(#preview-audio-control-button)[aria-label="Mute" i], button:not(#preview-audio-control-button)[aria-label^="Mute my microphone" i], button:not(#preview-audio-control-button)[aria-label^="Mute my audio" i], button:not(#preview-audio-control-button)[aria-label^="Turn off microphone" i]',
    ),
  };
}

function zoomCameraControls(surface) {
  return {
    turnOn: surface.locator(
      'button:not(#preview-video-control-button)[aria-label^="ビデオをオン"], button:not(#preview-video-control-button)[aria-label^="Start video" i], button:not(#preview-video-control-button)[aria-label^="Turn on camera" i], button:not(#preview-video-control-button)[aria-label^="Turn on video" i]',
    ),
    turnOff: surface.locator(
      'button:not(#preview-video-control-button)[aria-label^="ビデオをオフ"], button:not(#preview-video-control-button)[aria-label^="Stop video" i], button:not(#preview-video-control-button)[aria-label^="Turn off camera" i], button:not(#preview-video-control-button)[aria-label^="Turn off video" i]',
    ),
  };
}

function zoomComputerAudioControls(surface) {
  return {
    entry: surface.getByRole("button", {
      name: /^(?:オーディオに(?:接続|参加)|Join Audio|Connect (?:to )?Audio)/i,
    }),
    confirm: surface.getByRole("button", {
      name: /^(?:コンピュータ(?:ー)?(?:の|\s*)オーディオ(?:で|に)?参加(?:する)?|Join with Computer Audio|Join Audio by Computer|Join Computer Audio)$/i,
    }),
    useMedia: surface.getByRole("button", {
      name: /^(?:マイクとカメラを使用|Use microphone and camera)$/i,
    }),
  };
}

async function getZoomMicrophoneState(surface, locatorIsVisible) {
  const { turnOn, turnOff } = zoomMicrophoneControls(surface);
  if (await locatorIsVisible(turnOn)) return "muted";
  if (await locatorIsVisible(turnOff)) return "unmuted";
  return "unavailable";
}

async function getZoomCameraState(surface, locatorIsVisible) {
  const { turnOn, turnOff } = zoomCameraControls(surface);
  if (await locatorIsVisible(turnOn)) return "off";
  if (await locatorIsVisible(turnOff)) return "on";
  return "unavailable";
}

async function getZoomAudioConnectionState(surface, locatorIsVisible, microphone) {
  if (new Set(["muted", "unmuted"]).has(microphone)) return "connected";
  const { entry, confirm } = zoomComputerAudioControls(surface);
  if (await locatorIsVisible(confirm) || await locatorIsVisible(entry)) return "disconnected";
  return "unknown";
}

export async function getZoomWebStatus(browser, locatorIsVisible) {
  const page = findZoomPage(browser);
  if (!page) {
    const preparationPages = await Promise.all(
      allBrowserPages(browser).map(async (candidate) => ({
        page: candidate,
        preparing: await candidate
          .locator('html[data-meetron-zoom-preparation="true"]')
          .count()
          .then((count) => count > 0)
          .catch(() => false),
      })),
    );
    const preparation = preparationPages.find((candidate) => candidate.preparing)?.page;
    if (preparation) {
      return {
        browserConnected: true,
        connection: "prejoin",
        microphone: "unavailable",
        camera: "unknown",
        audioConnection: "unknown",
        url: "",
        title: await preparation.title().catch(() => "Zoom - Meetron"),
      };
    }
    return {
      browserConnected: true,
      connection: "not-running",
      microphone: "unavailable",
      camera: "unknown",
      audioConnection: "unknown",
    };
  }

  const surface = await zoomSurface(page);
  const leave = surface.getByRole("button", { name: /退出|ミーティングを退出|Leave|Leave Meeting/i });
  const [microphone, camera, leaveVisible, bodyText] = await Promise.all([
    getZoomMicrophoneState(surface, locatorIsVisible),
    getZoomCameraState(surface, locatorIsVisible),
    locatorIsVisible(leave),
    surface.locator("body").innerText().catch(() => ""),
  ]);

  const audioConnection = await getZoomAudioConnectionState(
    surface,
    locatorIsVisible,
    microphone,
  );
  let connection = "prejoin";
  if (
    leaveVisible &&
    (audioConnection === "connected" || audioConnection === "disconnected")
  ) {
    // A visible in-meeting audio control is stronger admission evidence than
    // stale waiting-room text left behind by Zoom's client-side transition.
    connection = "joined";
  } else if (/待機室|ホストがあなたの参加を許可|あなたが入室していることがホストに知らされました|ホストが参加しました|waiting room|host will let you in|host has been notified/i.test(bodyText)) {
    connection = "waiting";
  } else if (leaveVisible) {
    connection = "joined";
  } else if (/参加できません|ミーティングは終了|unable to join|meeting has ended|invalid meeting/i.test(bodyText)) {
    connection = "rejected";
  }

  return {
    browserConnected: true,
    connection,
    microphone,
    camera,
    audioConnection,
    url: safePageUrl(page),
    title: await page.title(),
  };
}

export async function reconcileZoomWebSession(
  browser,
  locatorIsVisible,
  { status: suppliedStatus, desiredMicrophone = "muted" } = {},
) {
  const page = findZoomPage(browser);
  if (!page) return { ready: false, changed: false, reason: "not-running" };

  let status = suppliedStatus || await getZoomWebStatus(browser, locatorIsVisible);
  if (status.connection !== "joined") {
    return { ready: false, changed: false, reason: status.connection };
  }

  const surface = await zoomSurface(page);
  const controls = zoomComputerAudioControls(surface);
  let changed = false;
  let audioJoinRequested = false;

  if (status.audioConnection !== "connected") {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await locatorIsVisible(controls.useMedia)) {
        await activateLocator(controls.useMedia, { method: "dom" });
        changed = true;
        await page.waitForTimeout(250);
      }
      if (await locatorIsVisible(controls.confirm)) {
        await activateLocator(controls.confirm, { method: "dom" });
        changed = true;
        audioJoinRequested = true;
      } else if (await locatorIsVisible(controls.entry)) {
        await activateLocator(controls.entry, { method: "dom" });
        changed = true;
        audioJoinRequested = true;
        await page.waitForTimeout(250);
        if (await locatorIsVisible(controls.confirm)) {
          await activateLocator(controls.confirm, { method: "dom" });
        }
      }

      for (let poll = 0; poll < 12; poll += 1) {
        await page.waitForTimeout(250);
        const microphone = await getZoomMicrophoneState(surface, locatorIsVisible);
        const audioConnection = await getZoomAudioConnectionState(
          surface,
          locatorIsVisible,
          microphone,
        );
        if (audioConnection === "connected") break;
      }
      status = await getZoomWebStatus(browser, locatorIsVisible);
      if (status.audioConnection === "connected") break;
    }
  }

  if (status.audioConnection !== "connected") {
    return {
      ready: false,
      changed,
      audioJoinRequested,
      reason: "computer-audio-not-connected",
    };
  }

  let microphoneChanged = false;
  if (
    new Set(["muted", "unmuted"]).has(desiredMicrophone) &&
    status.microphone !== desiredMicrophone
  ) {
    const result = await setZoomWebMicrophone(
      browser,
      locatorIsVisible,
      desiredMicrophone,
    );
    microphoneChanged = result.interaction !== "none";
    changed ||= microphoneChanged;
    status = await getZoomWebStatus(browser, locatorIsVisible);
  }

  let cameraChanged = false;
  if (status.camera === "on") {
    const { turnOff } = zoomCameraControls(surface);
    await activateLocator(turnOff, { method: "dom" });
    const detectedCamera = await waitForValue(
      () => getZoomCameraState(surface, locatorIsVisible),
      "off",
      { timeout: 5_000, interval: 100 },
    );
    if (detectedCamera !== "off") {
      throw new MeetronError("CAMERA_STATE_UNKNOWN", "Zoomのカメラをオフにできませんでした");
    }
    cameraChanged = true;
    changed = true;
    status = await getZoomWebStatus(browser, locatorIsVisible);
  }

  return {
    ready: status.audioConnection === "connected",
    changed,
    audioJoinRequested,
    microphoneChanged,
    cameraChanged,
    audioConnection: status.audioConnection,
    camera: status.camera,
  };
}

export async function setZoomWebMicrophone(browser, locatorIsVisible, state) {
  if (!["muted", "unmuted"].includes(state)) {
    throw new MeetronError("INVALID_MICROPHONE_STATE", "Unsupported Zoom microphone state");
  }
  const page = findZoomPage(browser);
  if (!page) throw new MeetronError("MEETING_NOT_RUNNING", "Zoom参加者が見つかりません");
  const surface = await zoomSurface(page);
  const { turnOn, turnOff } = zoomMicrophoneControls(surface);
  const before = await getZoomMicrophoneState(surface, locatorIsVisible);
  if (before === "unavailable") {
    throw new MeetronError("MICROPHONE_STATE_UNKNOWN", "Zoomのマイク状態を確認できませんでした");
  }
  if (before !== state) {
    const control = state === "muted" ? turnOff : turnOn;
    // Chrome 151 can incorrectly report Zoom's visible Web Client controls as
    // outside the viewport over CDP. The shared DOM activation path bypasses
    // that browser-level viewport gate.
    await activateLocator(control, { method: "dom" });
  }
  const detectedAfter = await waitForValue(
    () => getZoomMicrophoneState(surface, locatorIsVisible),
    state,
    { timeout: 5_000, interval: 100 },
  );
  const verified = detectedAfter === state;
  if (!verified) {
    throw new MeetronError("MICROPHONE_STATE_UNKNOWN", "Zoomのマイク変更を確認できませんでした");
  }
  return {
    status: "ok",
    before,
    after: detectedAfter,
    detectedAfter,
    verified,
    interaction: before === state ? "none" : "dom-click",
    url: safePageUrl(page),
  };
}

export async function leaveZoomWeb(browser, locatorIsVisible) {
  const page = findZoomPage(browser);
  if (!page) return { left: false, alreadyLeft: true, tabClosed: true };

  const surface = await zoomSurface(page);
  const leave = surface.getByRole("button", { name: /退出|ミーティングを退出|Leave|Leave Meeting/i });
  const leaveVisible = await locatorIsVisible(leave);
  if (leaveVisible) {
    await activateLocator(leave, { method: "dom" });
    const confirm = surface.getByRole("button", { name: /ミーティングを退出|Leave Meeting/i });
    if (await locatorIsVisible(confirm)) {
      await activateLocator(confirm.last(), { method: "dom" });
    }
  }
  if (!page.isClosed()) await page.close({ runBeforeUnload: false });
  return { left: leaveVisible, alreadyLeft: !leaveVisible, tabClosed: true };
}

export const zoomWebRuntimeProvider = createRuntimeProvider(zoomWebDefinition, {
  getStatus: getZoomWebStatus,
  reconcileSession: reconcileZoomWebSession,
  setMicrophone: setZoomWebMicrophone,
  leave: leaveZoomWeb,
});
