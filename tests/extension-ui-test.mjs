#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

await context.addInitScript(() => {
  globalThis.__nativeRequests = [];
  globalThis.__storageWrites = [];
  globalThis.__activeProvider = "google-meet";
  globalThis.__microphoneState = "muted";
  globalThis.__microphoneDelayMs = 0;
  globalThis.__microphoneFailure = false;
  globalThis.__microphoneLateSuccess = false;
  globalThis.__statusFailureOnce = false;
  globalThis.__screenshotDelayMs = 0;
  globalThis.chrome = {
    runtime: {
      id: "jlikakgdldiihhflkobhnpfegjlcakdd",
      sendMessage: async ({ request }) => {
        globalThis.__nativeRequests.push(request);
        if (
          globalThis.__statusFailureOnce &&
          ["status.get", "session.status.get"].includes(request.type)
        ) {
          globalThis.__statusFailureOnce = false;
          return { ok: false, error: "Native Host request timed out." };
        }
        if (request.type === "diagnostics.run") {
          return { ok: true, data: { ok: true, output: "All checks passed." } };
        }
        if (request.type === "meeting.validate") {
          const zoom = request.payload.meetingUrl.includes("zoom.us");
          return {
            ok: true,
            data: {
              valid: true,
              providerId: zoom ? "zoom-web" : "google-meet",
              providerLabel: zoom ? "Zoom Web App" : "Google Meet",
              displayUrl: zoom
                ? request.payload.meetingUrl.replace(/\?.*$/, "")
                : request.payload.meetingUrl,
              containsSecret: zoom && request.payload.meetingUrl.includes("pwd="),
            },
          };
        }
        if (request.type === "session.start") {
          globalThis.__activeProvider = request.payload.meetingUrl.includes("zoom.us")
            ? "zoom-web"
            : "google-meet";
          return {
            ok: true,
            data: {
              status: "starting",
              providerId: globalThis.__activeProvider,
              meetingUrl: request.payload.meetingUrl,
            },
          };
        }
        if (request.type === "participant.mic.set") {
          if (globalThis.__microphoneDelayMs) {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, globalThis.__microphoneDelayMs));
          }
          if (globalThis.__microphoneLateSuccess) {
            globalThis.__microphoneState = request.payload.state;
            return { ok: false, error: "Native Host request timed out." };
          }
          if (globalThis.__microphoneFailure) {
            return { ok: false, error: "マイク操作に失敗しました" };
          }
          globalThis.__microphoneState = request.payload.state;
          return {
            ok: true,
            data: { status: "ok", after: globalThis.__microphoneState, verified: true },
          };
        }
        if (["meet.mic.toggle", "participant.mic.toggle"].includes(request.type)) {
          globalThis.__microphoneState = globalThis.__microphoneState === "muted"
            ? "unmuted"
            : "muted";
          return {
            ok: true,
            data: { status: "ok", after: globalThis.__microphoneState, verified: true },
          };
        }
        if (request.type === "visual-context.screenshot.send") {
          if (globalThis.__screenshotDelayMs) {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, globalThis.__screenshotDelayMs));
          }
          if (globalThis.__screenshotFailure) {
            return {
              ok: false,
              error: "ChatGPTへの送信完了を確認できませんでした",
              errorData: {
                code: "CHATGPT_SEND_CONFIRM_TIMEOUT",
                message: "ChatGPTへの送信完了を確認できませんでした",
                details: { stage: "sent-confirm" },
              },
            };
          }
          return {
            ok: true,
            data: { sent: true, width: 1280, height: 720, bytes: 84_000 },
          };
        }
        if (request.type === "setup.status") {
          if (globalThis.__hostDisconnected) {
            return { ok: false, error: "Specified native messaging host not found." };
          }
          if (globalThis.__unifiedSetupIncomplete) {
            return {
              ok: true,
              data: {
                hostConnected: true,
                repoRoot: "/Users/test/meeting-copilot",
                audio: {
                  ready: true,
                  devicesReady: true,
                  requiredDevices: {
                    "Meetron: Meeting to AI": true,
                    "Meetron: AI to Meeting": true,
                  },
                },
                project: { configured: false, url: "" },
                dedicatedChrome: { extensionInstalled: false, sharedProfile: true },
                confirmations: {
                  profileLayoutVersion: 2,
                  chatgptLoginConfirmed: false,
                  googleLoginConfirmed: false,
                },
                complete: false,
              },
            };
          }
          if (globalThis.__setupIncomplete) {
            return {
              ok: true,
              data: {
                hostConnected: true,
                repoRoot: "/Users/test/meeting-copilot",
                audio: {
                  ready: false,
                  devicesReady: false,
                  requiredDevices: {
                    "Meetron: Meeting to AI": true,
                    "Meetron: AI to Meeting": false,
                  },
                },
                project: { configured: false, url: "" },
                dedicatedChrome: { extensionInstalled: false },
                confirmations: {
                  chatgptLoginConfirmed: false,
                  googleLoginConfirmed: false,
                },
                complete: false,
              },
            };
          }
          return {
            ok: true,
            data: {
              hostConnected: true,
              audio: { ready: true, devicesReady: true, requiredDevices: {} },
              project: { configured: true, url: "https://chatgpt.com/g/g-p-test/project" },
              dedicatedChrome: { extensionInstalled: true },
              confirmations: {
                chatgptLoginConfirmed: true,
                googleLoginConfirmed: true,
              },
              complete: true,
            },
          };
        }
        if (globalThis.__launchInProgress) {
          return {
            ok: true,
            data: {
              host: { connected: true },
              audio: { ready: true },
              chatgpt: { browserConnected: false, voiceActive: false },
              dedicatedMeeting: {
                browserConnected: false,
                connection: "not-running",
                microphone: "unavailable",
                providerId: "zoom-web",
                capabilities: { visualContext: "viewport-screenshot" },
              },
              meetingLaunch: { status: "running", providerId: "zoom-web" },
            },
          };
        }
        if (globalThis.__manualActionRequired) {
          return {
            ok: true,
            data: {
              host: { connected: true },
              audio: { ready: true },
              chatgpt: {
                browserConnected: true,
                voiceActive: true,
                audioOutput: { routed: true, internalChecked: true },
              },
              dedicatedMeeting: {
                browserConnected: true,
                connection: "prejoin",
                microphone: globalThis.__microphoneState,
                providerId: "google-meet",
                capabilities: { visualContext: "viewport-screenshot" },
                url: "https://meet.google.com/abc-defg-hij",
              },
              meetingLaunch: {
                status: "completed",
                providerId: "google-meet",
                manualActionRequired: true,
                actionRequired: "camera-check",
                meetingUrl: "https://meet.google.com/abc-defg-hij",
              },
            },
          };
        }
        return {
          ok: true,
          data: {
            host: { connected: true },
            audio: { ready: true },
            chatgpt: {
              browserConnected: true,
              voiceActive: !globalThis.__voiceInactive,
              microphoneOn: true,
              audioOutput: { routed: true, internalChecked: true },
            },
            dedicatedMeeting: {
              browserConnected: true,
              connection: "joined",
              microphone: globalThis.__microphoneState,
              providerId: globalThis.__activeProvider,
              capabilities: { visualContext: "viewport-screenshot" },
              audioConnection: globalThis.__activeProvider === "zoom-web" ? "connected" : "unknown",
              url: globalThis.__activeProvider === "zoom-web"
                ? "https://us02web.zoom.us/j/12345678901"
                : "https://meet.google.com/abc-defg-hij",
            },
            meetingLaunch: {
              status: "completed",
              providerId: globalThis.__activeProvider,
              meetingUrl: globalThis.__activeProvider === "zoom-web"
                ? "https://us02web.zoom.us/j/12345678901"
                : "https://meet.google.com/abc-defg-hij",
            },
            meetMicrophone: {
              state: globalThis.__microphoneState,
              meetingUrl: "https://meet.google.com/abc-defg-hij",
            },
          },
        };
      },
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async (value) => { globalThis.__storageWrites.push(value); },
      },
    },
  };
});

