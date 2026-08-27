(() => {
  const HOST_ID = "meeting-copilot-controls-root";
  const MEET_PATH = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:[/?#]|$)/i;
  const ZOOM_PATH = /^\/wc\/\d+\/(?:join|start)(?:[/?#]|$)/i;
  const hostname = window.location.hostname.toLowerCase();
  const isMeetPage = hostname === "meet.google.com" && MEET_PATH.test(window.location.pathname);
  const isZoomPage =
    (hostname === "zoom.us" || hostname.endsWith(".zoom.us")) &&
    ZOOM_PATH.test(window.location.pathname);
  const isDedicatedParticipant =
    document.documentElement.hasAttribute("data-meetron-dedicated-participant");

  if (!isMeetPage && !isZoomPage) {
    return;
  }

  if (isDedicatedParticipant) {
    let reconciliationRunning = false;
    const reconcile = async () => {
      if (reconciliationRunning || typeof globalThis.chrome?.runtime?.sendMessage !== "function") {
        return;
      }
      reconciliationRunning = true;
      try {
        await globalThis.chrome.runtime.sendMessage({
          channel: "meeting-copilot",
          type: "native-request",
          request: { type: "session.reconcile", payload: {} },
        });
      } catch {
        // The next interval retries after Chrome restarts the service worker or
        // the Native Messaging Host. No meeting-page UI is shown here.
      } finally {
        reconciliationRunning = false;
      }
    };
    void reconcile();
    window.setInterval(reconcile, 2_000);
    return;
  }

  if (document.getElementById(HOST_ID)) return;

  const iconPaths = {
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronUp: '<path d="m18 15-6-6-6 6"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    micOff: '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7 7 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 4.9"/><path d="M8.7 8.7V12a3.3 3.3 0 0 0 5.7 2.3"/><path d="M9 5a3 3 0 0 1 5.68-1.36"/><line x1="12" x2="12" y1="19" y2="22"/>',
    refresh: '<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/>',
    rotate: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    square: '<rect width="14" height="14" x="5" y="5" rx="1"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  };

  function icon(name, size = 16) {
    return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name]}</svg>`;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.right = "16px";
  host.style.bottom = "88px";
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; color-scheme: light dark; }
      * { box-sizing: border-box; letter-spacing: 0; }
      [hidden] { display: none !important; }
      button { font: inherit; }
      .panel {
        position: relative;
        z-index: 2;
        width: 304px;
        color: #202124;
        background: #fff;
        border: 1px solid #dadce0;
        border-radius: 8px;
        box-shadow: 0 4px 18px rgba(32, 33, 36, .22);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
      }
      .panel.collapsed { width: auto; min-width: 156px; }
      .header {
        height: 44px;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 0 8px 0 12px;
        background: #f8f9fa;
        border-bottom: 1px solid #e8eaed;
        cursor: grab;
        user-select: none;
      }
      .collapsed .header { border-bottom: 0; }
      .brand { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
      .brand-icon { color: #1a73e8; display: grid; place-items: center; }
      .brand-text { font-weight: 600; white-space: nowrap; }
      .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #f9ab00; flex: 0 0 auto; }
      .status-dot.ready { background: #188038; }
      .status-dot.error { background: #d93025; }
      .icon-button {
        width: 30px; height: 30px; border: 0; border-radius: 50%;
        display: grid; place-items: center; color: #3c4043; background: transparent;
        cursor: pointer;
      }
      .icon-button:hover { background: #e8eaed; }
      .icon-button.danger { color: #d93025; }
      .body { padding: 10px 12px 12px; }
      .collapsed .body { display: none; }
      .section-title { margin: 2px 0 6px; color: #5f6368; font-size: 11px; font-weight: 600; text-transform: uppercase; }
      .status-list { margin: 0 0 10px; }
      .status-row { min-height: 28px; display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 7px; }
      .status-row svg { color: #5f6368; }
      .status-value { color: #5f6368; max-width: 142px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .status-value.good { color: #137333; }
      .status-value.bad { color: #c5221f; }
      .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .command {
        min-height: 36px; border: 1px solid #dadce0; border-radius: 6px;
        display: inline-flex; align-items: center; justify-content: center; gap: 7px;
        padding: 6px 9px; color: #1f1f1f; background: #fff; cursor: pointer;
        white-space: nowrap;
      }
      .command:hover { background: #f8f9fa; }
      .command.primary { color: #fff; border-color: #1a73e8; background: #1a73e8; }
      .command.primary:hover { background: #1765cc; }
      .command.wide { grid-column: 1 / -1; }
      .command:disabled { opacity: .55; cursor: default; }
      .screenshot-command {
        position: relative;
        isolation: isolate;
        overflow: hidden;
        transition: background-color .2s ease, border-color .2s ease, box-shadow .2s ease,
          transform .2s ease;
      }
      .screenshot-command > :not(.screenshot-beam):not(.screenshot-particles) {
        position: relative;
        z-index: 2;
      }
      .screenshot-command .screenshot-icon { display: grid; place-items: center; }
      .screenshot-beam {
        position: absolute;
        z-index: 1;
        inset: -100% auto -100% -45%;
        width: 34%;
        opacity: 0;
        transform: rotate(16deg);
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .8), transparent);
        pointer-events: none;
      }
      .screenshot-command.is-processing,
      .screenshot-command.is-processing:hover {
        opacity: 1;
        border-color: #65b5ff;
        background: linear-gradient(110deg, #155dc0, #1a73e8 55%, #4f8eff);
        box-shadow: 0 0 0 3px rgba(26, 115, 232, .16), 0 6px 16px rgba(26, 115, 232, .28);
      }
      .screenshot-command.is-processing .screenshot-icon { animation: screenshot-icon-pulse 1s ease-in-out infinite; }
      .screenshot-command.is-processing .screenshot-beam {
        opacity: 1;
        animation: screenshot-beam 1.05s ease-in-out infinite;
      }
      .screenshot-command.is-success,
      .screenshot-command.is-success:hover {
        opacity: 1;
        border-color: #13a878;
        background: linear-gradient(110deg, #087f5b, #13a878 58%, #2bc792);
        box-shadow: 0 0 0 3px rgba(19, 168, 120, .18), 0 6px 18px rgba(8, 127, 91, .3);
        transform: translateY(-1px);
      }
      .screenshot-command.is-success .screenshot-icon { animation: screenshot-check-pop .45s cubic-bezier(.2, .9, .3, 1.4); }
      .screenshot-command.is-error,
      .screenshot-command.is-error:hover {
        opacity: 1;
        border-color: #d93025;
        background: #b3261e;
        box-shadow: 0 0 0 3px rgba(217, 48, 37, .16);
        animation: screenshot-error-shake .35s ease-in-out;
      }
      .screenshot-particles { position: absolute; z-index: 3; inset: 50% auto auto 29px; pointer-events: none; }
      .screenshot-particles i {
        position: absolute;
        width: 4px;
        height: 4px;
        border-radius: 50%;
        opacity: 0;
        background: #b9ffe8;
      }
      .screenshot-command.is-success .screenshot-particles i { animation: screenshot-particle .65s ease-out both; }
      .screenshot-particles i:nth-child(1) { --particle-x: -14px; --particle-y: -12px; }
      .screenshot-particles i:nth-child(2) { --particle-x: 1px; --particle-y: -17px; animation-delay: .04s !important; }
      .screenshot-particles i:nth-child(3) { --particle-x: 15px; --particle-y: -9px; animation-delay: .08s !important; }
      .screenshot-particles i:nth-child(4) { --particle-x: 14px; --particle-y: 11px; animation-delay: .02s !important; }
      .capture-effect {
        position: fixed;
        z-index: 1;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
      }
      .capture-flash {
        position: absolute;
        inset: 0;
        opacity: 0;
        border: 0 solid rgba(171, 222, 255, .95);
        background: rgba(226, 245, 255, 0);
      }
      .capture-effect[data-visual-state="capturing"] .capture-flash {
        animation: capture-flash .48s ease-out both;
      }
      .capture-toast {
        position: absolute;
        top: 36px;
        left: 50%;
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 10px 16px 10px 11px;
        border: 1px solid rgba(126, 242, 202, .45);
        border-radius: 999px;
        color: #f2fff9;
        background: rgba(12, 86, 65, .94);
        box-shadow: 0 10px 34px rgba(0, 0, 0, .3), 0 0 22px rgba(43, 199, 146, .2);
        font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        opacity: 0;
        transform: translate(-50%, -14px) scale(.96);
      }
      .capture-toast-mark {
        width: 22px;
        height: 22px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        color: #087f5b;
        background: #b9ffe8;
      }
      .capture-effect[data-visual-state="success"] .capture-toast {
        animation: capture-toast 1.55s cubic-bezier(.2, .8, .2, 1) both;
      }
      @keyframes capture-flash {
        0% { opacity: 0; border-width: 0; background-color: rgba(226, 245, 255, 0); }
        16% { opacity: 1; border-width: 7px; background-color: rgba(226, 245, 255, .22); }
        100% { opacity: 0; border-width: 2px; background-color: rgba(226, 245, 255, 0); }
      }
      @keyframes capture-toast {
        0% { opacity: 0; transform: translate(-50%, -14px) scale(.96); }
        18%, 72% { opacity: 1; transform: translate(-50%, 0) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -5px) scale(.98); }
      }
      @keyframes screenshot-beam {
        0% { left: -45%; }
        65%, 100% { left: 115%; }
      }
      @keyframes screenshot-icon-pulse {
        0%, 100% { transform: scale(1); opacity: .85; }
        50% { transform: scale(1.1); opacity: 1; }
      }
      @keyframes screenshot-check-pop {
        0% { transform: scale(.5) rotate(-12deg); }
        70% { transform: scale(1.2) rotate(3deg); }
        100% { transform: scale(1) rotate(0); }
      }
      @keyframes screenshot-particle {
        0% { opacity: 0; transform: translate(0, 0) scale(.4); }
        25% { opacity: 1; }
        100% { opacity: 0; transform: translate(var(--particle-x), var(--particle-y)) scale(1); }
      }
      @keyframes screenshot-error-shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-3px); }
        75% { transform: translateX(3px); }
      }
      .footer { margin-top: 9px; display: flex; align-items: center; gap: 6px; min-height: 22px; }
      .message { flex: 1; color: #5f6368; font-size: 11px; overflow-wrap: anywhere; }
      .message.error { color: #c5221f; }
      @media (prefers-color-scheme: dark) {
        .panel { color: #e8eaed; background: #202124; border-color: #5f6368; }
        .header { background: #292a2d; border-color: #3c4043; }
        .icon-button { color: #e8eaed; }
        .icon-button:hover, .command:hover { background: #3c4043; }
        .command { color: #e8eaed; background: #292a2d; border-color: #5f6368; }
      }
      @media (prefers-reduced-motion: reduce) {
        .capture-flash, .capture-toast, .screenshot-command, .screenshot-icon,
        .screenshot-beam, .screenshot-particles i { animation: none !important; transition: none !important; }
        .capture-effect[data-visual-state="capturing"] .capture-flash {
          opacity: .18;
          border: 3px solid rgba(171, 222, 255, .9);
        }
        .capture-effect[data-visual-state="success"] .capture-toast {
          opacity: 1;
          transform: translate(-50%, 0);
        }
      }
    </style>
    <div class="capture-effect" data-capture-effect data-visual-state="idle" aria-hidden="true">
      <div class="capture-flash"></div>
      <div class="capture-toast">
        <span class="capture-toast-mark">${icon("check", 15)}</span>
        <span>GPTへ送信完了</span>
      </div>
    </div>
    <section class="panel" aria-label="Meetron controls">
      <header class="header">
        <div class="brand">
          <span class="brand-icon">${icon("activity", 17)}</span>
          <span class="status-dot" data-status-dot></span>
          <span class="brand-text">Meetron</span>
        </div>
        <button class="icon-button" data-mic-quick type="button" title="GPT参加者のマイクを切り替える" aria-label="GPT参加者のマイクを切り替える">${icon("micOff")}</button>
        <button class="icon-button" data-expand type="button" title="パネルを折りたたむ" aria-label="パネルを折りたたむ">${icon("chevronDown")}</button>
      </header>
      <div class="body">
        <div class="section-title">接続状況</div>
        <div class="status-list">
          <div class="status-row"><span>${icon("activity")}</span><span>GPT参加者</span><span class="status-value" data-meet-status>確認中</span></div>
          <div class="status-row"><span>${icon("volume")}</span><span>ChatGPT Voice</span><span class="status-value" data-voice-status>確認中</span></div>
          <div class="status-row"><span>${icon("terminal")}</span><span>音声経路</span><span class="status-value" data-audio-status>確認中</span></div>
        </div>
        <div class="section-title">操作</div>
        <div class="actions">
          <button class="command primary wide screenshot-command" data-screenshot data-visual-state="idle" type="button" aria-label="GPTに画面を送る">
            <span class="screenshot-icon" data-screenshot-icon>${icon("image")}</span>
            <span data-screenshot-label>GPTに画面を送る</span>
            <span class="screenshot-beam" aria-hidden="true"></span>
            <span class="screenshot-particles" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          </button>
          <button class="command primary" data-mic type="button">${icon("micOff")}<span>ミュート解除</span></button>
          <button class="command" data-restart type="button">${icon("rotate")}<span>Voice再起動</span></button>
          <button class="command" data-stop type="button">${icon("square")}<span>セッション終了</span></button>
          <button class="command" data-diagnostics type="button">${icon("terminal")}<span>診断</span></button>
        </div>
        <div class="footer">
          <span class="message" data-message>ローカルホストへ接続しています</span>
          <button class="icon-button" data-refresh type="button" title="状態を更新" aria-label="状態を更新">${icon("refresh")}</button>
        </div>
      </div>
    </section>
  `;

  const elements = {
    panel: shadow.querySelector(".panel"),
    header: shadow.querySelector(".header"),
    dot: shadow.querySelector("[data-status-dot]"),
    expand: shadow.querySelector("[data-expand]"),
    micQuick: shadow.querySelector("[data-mic-quick]"),
    screenshot: shadow.querySelector("[data-screenshot]"),
    screenshotIcon: shadow.querySelector("[data-screenshot-icon]"),
    screenshotLabel: shadow.querySelector("[data-screenshot-label]"),
    captureEffect: shadow.querySelector("[data-capture-effect]"),
    mic: shadow.querySelector("[data-mic]"),
    restart: shadow.querySelector("[data-restart]"),
    stop: shadow.querySelector("[data-stop]"),
    diagnostics: shadow.querySelector("[data-diagnostics]"),
    refresh: shadow.querySelector("[data-refresh]"),
    message: shadow.querySelector("[data-message]"),
    participantStatus: shadow.querySelector("[data-meet-status]"),
    voiceStatus: shadow.querySelector("[data-voice-status]"),
    audioStatus: shadow.querySelector("[data-audio-status]"),
  };

  let hostStatus = null;
  let busy = false;
  let microphoneOverride = null;
  let participantMeetingKey = "";
  let screenshotPhaseTimer = null;
  let screenshotResetTimer = null;

  const screenshotVisuals = {
    idle: { label: "GPTに画面を送る", icon: "image" },
    capturing: { label: "画面を撮影中…", icon: "image" },
    sending: { label: "GPTへ送信中…", icon: "image" },
    success: { label: "GPTへ送信完了", icon: "check" },
    error: { label: "送信に失敗", icon: "image" },
  };

  function clearScreenshotTimers() {
    window.clearTimeout(screenshotPhaseTimer);
    window.clearTimeout(screenshotResetTimer);
    screenshotPhaseTimer = null;
    screenshotResetTimer = null;
  }

  function setScreenshotVisualState(state) {
    const visual = screenshotVisuals[state] || screenshotVisuals.idle;
    elements.screenshot.dataset.visualState = state;
    elements.captureEffect.dataset.visualState = state;
    elements.screenshot.classList.toggle("is-processing", ["capturing", "sending"].includes(state));
    elements.screenshot.classList.toggle("is-success", state === "success");
    elements.screenshot.classList.toggle("is-error", state === "error");
    elements.screenshotIcon.innerHTML = icon(visual.icon);
    elements.screenshotLabel.textContent = visual.label;
    elements.screenshot.setAttribute("aria-label", visual.label);
  }

  function beginScreenshotVisuals() {
    clearScreenshotTimers();
    setScreenshotVisualState("idle");
    // Resetting the state before layout ensures repeated captures replay the effect.
    void elements.captureEffect.offsetWidth;
    setScreenshotVisualState("capturing");
    screenshotPhaseTimer = window.setTimeout(() => {
      if (busy) setScreenshotVisualState("sending");
    }, 480);
  }

  function finishScreenshotVisuals(state) {
    window.clearTimeout(screenshotPhaseTimer);
    screenshotPhaseTimer = null;
    setScreenshotVisualState(state);
    screenshotResetTimer = window.setTimeout(() => {
      setScreenshotVisualState("idle");
      screenshotResetTimer = null;
    }, state === "success" ? 1_600 : 1_300);
  }

  function meetingKey(value) {
    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
    } catch {
      return "";
    }
  }

  function getParticipantState() {
    const live = hostStatus?.dedicatedMeeting || hostStatus?.dedicatedMeet || {};
    const launch = hostStatus?.meetingLaunch || {};
    const tracked = hostStatus?.participantMicrophone || hostStatus?.meetMicrophone || {};
    const currentMeetingKey = meetingKey(live.url || launch.meetingUrl);
    if (currentMeetingKey !== participantMeetingKey) {
      participantMeetingKey = currentMeetingKey;
      microphoneOverride = null;
    }
    const trackedMatchesLaunch =
      meetingKey(tracked.meetingUrl) &&
      meetingKey(tracked.meetingUrl) === meetingKey(launch.meetingUrl);

    let connection = live.connection || "not-running";
    if (connection === "not-running") {
      if (["starting", "running"].includes(launch.status)) {
        connection = "starting";
      } else if (launch.status === "failed") {
        connection = "failed";
      }
    }
    if (
      launch.manualActionRequired === true &&
      ["prejoin", "not-running"].includes(connection)
    ) {
      connection = "manual-action-required";
    }

    const detectedMicrophone = ["muted", "unmuted"].includes(live.microphone)
      ? live.microphone
      : "unavailable";
    if (detectedMicrophone !== "unavailable") {
      microphoneOverride = detectedMicrophone;
    } else if (trackedMatchesLaunch && ["muted", "unmuted"].includes(tracked.state)) {
      microphoneOverride = tracked.state;
    }

    return {
      connection,
      actionRequired: launch.actionRequired,
      providerId: live.providerId || launch.providerId || "google-meet",
      visualContext: live.capabilities?.visualContext || "unsupported",
      audioConnection: live.audioConnection || "unknown",
      microphone:
        detectedMicrophone === "unavailable"
          ? microphoneOverride || "unavailable"
          : detectedMicrophone,
    };
  }

  function setValue(element, text, tone = "") {
    element.textContent = text;
    element.className = `status-value${tone ? ` ${tone}` : ""}`;
  }

  function setMessage(text, error = false) {
    elements.message.textContent = text;
    elements.message.className = `message${error ? " error" : ""}`;
  }

  function render() {
    const participant = getParticipantState();
    const voice = hostStatus?.chatgpt || {};
    const launchInProgress = ["starting", "running"].includes(
      hostStatus?.meetingLaunch?.status,
    );
    const zoomAudioPending =
      participant.providerId === "zoom-web" &&
      participant.connection === "joined" &&
      participant.audioConnection !== "connected";
    const joinedLabel =
      zoomAudioPending
        ? ["参加中・音声接続待ち", ""]
        : participant.microphone === "muted"
        ? ["参加中・ミュート", "good"]
        : participant.microphone === "unmuted"
          ? ["参加中・送話中", "good"]
          : ["参加中・状態不明", ""];
    const connectionLabels = {
      joined: joinedLabel,
      waiting: ["承認待ち", ""],
      rejected: ["参加拒否", "bad"],
      prejoin: ["参加前", ""],
      "manual-action-required": ["手動参加待ち", ""],
      starting: ["起動中", ""],
      failed: ["起動失敗", "bad"],
      stopped: ["終了済み", ""],
      "not-running": ["未起動", ""],
    };
    setValue(
      elements.participantStatus,
      ...(connectionLabels[participant.connection] || ["状態不明", ""]),
    );

    const muted = participant.microphone === "muted";
    const microphoneKnown = ["muted", "unmuted"].includes(participant.microphone);
    const micLabel = muted ? "ミュート解除" : "ミュート";
    elements.mic.innerHTML = `${icon(muted ? "micOff" : "mic")}<span>${micLabel}</span>`;
    elements.mic.classList.toggle("primary", muted);
    const nativeToggleAvailable =
      participant.connection === "joined" && microphoneKnown && Boolean(hostStatus);
    elements.mic.disabled = !nativeToggleAvailable || busy;
    elements.micQuick.innerHTML = icon(muted ? "micOff" : "mic");
    elements.micQuick.classList.toggle("danger", participant.microphone === "unmuted");
    elements.micQuick.disabled = !nativeToggleAvailable || busy;
    elements.micQuick.title = muted
      ? "GPT参加者のミュートを解除"
      : "GPT参加者をミュート";
    elements.micQuick.setAttribute("aria-label", elements.micQuick.title);

    const visualContextSupported = participant.visualContext === "viewport-screenshot";
    elements.screenshot.hidden = Boolean(hostStatus) && !visualContextSupported;
    const screenshotAvailable =
      visualContextSupported &&
      participant.connection === "joined" &&
      voice.voiceActive === true &&
      Boolean(hostStatus);
    elements.screenshot.disabled = !screenshotAvailable || busy;
    elements.screenshot.title = screenshotAvailable
      ? "現在の会議画面をChatGPTへ送る"
      : participant.connection !== "joined"
        ? "GPT参加者の会議参加後に利用できます"
        : "ChatGPT Voiceの開始後に利用できます";
    elements.restart.disabled = busy;
    elements.stop.disabled = busy;
    elements.diagnostics.disabled = busy;

    if (!hostStatus) {
      setValue(elements.voiceStatus, "未接続", "bad");
      setValue(elements.audioStatus, "未確認", "bad");
      elements.dot.className = "status-dot error";
      return;
    }

    const voiceRoutingReady = voice.audioOutput?.routed === true;
    const voiceHealthy = voice.voiceActive && voiceRoutingReady;
    setValue(
      elements.voiceStatus,
      voice.voiceActive
        ? voiceRoutingReady
          ? "起動中"
          : "出力異常"
        : launchInProgress
          ? "起動中"
          : voice.browserConnected
            ? "停止中"
            : "未接続",
      voiceHealthy ? "good" : launchInProgress ? "" : "bad",
    );
    const audio = hostStatus.audio || {};
    const audioReady =
      audio.ready &&
      !zoomAudioPending &&
      (!voice.voiceActive || voiceRoutingReady);
    setValue(
      elements.audioStatus,
      launchInProgress
        ? "準備中"
        : zoomAudioPending ? "Zoomへ接続中" : audioReady ? "正常" : "要確認",
      audioReady ? "good" : launchInProgress || zoomAudioPending ? "" : "bad",
    );

    const ready =
      participant.connection === "joined" &&
      !zoomAudioPending &&
      voiceHealthy &&
      audioReady;
    elements.dot.className = `status-dot ${ready ? "ready" : ""}`;
    if (participant.connection === "manual-action-required") {
      setMessage(
        participant.actionRequired === "camera-check"
          ? "専用Chromeでカメラをオフにして、手動で参加してください"
          : "専用Chromeで表示内容を確認し、手動で参加してください",
      );
    }
  }

  async function nativeRequest(type, payload = {}) {
    if (typeof globalThis.chrome?.runtime?.sendMessage !== "function") {
      throw new Error("Meetron拡張機能を再読み込みしてからページを更新してください");
    }
    const response = await globalThis.chrome.runtime.sendMessage({
      channel: "meeting-copilot",
      type: "native-request",
      request: { type, payload },
    });
    if (!response?.ok) {
      const error = new Error(response?.error || "Native Host request failed.");
      error.code = response?.errorData?.code || "NATIVE_HOST_ERROR";
      error.details = response?.errorData?.details;
      throw error;
    }
    return response.data;
  }

  async function refreshStatus({ quiet = false } = {}) {
    if (!quiet) {
      setMessage("状態を更新しています");
    }
    try {
      hostStatus = await nativeRequest("status.get");
      if (!quiet) setMessage("接続済み");
    } catch (error) {
      // Background polling is advisory. A transient Native Host delay must not
      // erase a known-good state or flash an error over an active operation.
      if (quiet) return;
      hostStatus = null;
      setMessage(error.message, true);
    }
    render();
  }

  async function toggleMicrophone() {
    const participant = getParticipantState();
    const desiredState = participant.microphone === "muted" ? "unmuted" : "muted";
    const previousOverride = microphoneOverride;
    const previousMeeting = hostStatus?.dedicatedMeeting || hostStatus?.dedicatedMeet || null;
    const previousTracked = hostStatus?.participantMicrophone || null;
    busy = true;
    try {
      if (!hostStatus || participant.connection !== "joined") {
        throw new Error("GPT参加者は会議に参加していません");
      }
      microphoneOverride = desiredState;
      const pendingMeeting = { ...previousMeeting, microphone: desiredState };
      hostStatus.dedicatedMeeting = pendingMeeting;
      if (hostStatus.dedicatedMeet) hostStatus.dedicatedMeet = pendingMeeting;
      hostStatus.participantMicrophone = {
        ...(previousTracked || {}),
        meetingUrl: previousTracked?.meetingUrl || hostStatus.meetingLaunch?.meetingUrl,
        providerId: participant.providerId,
        state: desiredState,
      };
      setMessage(desiredState === "muted" ? "ミュートしています" : "ミュートを解除しています");
      render();
      const result = await nativeRequest("participant.mic.set", { state: desiredState });
      if (result?.verified !== true || result.after !== desiredState) {
        throw new Error("会議のマイク状態を確認できませんでした");
      }
      if (["muted", "unmuted"].includes(result.after)) {
        microphoneOverride = result.after;
        hostStatus.participantMicrophone = {
          meetingUrl: result.url || hostStatus.meetingLaunch?.meetingUrl,
          providerId: participant.providerId,
          state: result.after,
        };
        const updatedMeeting = {
          ...(hostStatus.dedicatedMeeting || hostStatus.dedicatedMeet || {}),
          connection: "joined",
          microphone: result.after,
          url:
            result.url ||
            hostStatus.dedicatedMeeting?.url ||
            hostStatus.dedicatedMeet?.url,
        };
        hostStatus.dedicatedMeeting = updatedMeeting;
        if (hostStatus.dedicatedMeet) hostStatus.dedicatedMeet = updatedMeeting;
        setMessage(
          result.after === "muted"
            ? "GPT参加者をミュートしました"
            : "GPT参加者のミュートを解除しました",
        );
      }
    } catch (error) {
      // The request may time out immediately before the browser applies the
      // change. Keep the pending UI while checking the actual meeting state.
      const confirmedStatus = await nativeRequest("status.get").catch(() => null);
      const confirmedMeeting =
        confirmedStatus?.dedicatedMeeting || confirmedStatus?.dedicatedMeet || {};
      if (confirmedMeeting.microphone === desiredState) {
        hostStatus = confirmedStatus;
        microphoneOverride = desiredState;
        setMessage(
          desiredState === "muted"
            ? "GPT参加者をミュートしました"
            : "GPT参加者のミュートを解除しました",
        );
      } else {
        microphoneOverride = previousOverride;
        if (hostStatus && previousMeeting) {
          hostStatus.dedicatedMeeting = previousMeeting;
          if (hostStatus.dedicatedMeet) hostStatus.dedicatedMeet = previousMeeting;
        }
        if (hostStatus) hostStatus.participantMicrophone = previousTracked;
        setMessage(error.message, true);
      }
    } finally {
      busy = false;
      render();
    }
  }

  async function runCommand(type, pendingMessage, successMessage) {
    busy = true;
    setMessage(pendingMessage);
    elements.restart.disabled = true;
    elements.stop.disabled = true;
    try {
      const result = await nativeRequest(type);
      if (result?.warnings?.length) {
        setMessage(`${successMessage}: ${result.warnings.join(" / ")}`, true);
      } else {
        setMessage(successMessage);
      }
      await refreshStatus({ quiet: true });
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      busy = false;
      elements.restart.disabled = false;
      elements.stop.disabled = false;
      render();
    }
  }

  async function sendScreenshot() {
    busy = true;
    beginScreenshotVisuals();
    setMessage("現在の画面をChatGPTへ送信しています");
    render();
    try {
      const result = await nativeRequest("visual-context.screenshot.send");
      const size = Number.isFinite(result?.bytes)
        ? `${Math.max(1, Math.round(result.bytes / 1024))} KB`
        : "送信完了";
      const dimensions = Number.isFinite(result?.width) && Number.isFinite(result?.height)
        ? `${result.width}×${result.height}`
        : "画面";
      finishScreenshotVisuals("success");
      setMessage(`ChatGPTへ送信しました（${dimensions} / ${size}）`);
    } catch (error) {
      const stage = error?.details?.stage;
      const diagnostic = [error?.code, stage].filter(Boolean).join(" / ");
      finishScreenshotVisuals("error");
      setMessage(`${error.message}${diagnostic ? `（${diagnostic}）` : ""}`, true);
    } finally {
      busy = false;
      render();
    }
  }

  function onTrustedClick(element, handler) {
    element.addEventListener("click", (event) => {
      if (!event.isTrusted) {
        return;
      }
      handler(event);
    });
  }

  onTrustedClick(elements.mic, toggleMicrophone);
  onTrustedClick(elements.micQuick, toggleMicrophone);
  onTrustedClick(elements.screenshot, sendScreenshot);
  onTrustedClick(elements.refresh, () => refreshStatus());
  onTrustedClick(elements.restart, () =>
    runCommand("voice.restart", "Voiceを再起動しています", "Voiceを再起動しました"),
  );
  onTrustedClick(elements.stop, () =>
    runCommand("session.stop", "セッションを終了しています", "セッションを終了しました"),
  );
  onTrustedClick(elements.diagnostics, async () => {
    busy = true;
    setMessage("環境を診断しています");
    try {
      const result = await nativeRequest("diagnostics.run");
      setMessage(result.ok ? "診断が完了しました" : "診断で問題が見つかりました", !result.ok);
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      busy = false;
    }
  });

  function setCollapsed(collapsed) {
    elements.panel.classList.toggle("collapsed", collapsed);
    elements.expand.innerHTML = icon(collapsed ? "chevronUp" : "chevronDown");
    elements.expand.title = collapsed ? "パネルを開く" : "パネルを折りたたむ";
    elements.expand.setAttribute("aria-label", elements.expand.title);
  }

  onTrustedClick(elements.expand, async () => {
    const collapsed = !elements.panel.classList.contains("collapsed");
    setCollapsed(collapsed);
    await chrome.storage.local.set({ controlsCollapsed: collapsed });
  });

  let drag = null;
  elements.header.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) {
      return;
    }
    const rect = host.getBoundingClientRect();
    drag = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    elements.header.setPointerCapture(event.pointerId);
  });
  elements.header.addEventListener("pointermove", (event) => {
    if (!drag) {
      return;
    }
    const maxX = Math.max(8, window.innerWidth - host.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - host.offsetHeight - 8);
    const left = Math.min(maxX, Math.max(8, event.clientX - drag.offsetX));
    const top = Math.min(maxY, Math.max(8, event.clientY - drag.offsetY));
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
  });
  elements.header.addEventListener("pointerup", async (event) => {
    if (!drag) {
      return;
    }
    drag = null;
    elements.header.releasePointerCapture(event.pointerId);
    await chrome.storage.local.set({
      controlsPosition: { left: host.style.left, top: host.style.top },
    });
  });

  chrome.storage.local.get(["controlsCollapsed", "controlsPosition"]).then((stored) => {
    if (stored.controlsCollapsed) {
      setCollapsed(true);
    }
    if (stored.controlsPosition?.left && stored.controlsPosition?.top) {
      host.style.left = stored.controlsPosition.left;
      host.style.top = stored.controlsPosition.top;
      host.style.right = "auto";
      host.style.bottom = "auto";
    }
  });

  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes.controlsCollapsed) {
      setCollapsed(changes.controlsCollapsed.newValue === true);
    }
  });

  render();
  refreshStatus();
  window.setInterval(() => refreshStatus({ quiet: true }), 10_000);
})();
