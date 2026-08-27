const HOST_NAME = "com.meeting_copilot.host";
const PROTOCOL_VERSION = 1;
const pending = new Map();
let nativePort = null;
let requestSequence = 0;
const CONTENT_REQUESTS = new Set([
  "status.get",
  "session.status.get",
  "session.reconcile",
  "meet.mic.toggle",
  "participant.mic.toggle",
  "participant.mic.set",
  "voice.restart",
  "session.stop",
  "diagnostics.run",
  "visual-context.screenshot.send",
]);

function senderMayRequest(sender, requestType) {
  if (sender.id !== chrome.runtime.id || typeof sender.url !== "string") {
    return false;
  }

  let url;
  try {
    url = new URL(sender.url);
  } catch {
    return false;
  }

  if (url.origin === new URL(chrome.runtime.getURL("/")).origin) {
    return true;
  }

  const isMeet =
    url.origin === "https://meet.google.com" &&
    /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\/)?$/i.test(url.pathname);
  const isZoom =
    url.protocol === "https:" &&
    (url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us")) &&
    /^\/wc\/(?:(?:join|start)\/\d+|\d+\/(?:join|start))(?:\/)?$/i.test(url.pathname);
  return (isMeet || isZoom) && CONTENT_REQUESTS.has(requestType);
}

function rejectPending(message) {
  for (const { reject, timeout } of pending.values()) {
    clearTimeout(timeout);
    reject(new Error(message));
  }
  pending.clear();
}

function connectHost() {
  if (nativePort) {
    return nativePort;
  }

  const port = chrome.runtime.connectNative(HOST_NAME);
  nativePort = port;

  port.onMessage.addListener((message) => {
    const responseId = message.requestId || message.id;
    const entry = pending.get(responseId);
    if (!entry) {
      return;
    }
    clearTimeout(entry.timeout);
    pending.delete(responseId);
    entry.resolve(message);
  });

  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message || "Native Host disconnected.";
    if (nativePort === port) {
      nativePort = null;
    }
    rejectPending(error);
  });

  return port;
}

function requestHost(request) {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${requestSequence += 1}`;
    const timeoutMs = request.type === "voice.restart"
      ? 150_000
      : ["session.stop", "visual-context.screenshot.send"].includes(request.type)
        ? 60_000
        : 20_000;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Native Host request timed out."));
    }, timeoutMs);

    pending.set(id, { resolve, reject, timeout });
    try {
      connectHost().postMessage({
        ...request,
        protocolVersion: PROTOCOL_VERSION,
        requestId: id,
        id,
      });
    } catch (error) {
      clearTimeout(timeout);
      pending.delete(id);
      reject(error);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.channel !== "meeting-copilot" || message?.type !== "native-request") {
    return false;
  }

  if (!senderMayRequest(sender, message.request?.type)) {
    sendResponse({ ok: false, error: "This extension context cannot perform that request." });
    return false;
  }

  requestHost(message.request)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});