await context.route("https://meet.google.com/**", async (route) => {
  await route.fulfill({
    headers: { "content-type": "text/html; charset=utf-8" },
    body: `<!doctype html>
      <html lang="ja">
        <body style="margin:0;background:#202124;color:white;font-family:sans-serif">
          <main style="height:100vh;display:grid;place-items:center">
            <div style="text-align:center"><h1>Meeting test</h1><p>2 participants</p></div>
          </main>
          <button aria-label="通話から退出" style="position:fixed;bottom:20px;left:600px">Leave</button>
          <button id="meet-mic" aria-label="マイクをオフにする（⌘+D キー）" style="position:fixed;bottom:20px;left:550px">Mic</button>
          <script>
            document.querySelector('#meet-mic').addEventListener('click', (event) => {
              const button = event.currentTarget;
              button.setAttribute('aria-label', button.getAttribute('aria-label').includes('オン')
                ? 'マイクをオフにする（⌘+D キー）'
                : 'マイクをオンにする（⌘+D キー）');
            });
          </script>
        </body>
      </html>`,
  });
});

const page = await context.newPage();
await page.goto("https://meet.google.com/abc-defg-hij");
const script = (await readFile(resolve(repoRoot, "extension/content-script.js"), "utf8"))
  .replace('attachShadow({ mode: "closed" })', 'attachShadow({ mode: "open" })')
  .replace("10_000", "100");
await page.evaluate(script);
await page.waitForTimeout(800);

const initial = await page.evaluate(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return {
    exists: Boolean(root),
    meet: root?.querySelector("[data-meet-status]")?.textContent,
    voice: root?.querySelector("[data-voice-status]")?.textContent,
    audio: root?.querySelector("[data-audio-status]")?.textContent,
    mic: root?.querySelector("[data-mic] span")?.textContent,
    screenshotDisabled: root?.querySelector("[data-screenshot]")?.disabled,
    screenshotHidden: root?.querySelector("[data-screenshot]")?.hidden,
    buttons: [...document.querySelectorAll("button")].map((button) => ({
      label: button.getAttribute("aria-label"),
      text: button.textContent,
      visible: button.getClientRects().length > 0,
    })),
  };
});

if (
  !initial.exists ||
  initial.meet !== "参加中・ミュート" ||
  initial.voice !== "起動中" ||
  initial.audio !== "正常" ||
  initial.mic !== "ミュート解除" ||
  initial.screenshotDisabled ||
  initial.screenshotHidden
) {
  throw new Error(`Unexpected initial control UI: ${JSON.stringify(initial)}`);
}

await page.evaluate(() => {
  document
    .querySelector("#meeting-copilot-controls-root")
    .shadowRoot.querySelector("[data-screenshot]")
    .click();
});
if (
  await page.evaluate(() =>
    globalThis.__nativeRequests.some(
      (entry) => entry.type === "visual-context.screenshot.send",
    ),
  )
) {
  throw new Error("An untrusted screenshot click reached the Native Host.");
}

await page.evaluate(() => { globalThis.__screenshotDelayMs = 700; });
await page.locator("#meeting-copilot-controls-root [data-screenshot]").click();
const captureVisual = await page.evaluate(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  const button = root?.querySelector("[data-screenshot]");
  return {
    buttonState: button?.dataset.visualState,
    effectState: root?.querySelector("[data-capture-effect]")?.dataset.visualState,
    label: root?.querySelector("[data-screenshot-label]")?.textContent,
    processing: button?.classList.contains("is-processing"),
    disabled: button?.disabled,
  };
});
if (
  captureVisual.buttonState !== "capturing" ||
  captureVisual.effectState !== "capturing" ||
  captureVisual.label !== "画面を撮影中…" ||
  !captureVisual.processing ||
  !captureVisual.disabled
) {
  throw new Error(`Screenshot capture effect did not start: ${JSON.stringify(captureVisual)}`);
}
await page.waitForFunction(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return (
    root?.querySelector("[data-screenshot]")?.dataset.visualState === "sending" &&
    root?.querySelector("[data-screenshot-label]")?.textContent === "GPTへ送信中…"
  );
});
await page.waitForFunction(() =>
  document
    .querySelector("#meeting-copilot-controls-root")
    ?.shadowRoot.querySelector("[data-message]")
    ?.textContent === "ChatGPTへ送信しました（1280×720 / 82 KB）",
);
const screenshotSuccess = await page.evaluate(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  const button = root?.querySelector("[data-screenshot]");
  return {
    requests: globalThis.__nativeRequests.filter(
      (entry) => entry.type === "visual-context.screenshot.send",
    ).length,
    buttonState: button?.dataset.visualState,
    effectState: root?.querySelector("[data-capture-effect]")?.dataset.visualState,
    label: root?.querySelector("[data-screenshot-label]")?.textContent,
    success: button?.classList.contains("is-success"),
  };
});
if (
  screenshotSuccess.requests !== 1 ||
  screenshotSuccess.buttonState !== "success" ||
  screenshotSuccess.effectState !== "success" ||
  screenshotSuccess.label !== "GPTへ送信完了" ||
  !screenshotSuccess.success
) {
  throw new Error(`Screenshot success effect was incorrect: ${JSON.stringify(screenshotSuccess)}`);
}

await page.evaluate(() => {
  globalThis.__screenshotDelayMs = 0;
  globalThis.__screenshotFailure = true;
});
await page.locator("#meeting-copilot-controls-root [data-screenshot]").click();
await page.waitForFunction(() =>
  document
    .querySelector("#meeting-copilot-controls-root")
    ?.shadowRoot.querySelector("[data-message]")
    ?.textContent.includes("CHATGPT_SEND_CONFIRM_TIMEOUT / sent-confirm"),
);
const screenshotFailure = await page.evaluate(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  const button = root?.querySelector("[data-screenshot]");
  return {
    state: button?.dataset.visualState,
    label: root?.querySelector("[data-screenshot-label]")?.textContent,
    error: button?.classList.contains("is-error"),
  };
});
if (
  screenshotFailure.state !== "error" ||
  screenshotFailure.label !== "送信に失敗" ||
  !screenshotFailure.error
) {
  throw new Error(`Screenshot failure effect was incorrect: ${JSON.stringify(screenshotFailure)}`);
}
await page.evaluate(() => { globalThis.__screenshotFailure = false; });
await page.waitForFunction(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return (
    root?.querySelector("[data-screenshot]")?.dataset.visualState === "idle" &&
    root?.querySelector("[data-screenshot-label]")?.textContent === "GPTに画面を送る"
  );
});

await page.evaluate(() => { globalThis.__voiceInactive = true; });
await page.locator("#meeting-copilot-controls-root [data-refresh]").click();
await page.waitForFunction(() =>
  document
    .querySelector("#meeting-copilot-controls-root")
    ?.shadowRoot.querySelector("[data-screenshot]")?.disabled === true,
);
await page.evaluate(() => { globalThis.__voiceInactive = false; });
await page.locator("#meeting-copilot-controls-root [data-refresh]").click();
await page.waitForFunction(() =>
  document
    .querySelector("#meeting-copilot-controls-root")
    ?.shadowRoot.querySelector("[data-screenshot]")?.disabled === false,
);

await page.evaluate(() => { globalThis.__manualActionRequired = true; });
await page.locator("#meeting-copilot-controls-root [data-refresh]").click();
await page.waitForFunction(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return (
    root?.querySelector("[data-meet-status]")?.textContent === "手動参加待ち" &&
    root?.querySelector("[data-message]")?.textContent.includes("カメラをオフにして") &&
    root?.querySelector("[data-screenshot]")?.disabled === true
  );
});
await page.evaluate(() => { globalThis.__manualActionRequired = false; });
await page.locator("#meeting-copilot-controls-root [data-refresh]").click();

await page.evaluate(() => {
  document
    .querySelector("#meeting-copilot-controls-root")
    .shadowRoot.querySelector("[data-mic]")
    .click();
});
const untrustedRequest = await page.evaluate(() =>
  globalThis.__nativeRequests.some((entry) => entry.type === "participant.mic.set"),
);
if (untrustedRequest) {
  throw new Error("An untrusted page-generated click reached the Native Host.");
}

await page.evaluate(() => {
  globalThis.__microphoneDelayMs = 300;
  globalThis.__statusFailureOnce = true;
  globalThis.__backgroundMessages = [];
  const message = document
    .querySelector("#meeting-copilot-controls-root")
    ?.shadowRoot.querySelector("[data-message]");
  new MutationObserver(() => {
    globalThis.__backgroundMessages.push({
      text: message.textContent,
      error: message.classList.contains("error"),
    });
  }).observe(message, { childList: true, attributes: true, subtree: true });
});
await page.locator("#meeting-copilot-controls-root [data-mic]").click();
const pendingUnmute = await page.evaluate(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return {
    mic: root?.querySelector("[data-mic] span")?.textContent,
    disabled: root?.querySelector("[data-mic]")?.disabled,
    message: root?.querySelector("[data-message]")?.textContent,
  };
});
if (
  pendingUnmute.mic !== "ミュート" ||
  pendingUnmute.disabled !== true ||
  pendingUnmute.message !== "ミュートを解除しています"
) {
  throw new Error(`Remote microphone did not update optimistically: ${JSON.stringify(pendingUnmute)}`);
}
await page.waitForFunction(() =>
  document
    .querySelector("#meeting-copilot-controls-root")
    ?.shadowRoot.querySelector("[data-message]")
    ?.textContent === "GPT参加者のミュートを解除しました",
);
const backgroundMessages = await page.evaluate(() => globalThis.__backgroundMessages);
if (backgroundMessages.some((entry) => entry.error)) {
  throw new Error(`Background status polling flashed an error: ${JSON.stringify(backgroundMessages)}`);
}
await page.evaluate(() => { globalThis.__microphoneDelayMs = 0; });

const after = await page.evaluate(() => {
  const root = document.querySelector("#meeting-copilot-controls-root").shadowRoot;
  return {
    meet: root.querySelector("[data-meet-status]").textContent,
    mic: root.querySelector("[data-mic] span").textContent,
    message: root.querySelector("[data-message]").textContent,
    nativeRequest: globalThis.__nativeRequests.find(
      (entry) => entry.type === "participant.mic.set",
    ),
    userMicrophoneLabel: document.querySelector("#meet-mic").getAttribute("aria-label"),
  };
});

if (
  after.meet !== "参加中・送話中" ||
  after.mic !== "ミュート" ||
  after.message !== "GPT参加者のミュートを解除しました" ||
  after.nativeRequest?.payload?.state !== "unmuted" ||
  !after.userMicrophoneLabel.includes("マイクをオフにする")
) {
  throw new Error(`Remote GPT microphone control did not stay isolated: ${JSON.stringify(after)}`);
}

await page.locator("#meeting-copilot-controls-root [data-mic]").click();
await page.waitForFunction(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return (
    root?.querySelector("[data-mic] span")?.textContent === "ミュート解除" &&
    root?.querySelector("[data-message]")?.textContent === "GPT参加者をミュートしました"
  );
});
const muteRequest = await page.evaluate(() =>
  globalThis.__nativeRequests.filter((entry) => entry.type === "participant.mic.set").at(-1),
);
if (muteRequest?.payload?.state !== "muted") {
  throw new Error(`Remote GPT microphone mute was not explicit: ${JSON.stringify(muteRequest)}`);
}

await page.evaluate(() => { globalThis.__microphoneFailure = true; });
await page.locator("#meeting-copilot-controls-root [data-mic]").click();
await page.waitForFunction(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return root?.querySelector("[data-message]")?.textContent === "マイク操作に失敗しました";
});
const rolledBack = await page.evaluate(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return {
    mic: root?.querySelector("[data-mic] span")?.textContent,
    status: root?.querySelector("[data-meet-status]")?.textContent,
  };
});
if (rolledBack.mic !== "ミュート解除" || rolledBack.status !== "参加中・ミュート") {
  throw new Error(`Remote microphone failure did not roll back: ${JSON.stringify(rolledBack)}`);
}
await page.evaluate(() => {
  globalThis.__microphoneFailure = false;
  globalThis.__microphoneLateSuccess = true;
  globalThis.__microphoneMessages = [];
  const message = document
    .querySelector("#meeting-copilot-controls-root")
    ?.shadowRoot.querySelector("[data-message]");
  new MutationObserver(() => {
    globalThis.__microphoneMessages.push({
      text: message.textContent,
      error: message.classList.contains("error"),
    });
  }).observe(message, { childList: true, attributes: true, subtree: true });
});
await page.locator("#meeting-copilot-controls-root [data-mic]").click();
await page.waitForFunction(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return root?.querySelector("[data-message]")?.textContent ===
    "GPT参加者のミュートを解除しました";
});
const lateSuccessMessages = await page.evaluate(() => globalThis.__microphoneMessages);
if (lateSuccessMessages.some((entry) => entry.error)) {
  throw new Error(`Late microphone success flashed an error: ${JSON.stringify(lateSuccessMessages)}`);
}
await page.evaluate(() => { globalThis.__microphoneLateSuccess = false; });

await page.locator("#meeting-copilot-controls-root [data-diagnostics]").click();
await page.waitForFunction(() =>
  document
    .querySelector("#meeting-copilot-controls-root")
    ?.shadowRoot.querySelector("[data-message]")
    ?.textContent === "診断が完了しました",
);
const diagnostics = await page.evaluate(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return {
    requested: globalThis.__nativeRequests.some((entry) => entry.type === "diagnostics.run"),
    rawOutputPresent: Boolean(root?.querySelector("[data-diagnostics-output]")),
    message: root?.querySelector("[data-message]")?.textContent,
  };
});
if (
  !diagnostics.requested ||
  diagnostics.rawOutputPresent ||
  diagnostics.message !== "診断が完了しました"
) {
  throw new Error(`Diagnostics exposed raw logs in the control UI: ${JSON.stringify(diagnostics)}`);
}

await page.screenshot({ path: "/tmp/meeting-copilot-control-ui.png" });

await context.route("https://app.zoom.us/**", async (route) => {
  await route.fulfill({
    headers: { "content-type": "text/html; charset=utf-8" },
    body: `<!doctype html><html lang="ja"><body><main><h1>Zoom meeting test</h1></main></body></html>`,
  });
});
const zoomPage = await context.newPage();
await zoomPage.goto("https://app.zoom.us/wc/12345678901/join");
await zoomPage.evaluate(() => { globalThis.__activeProvider = "zoom-web"; });
await zoomPage.evaluate(script);
await zoomPage.waitForTimeout(500);
const zoomPanel = await zoomPage.evaluate(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return {
    exists: Boolean(root),
    meeting: root?.querySelector("[data-meet-status]")?.textContent,
    mic: root?.querySelector("[data-mic] span")?.textContent,
    screenshotHidden: root?.querySelector("[data-screenshot]")?.hidden,
    screenshotDisabled: root?.querySelector("[data-screenshot]")?.disabled,
  };
});
if (
  !zoomPanel.exists ||
  zoomPanel.meeting !== "参加中・ミュート" ||
  zoomPanel.mic !== "ミュート解除" ||
  zoomPanel.screenshotHidden ||
  zoomPanel.screenshotDisabled
) {
  throw new Error(`Zoom page did not receive the persistent controls: ${JSON.stringify(zoomPanel)}`);
}
await zoomPage.locator("#meeting-copilot-controls-root [data-screenshot]").click();
await zoomPage.waitForFunction(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return (
    globalThis.__nativeRequests.some(
      (entry) => entry.type === "visual-context.screenshot.send",
    ) &&
    root?.querySelector("[data-screenshot]")?.dataset.visualState === "success" &&
    root?.querySelector("[data-screenshot-label]")?.textContent === "GPTへ送信完了"
  );
});
await zoomPage.evaluate(() => { globalThis.__launchInProgress = true; });
await zoomPage.locator("#meeting-copilot-controls-root [data-refresh]").click();
await zoomPage.waitForTimeout(100);
const launchingPanel = await zoomPage.evaluate(() => {
  const root = document.querySelector("#meeting-copilot-controls-root")?.shadowRoot;
  return {
    meeting: root?.querySelector("[data-meet-status]")?.textContent,
    voice: root?.querySelector("[data-voice-status]")?.textContent,
    audio: root?.querySelector("[data-audio-status]")?.textContent,
  };
});
if (
  launchingPanel.meeting !== "起動中" ||
  launchingPanel.voice !== "起動中" ||
  launchingPanel.audio !== "準備中"
) {
  throw new Error(`Zoom launch progress looked disconnected: ${JSON.stringify(launchingPanel)}`);
}
await zoomPage.evaluate(() => { globalThis.__launchInProgress = false; });
const dedicatedZoomPage = await context.newPage();
await dedicatedZoomPage.goto("https://app.zoom.us/wc/12345678901/join");
await dedicatedZoomPage.evaluate(() => {
  document.documentElement.setAttribute("data-meetron-dedicated-participant", "true");
});
await dedicatedZoomPage.evaluate(script);
await dedicatedZoomPage.waitForTimeout(100);
if (await dedicatedZoomPage.locator("#meeting-copilot-controls-root").count()) {
  throw new Error("The persistent controls covered the dedicated Zoom participant UI.");
}
const dedicatedRequests = await dedicatedZoomPage.evaluate(() => globalThis.__nativeRequests);
if (!dedicatedRequests.some((entry) => entry.type === "session.reconcile")) {
  throw new Error("The dedicated Zoom participant did not start post-admission reconciliation.");
}

const popup = await context.newPage();
const popupHtml = (await readFile(resolve(repoRoot, "extension/popup.html"), "utf8"))
  .replace('<link rel="stylesheet" href="popup.css">', "")
  .replace('<script src="popup.js"></script>', "");
await popup.setContent(popupHtml);
await popup.addStyleTag({ content: await readFile(resolve(repoRoot, "extension/popup.css"), "utf8") });
await popup.evaluate(await readFile(resolve(repoRoot, "extension/popup.js"), "utf8"));
await popup.locator("#meeting-url").fill("https://meet.google.com/abc-defg-hij?utm_source=test#fragment");
await popup.locator("[data-start]").click();
await popup.waitForFunction(() =>
  document.querySelector("[data-message]")?.textContent.includes("開始しました"),
);

const popupResult = await popup.evaluate(() => ({
  request: globalThis.__nativeRequests.find((entry) => entry.type === "session.start"),
  validation: globalThis.__nativeRequests.find((entry) => entry.type === "meeting.validate"),
  message: document.querySelector("[data-message]").textContent,
  launch: document.querySelector("[data-launch-status]").textContent,
}));
if (
  popupResult.request?.payload?.meetingUrl !== "https://meet.google.com/abc-defg-hij?utm_source=test#fragment" ||
  popupResult.validation?.payload?.meetingUrl !== popupResult.request?.payload?.meetingUrl ||
  popupResult.launch !== "起動完了"
) {
  throw new Error(`Popup start did not submit the Meet URL: ${JSON.stringify(popupResult)}`);
}

await popup.locator("#meeting-url").fill(
  "https://us02web.zoom.us/j/12345678901?pwd=do-not-store&utm_source=test",
);
await popup.waitForFunction(() =>
  document.querySelector('[data-provider="zoom-web"]')?.classList.contains("selected") &&
  !document.querySelector('[data-provider-guide="zoom-web"]')?.hidden,
);
await popup.locator("[data-start]").click();
await popup.waitForFunction(() =>
  document.querySelector("[data-message]")?.textContent.includes("Zoomの参加準備が完了"),
);
await popup.waitForFunction(() =>
  document.querySelector("[data-session-provider]")?.textContent.includes("Zoom") &&
  !document.querySelector("[data-session-controls]")?.hidden,
);
const statusRequestsBeforeMicrophone = await popup.evaluate(() =>
  globalThis.__nativeRequests.filter((entry) => entry.type === "session.status.get").length,
);
await popup.evaluate(() => { globalThis.__microphoneDelayMs = 300; });
await popup.locator("[data-session-mic]").click();
const popupPendingUnmute = await popup.evaluate(() => ({
  mic: document.querySelector("[data-session-mic]")?.textContent,
  disabled: document.querySelector("[data-session-mic]")?.disabled,
  message: document.querySelector("[data-message]")?.textContent,
}));
if (
  popupPendingUnmute.mic !== "ミュート" ||
  popupPendingUnmute.disabled !== true ||
  popupPendingUnmute.message !== "ミュートを解除しています"
) {
  throw new Error(`Popup microphone did not update optimistically: ${JSON.stringify(popupPendingUnmute)}`);
}
await popup.waitForFunction(() =>
  globalThis.__nativeRequests.some((entry) => entry.type === "participant.mic.set") &&
  document.querySelector("[data-session-mic]")?.textContent === "ミュート" &&
  document.querySelector("[data-message]")?.textContent === "ミュートを解除しました",
);
await popup.evaluate(() => { globalThis.__microphoneDelayMs = 0; });
await popup.locator("[data-session-mic]").click();
await popup.waitForFunction(() =>
  globalThis.__nativeRequests.filter((entry) => entry.type === "participant.mic.set").length === 2 &&
  document.querySelector("[data-session-mic]")?.textContent === "ミュート解除" &&
  document.querySelector("[data-message]")?.textContent === "マイクをミュートしました",
);
const zoomPopupResult = await popup.evaluate(() => ({
  request: [...globalThis.__nativeRequests]
    .reverse()
    .find((entry) => entry.type === "session.start"),
  storage: globalThis.__storageWrites.at(-1),
  guide: document.querySelector('[data-provider-guide="zoom-web"]')?.textContent,
  micStates: globalThis.__nativeRequests
    .filter((entry) => entry.type === "participant.mic.set")
    .map((entry) => entry.payload.state),
  statusRequests: globalThis.__nativeRequests
    .filter((entry) => entry.type === "session.status.get").length,
}));
if (
  zoomPopupResult.request?.payload?.meetingUrl !==
    "https://us02web.zoom.us/j/12345678901?pwd=do-not-store&utm_source=test" ||
  zoomPopupResult.storage?.lastMeetingUrl !== "" ||
  JSON.stringify(zoomPopupResult.micStates) !== JSON.stringify(["unmuted", "muted"]) ||
  zoomPopupResult.statusRequests !== statusRequestsBeforeMicrophone ||
  !zoomPopupResult.guide?.includes("ブラウザから参加")
) {
  throw new Error(`Popup Zoom guide or secret storage failed: ${JSON.stringify(zoomPopupResult)}`);
}
await popup.evaluate(() => { globalThis.__microphoneFailure = true; });
await popup.locator("[data-session-mic]").click();
await popup.waitForFunction(() =>
  document.querySelector("[data-message]")?.textContent === "マイク操作に失敗しました",
);
const popupRollback = await popup.evaluate(() => ({
  mic: document.querySelector("[data-session-mic]")?.textContent,
  connection: document.querySelector("[data-session-connection]")?.textContent,
}));
if (popupRollback.mic !== "ミュート解除" || popupRollback.connection !== "参加中・ミュート") {
  throw new Error(`Popup microphone failure did not roll back: ${JSON.stringify(popupRollback)}`);
}
await popup.evaluate(() => {
  globalThis.__microphoneFailure = false;
  globalThis.__microphoneLateSuccess = true;
  globalThis.__microphoneMessages = [];
  const message = document.querySelector("[data-message]");
  new MutationObserver(() => {
    globalThis.__microphoneMessages.push({
      text: message.textContent,
      error: message.classList.contains("error"),
    });
  }).observe(message, { childList: true, attributes: true, subtree: true });
});
await popup.locator("[data-session-mic]").click();
await popup.waitForFunction(() =>
  document.querySelector("[data-message]")?.textContent === "ミュートを解除しました",
);
const popupLateSuccess = await popup.evaluate(() => ({
  mic: document.querySelector("[data-session-mic]")?.textContent,
  messages: globalThis.__microphoneMessages,
}));
if (
  popupLateSuccess.mic !== "ミュート" ||
  popupLateSuccess.messages.some((entry) => entry.error)
) {
  throw new Error(`Popup late microphone success was not absorbed: ${JSON.stringify(popupLateSuccess)}`);
}
await popup.evaluate(() => { globalThis.__microphoneLateSuccess = false; });
await popup.screenshot({ path: "/tmp/meeting-copilot-popup-ui.png" });

const setupPopup = await context.newPage();
await setupPopup.setContent(popupHtml);
await setupPopup.addStyleTag({ content: await readFile(resolve(repoRoot, "extension/popup.css"), "utf8") });
await setupPopup.evaluate(() => { globalThis.__setupIncomplete = true; });
await setupPopup.evaluate(await readFile(resolve(repoRoot, "extension/popup.js"), "utf8"));
await setupPopup.waitForFunction(() =>
  document.querySelector('[data-step="1"]:not([hidden]) h2')?.textContent === "音声デバイス",
);
const setupResult = await setupPopup.evaluate(() => ({
  launchHidden: document.querySelector("[data-launch-view]").hidden,
  setupHidden: document.querySelector("[data-setup-view]").hidden,
  step: document.querySelector("[data-step-count]").textContent,
  outputStatus: document.querySelector('[data-device-label-index="1"]').textContent,
  nextDisabled: document.querySelector("[data-next-step]").disabled,
}));
if (
  !setupResult.launchHidden ||
  setupResult.setupHidden ||
  setupResult.step !== "2 / 4" ||
  setupResult.outputStatus !== "未検出" ||
  !setupResult.nextDisabled
) {
  throw new Error(`Setup wizard did not show the incomplete audio step: ${JSON.stringify(setupResult)}`);
}
await setupPopup.screenshot({ path: "/tmp/meeting-copilot-setup-ui.png" });

const unifiedSetupPopup = await context.newPage();
await unifiedSetupPopup.setContent(popupHtml);
await unifiedSetupPopup.addStyleTag({ content: await readFile(resolve(repoRoot, "extension/popup.css"), "utf8") });
await unifiedSetupPopup.evaluate(() => { globalThis.__unifiedSetupIncomplete = true; });
await unifiedSetupPopup.evaluate(await readFile(resolve(repoRoot, "extension/popup.js"), "utf8"));
await unifiedSetupPopup.waitForFunction(() =>
  document.querySelector('[data-step="2"]:not([hidden]) h2')?.textContent === "専用Chrome",
);
const unifiedSetupResult = await unifiedSetupPopup.evaluate(() => ({
  step: document.querySelector("[data-step-count]").textContent,
  heading: document.querySelector('[data-step="2"] h2').textContent,
  path: document.querySelector("[data-extension-path]").textContent,
  nextDisabled: document.querySelector("[data-next-step]").disabled,
}));
if (
  unifiedSetupResult.step !== "3 / 4" ||
  unifiedSetupResult.heading !== "専用Chrome" ||
  unifiedSetupResult.path !== "/Users/test/meeting-copilot/extension" ||
  !unifiedSetupResult.nextDisabled
) {
  throw new Error(`Unified profile setup step is incomplete: ${JSON.stringify(unifiedSetupResult)}`);
}
await unifiedSetupPopup.screenshot({ path: "/tmp/meeting-copilot-unified-setup-ui.png" });

const disconnectedPopup = await context.newPage();
await disconnectedPopup.setContent(popupHtml);
await disconnectedPopup.addStyleTag({ content: await readFile(resolve(repoRoot, "extension/popup.css"), "utf8") });
await disconnectedPopup.evaluate(() => { globalThis.__hostDisconnected = true; });
await disconnectedPopup.evaluate(await readFile(resolve(repoRoot, "extension/popup.js"), "utf8"));
await disconnectedPopup.waitForFunction(() =>
  document.querySelector("[data-host-status]")?.textContent === "ローカルホスト未接続",
);
const disconnectedResult = await disconnectedPopup.evaluate(() => ({
  command: document.querySelector("[data-bootstrap-command]").textContent,
  bootstrapHidden: document.querySelector("[data-bootstrap]").hidden,
}));
if (
  disconnectedResult.bootstrapHidden ||
  disconnectedResult.command.includes("/path/to/") ||
  !disconnectedResult.command.includes("Secure Preferences") ||
  !disconnectedResult.command.includes("jlikakgdldiihhflkobhnpfegjlcakdd") ||
  !disconnectedResult.command.includes('cd "$REPO_DIR"')
) {
  throw new Error(`Disconnected setup did not provide an automatic install path: ${JSON.stringify(disconnectedResult)}`);
}
await disconnectedPopup.screenshot({ path: "/tmp/meeting-copilot-disconnected-setup-ui.png" });

const unavailableRuntimePopup = await context.newPage();
const runtimeErrors = [];
unavailableRuntimePopup.on("pageerror", (error) => runtimeErrors.push(error.message));
await unavailableRuntimePopup.setContent(popupHtml);
await unavailableRuntimePopup.addStyleTag({
  content: await readFile(resolve(repoRoot, "extension/popup.css"), "utf8"),
});
await unavailableRuntimePopup.evaluate(() => {
  delete globalThis.chrome.runtime.sendMessage;
});
await unavailableRuntimePopup.evaluate(await readFile(resolve(repoRoot, "extension/popup.js"), "utf8"));
const unavailableRuntimeResult = await unavailableRuntimePopup.evaluate(() => ({
  hostStatus: document.querySelector("[data-host-status]").textContent,
  setupMessage: document.querySelector("[data-setup-message]").textContent,
}));
if (
  runtimeErrors.length > 0 ||
  unavailableRuntimeResult.hostStatus !== "Chrome拡張機能として開かれていません" ||
  !unavailableRuntimeResult.setupMessage.includes("拡張機能メニューから開き直してください")
) {
  throw new Error(
    `Missing Chrome runtime was not handled: ${JSON.stringify({ unavailableRuntimeResult, runtimeErrors })}`,
  );
}
await browser.close();
process.stdout.write("Extension panel, launcher, and setup wizard UI tests passed.\n");
