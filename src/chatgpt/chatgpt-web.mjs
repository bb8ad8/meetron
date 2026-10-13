import { activateLocator, firstVisibleLocator } from "../browser/meeting-browser.mjs";
import { MeetronError } from "../core/errors.mjs";

const VOICE_END_NAME = /^(音声を終了(?:する)?|End voice)$/i;
const VOICE_SETTINGS_NAME = /^(音声設定|Voice settings)$/i;
const MICROPHONE_ON_NAME = /^(マイクをオフ(?:にする)?|マイクをミュート|Turn off microphone|Mute microphone)$/i;
const SEND_NAME = /^(プロンプトを送信する|メッセージを送信する|Send prompt|Send message)$/i;
const ATTACH_NAME = /(?:ファイル|写真|画像).*(?:追加|添付|アップロード)|(?:追加|添付|アップロード).*(?:ファイル|写真|画像)|(?:add|attach|upload).*(?:file|photo|image)|(?:file|photo|image).*(?:add|attach|upload)/i;
const REMOVE_NAME = /削除|取り除く|remove|delete/i;
const UPLOAD_FAILURE_TEXT = /アップロード.*(?:失敗|エラー)|(?:失敗|エラー).*(?:アップロード|添付)|upload.*(?:failed|error)|(?:failed|error).*upload/i;
const SEND_FAILURE_TEXT = /送信.*(?:失敗|エラー)|(?:失敗|エラー).*(?:送信|メッセージ)|(?:send|message).*(?:failed|error)|something went wrong/i;
const DEFAULT_TIMEOUTS = Object.freeze({
  fileChooser: 2_500,
  previewConfirm: 15_000,
  sendClick: 3_000,
  sentConfirm: 15_000,
  poll: 100,
});

function screenshotPrompt(contextLabel) {
  return `この画像は現在の${contextLabel}に表示されている画面です。会議の追加コンテキストとして扱ってください。必要になるまで発言は控えてください。`;
}

export async function getChatgptWebUiState(page) {
  if (!page) return { voiceActive: false, microphoneOn: false };
  const [endVoice, voiceSettings, microphoneOn] = await Promise.all([
    firstVisibleLocator([page.getByRole("button", { name: VOICE_END_NAME })]),
    firstVisibleLocator([page.getByRole("button", { name: VOICE_SETTINGS_NAME })]),
    firstVisibleLocator([page.getByRole("button", { name: MICROPHONE_ON_NAME })]),
  ]);
  return {
    // Voice settings is the stable marker in the integrated Voice UI. Keep the
    // former End voice marker for older ChatGPT variants.
    voiceActive: Boolean(endVoice || voiceSettings),
    microphoneOn: Boolean(microphoneOn),
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function composerText(composer) {
  const tagName = await composer.evaluate((element) => element.tagName);
  if (tagName === "TEXTAREA" || tagName === "INPUT") return composer.inputValue();
  return (await composer.textContent()) || "";
}

async function visibleCount(locator) {
  let count = 0;
  try {
    for (let index = 0; index < await locator.count(); index += 1) {
      if (await locator.nth(index).isVisible()) count += 1;
    }
  } catch {
    return count;
  }
  return count;
}

function attachmentLocators(page) {
  return {
    removal: page.locator([
      'button[aria-label*="remove" i]',
      'button[aria-label*="delete" i]',
      'button[aria-label*="削除"]',
      'button[title*="remove" i]',
      'button[title*="delete" i]',
      'button[title*="削除"]',
    ].join(",")),
    preview: page.locator([
      '[data-testid*="attachment"] img',
      '[data-testid*="file-preview"]',
      '[data-testid*="file-thumbnail"]',
      '[aria-label*="attachment" i] img',
    ].join(",")),
    thumbnail: page.locator('main img[src^="blob:"], main img[src^="data:image"]'),
    uploading: page.locator([
      '[role="progressbar"]',
      '[aria-busy="true"][data-testid*="upload"]',
      '[aria-label*="uploading" i]',
      '[aria-label*="アップロード中"]',
    ].join(",")),
  };
}

async function attachmentBaseline(page) {
  const locators = attachmentLocators(page);
  return {
    removal: await visibleCount(locators.removal),
    preview: await visibleCount(locators.preview),
    thumbnail: await visibleCount(locators.thumbnail),
  };
}

async function inputContainsFile(input, filename) {
  if (!input) return false;
  return input.evaluate(
    (element, expectedName) =>
      element instanceof HTMLInputElement &&
      Array.from(element.files || []).some((file) => file.name === expectedName),
    filename,
  ).catch(() => false);
}

async function firstVisibleUploadFailure(page) {
  return firstVisibleLocator([
    page.getByRole("alert").filter({ hasText: UPLOAD_FAILURE_TEXT }),
    page.locator('[data-testid*="upload-error"]').filter({ hasText: UPLOAD_FAILURE_TEXT }),
  ]);
}

async function attachmentSignals(page, input, filename, baseline) {
  const locators = attachmentLocators(page);
  const filenamePattern = new RegExp(escapeRegExp(filename), "i");
  const namedRemoval = await firstVisibleLocator([
    page.getByRole("button", {
      name: new RegExp(
        `(?:削除|取り除く|remove|delete).*${escapeRegExp(filename)}|${escapeRegExp(filename)}.*(?:削除|取り除く|remove|delete)`,
        "i",
      ),
    }),
    page.locator("button").filter({ hasText: filenamePattern }).filter({ hasText: REMOVE_NAME }),
  ]);
  const filenameText = await firstVisibleLocator([
    page.getByText(filename, { exact: true }),
  ]);
  const [removal, preview, thumbnail, uploading, fileMatched, uploadFailure] = await Promise.all([
    visibleCount(locators.removal),
    visibleCount(locators.preview),
    visibleCount(locators.thumbnail),
    visibleCount(locators.uploading),
    inputContainsFile(input, filename),
    firstVisibleUploadFailure(page),
  ]);
  return {
    fileMatched,
    uploading: uploading > 0,
    uploadFailure: Boolean(uploadFailure),
    signal:
      namedRemoval || filenameText
        ? "named-preview"
        : removal > baseline.removal
          ? "removal-control"
          : preview > baseline.preview
            ? "attachment-preview"
            : thumbnail > baseline.thumbnail
              ? "thumbnail"
              : "",
  };
}

async function waitForAttachmentConfirmation({
  page,
  input,
  filename,
  baseline,
  trustedInput,
  timeout,
  poll,
}) {
  const deadline = Date.now() + timeout;
  let sawUploading = false;
  let latest = { fileMatched: false, uploading: false, uploadFailure: false, signal: "" };
  do {
    latest = await attachmentSignals(page, input, filename, baseline);
    if (latest.uploadFailure) {
      throw new MeetronError(
        "CHATGPT_ATTACHMENT_UPLOAD_FAILED",
        "ChatGPTへの画像アップロードに失敗しました",
      );
    }
    sawUploading ||= latest.uploading;
    if (latest.signal) return latest.signal;
    if (latest.fileMatched && sawUploading && !latest.uploading) return "upload-complete";
    if (Date.now() < deadline) await delay(poll);
  } while (Date.now() < deadline);

  // Some ChatGPT variants expose no accessible preview marker. input.files is
  // a last-resort confirmation only for a chooser/visible input, and only after
  // the full preview grace period has elapsed.
  if (latest.fileMatched && trustedInput) return "input-files";
  throw new MeetronError(
    "CHATGPT_ATTACHMENT_CONFIRM_TIMEOUT",
    "ChatGPTで画像添付の完了を確認できませんでした",
  );
}

async function tryFileChooser(page, control, timeout) {
  if (!control) return null;
  // Attach the rejection handler immediately. ChatGPT's plus button often
  // opens a menu instead of a chooser; if the click itself remains pending,
  // the chooser timeout must not become an unhandled rejection that kills the
  // Native Host process.
  const chooserPromise = page.waitForEvent("filechooser", { timeout })
    .then((chooser) => ({ chooser }), (error) => ({ error }));
  try {
    await control.click({ timeout });
  } catch {
    await chooserPromise;
    return null;
  }
  const outcome = await chooserPromise;
  return outcome.chooser || null;
}

async function uploadAttachment({ page, attachmentButton, inputs, file, fileChooserTimeout }) {
  let chooser = await tryFileChooser(page, attachmentButton, fileChooserTimeout);
  if (!chooser && attachmentButton) {
    const menuItem = await firstVisibleLocator([
      page.getByRole("menuitem", { name: ATTACH_NAME }),
      page.getByRole("button", { name: ATTACH_NAME }),
      page.getByText(ATTACH_NAME).locator("xpath=ancestor-or-self::*[self::button or @role='menuitem'][1]"),
    ]);
    chooser = await tryFileChooser(page, menuItem, fileChooserTimeout);
  }
  if (chooser) {
    await chooser.setFiles(file);
    return { input: chooser.element(), method: "file-chooser", trustedInput: true };
  }

  let lastError;
  for (let index = (await inputs.count()) - 1; index >= 0; index -= 1) {
    const input = inputs.nth(index);
    try {
      const visible = await input.isVisible().catch(() => false);
      await input.setInputFiles(file);
      return { input, method: "direct-input", trustedInput: visible };
    } catch (error) {
      lastError = error;
      await input.setInputFiles([]).catch(() => {});
    }
  }
  throw new MeetronError(
    "CHATGPT_ATTACHMENT_UPLOAD_FAILED",
    "ChatGPTへ画像を投入できませんでした",
    lastError ? { cause: lastError.name || "Error" } : undefined,
  );
}

async function userMessageCount(page) {
  return page.locator('[data-message-author-role="user"]').count().catch(() => 0);
}

async function newUserMessageContains(page, startIndex, expectedText) {
  const messages = page.locator('[data-message-author-role="user"]');
  try {
    for (let index = startIndex; index < await messages.count(); index += 1) {
      if (((await messages.nth(index).textContent()) || "").includes(expectedText)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function waitForSentConfirmation({
  page,
  composer,
  previousUserMessages,
  expectedPrompt,
  timeout,
  poll,
}) {
  const deadline = Date.now() + timeout;
  do {
    const [text, messages, sendFailure] = await Promise.all([
      composerText(composer).catch(() => "__unavailable__"),
      userMessageCount(page),
      firstVisibleLocator([
        page.getByRole("alert").filter({ hasText: SEND_FAILURE_TEXT }),
        page.locator('[data-testid*="send-error"]').filter({ hasText: SEND_FAILURE_TEXT }),
      ]),
    ]);
    if (sendFailure) {
      throw new MeetronError("CHATGPT_SEND_FAILED", "ChatGPTでメッセージ送信に失敗しました");
    }
    const matchingUserMessage = messages > previousUserMessages &&
      await newUserMessageContains(page, previousUserMessages, expectedPrompt);
    if (text === "" || matchingUserMessage) {
      return text === "" ? "composer-cleared" : "user-message";
    }
    if (Date.now() < deadline) await delay(poll);
  } while (Date.now() < deadline);
  throw new MeetronError(
    "CHATGPT_SEND_CONFIRM_TIMEOUT",
    "ChatGPTへの送信完了を確認できませんでした",
  );
}

function createStageRunner(onProgress) {
  const operationStartedAt = Date.now();
  const timings = {};
  let activeStage = "preflight";
  const notify = (event, stage, extra = {}) => {
    try {
      onProgress?.({ event, stage, elapsedMs: Date.now() - operationStartedAt, ...extra });
    } catch {
      // Diagnostics must never make screenshot delivery fail.
    }
  };
  return {
    timings,
    get activeStage() {
      return activeStage;
    },
    async run(stage, code, message, action) {
      activeStage = stage;
      const startedAt = Date.now();
      notify("stage-start", stage);
      try {
        const result = await action();
        timings[stage] = Date.now() - startedAt;
        notify("stage-complete", stage, { durationMs: timings[stage] });
        return result;
      } catch (error) {
        timings[stage] = Date.now() - startedAt;
        const wrapped = error instanceof MeetronError
          ? error
          : new MeetronError(code, message, { cause: error?.name || "Error" });
        wrapped.details = {
          ...(wrapped.details || {}),
          stage,
          timings: { ...timings },
        };
        notify("stage-failed", stage, { durationMs: timings[stage], code: wrapped.code });
        throw wrapped;
      }
    },
  };
}

async function cleanupFailedAttachment({ page, composer, input, filename, baseline }) {
  await composer.fill("").catch(() => {});
  const namedRemoval = await firstVisibleLocator([
    page.getByRole("button", {
      name: new RegExp(
        `(?:削除|取り除く|remove|delete).*${escapeRegExp(filename)}|${escapeRegExp(filename)}.*(?:削除|取り除く|remove|delete)`,
        "i",
      ),
    }),
  ]);
  if (namedRemoval) {
    await namedRemoval.click({ force: true, timeout: 2_000 }).catch(() => {});
  } else {
    const removals = attachmentLocators(page).removal;
    if (await visibleCount(removals) > baseline.removal) {
      await removals.last().click({ force: true, timeout: 2_000 }).catch(() => {});
    }
  }
  await input?.setInputFiles([]).catch(() => {});
}

export async function sendMeetingScreenshotToChatgpt({
  meetingPage,
  chatgptPage,
  contextLabel = "会議",
  onProgress,
  timeouts = {},
}) {
  const configuredTimeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
  const stages = createStageRunner(onProgress);
  if (!meetingPage || meetingPage.isClosed()) {
    throw new MeetronError("MEETING_NOT_RUNNING", "会議画面が見つかりません", { stage: "preflight" });
  }
  if (!chatgptPage || chatgptPage.isClosed()) {
    throw new MeetronError("CHATGPT_NOT_RUNNING", "ChatGPTのタブが見つかりません", { stage: "preflight" });
  }

  const voice = await getChatgptWebUiState(chatgptPage);
  if (!voice.voiceActive) {
    throw new MeetronError("VOICE_NOT_ACTIVE", "ChatGPT Voiceを開始してから画面を送ってください", { stage: "preflight" });
  }
  const composer = await firstVisibleLocator([
    chatgptPage.locator('main [contenteditable="true"]'),
    chatgptPage.locator('[contenteditable="true"]'),
    chatgptPage.locator("textarea"),
    chatgptPage.getByRole("textbox"),
  ]);
  if (!composer) {
    throw new MeetronError("CHATGPT_COMPOSER_UNAVAILABLE", "ChatGPTの入力欄が見つかりません", { stage: "preflight" });
  }
  if ((await composerText(composer)).trim()) {
    throw new MeetronError(
      "CHATGPT_DRAFT_PRESENT",
      "ChatGPTの入力欄に未送信の文章があります。送信または削除してから再試行してください",
      { stage: "preflight" },
    );
  }

  const startedAt = Date.now();
  const capture = await stages.run(
    "capture",
    "SCREENSHOT_CAPTURE_FAILED",
    "会議画面のキャプチャに失敗しました",
    async () => ({
      dimensions: await meetingPage.evaluate(() => ({
        width: Math.round(window.innerWidth),
        height: Math.round(window.innerHeight),
      })),
      screenshot: await meetingPage.screenshot({
        type: "jpeg",
        quality: 80,
        scale: "css",
        animations: "disabled",
        caret: "hide",
      }),
    }),
  );

  const controls = await stages.run(
    "input-search",
    "CHATGPT_ATTACHMENT_CONTROL_UNAVAILABLE",
    "ChatGPTの画像添付操作が見つかりません",
    async () => {
      const attachmentButton = await firstVisibleLocator([
        chatgptPage.getByRole("button", { name: ATTACH_NAME }),
        chatgptPage.locator('button[data-testid*="attach" i], button[data-testid*="upload" i]'),
      ]);
      const inputs = chatgptPage.locator('input[type="file"]');
      if (!attachmentButton && (await inputs.count()) === 0) {
        throw new MeetronError(
          "CHATGPT_ATTACHMENT_CONTROL_UNAVAILABLE",
          "ChatGPTの画像添付操作が見つかりません",
        );
      }
      return { attachmentButton, inputs, baseline: await attachmentBaseline(chatgptPage) };
    },
  );

  const filename = `meetron-screen-${Date.now()}.jpg`;
  const file = { name: filename, mimeType: "image/jpeg", buffer: capture.screenshot };
  const prompt = screenshotPrompt(contextLabel);
  let uploaded;
  try {
    uploaded = await stages.run(
      "upload",
      "CHATGPT_ATTACHMENT_UPLOAD_FAILED",
      "ChatGPTへ画像を投入できませんでした",
      () => uploadAttachment({
        page: chatgptPage,
        attachmentButton: controls.attachmentButton,
        inputs: controls.inputs,
        file,
        fileChooserTimeout: configuredTimeouts.fileChooser,
      }),
    );
    await stages.run(
      "preview-confirm",
      "CHATGPT_ATTACHMENT_CONFIRM_TIMEOUT",
      "ChatGPTで画像添付の完了を確認できませんでした",
      () => waitForAttachmentConfirmation({
        page: chatgptPage,
        input: uploaded.input,
        filename,
        baseline: controls.baseline,
        trustedInput: uploaded.trustedInput,
        timeout: configuredTimeouts.previewConfirm,
        poll: configuredTimeouts.poll,
      }),
    );
    await stages.run(
      "prompt-fill",
      "CHATGPT_PROMPT_FILL_FAILED",
      "ChatGPTの入力欄へ説明を入力できませんでした",
      async () => {
        await composer.fill(prompt);
        if (!(await composerText(composer)).trim()) {
          throw new MeetronError(
            "CHATGPT_PROMPT_FILL_FAILED",
            "ChatGPTの入力欄へ説明を入力できませんでした",
          );
        }
      },
    );

    const previousUserMessages = await userMessageCount(chatgptPage);
    await stages.run(
      "send",
      "CHATGPT_SEND_FAILED",
      "ChatGPTへ送信操作を実行できませんでした",
      async () => {
        const send = await firstVisibleLocator([
          chatgptPage.locator('[data-testid="send-button"]'),
          chatgptPage.getByRole("button", { name: SEND_NAME }),
        ]);
        if (!send) {
          throw new MeetronError("CHATGPT_SEND_UNAVAILABLE", "ChatGPTの送信ボタンが見つかりません");
        }
        // ChatGPT Voice can leave an invisible layer over the composer even
        // though the real send button is visible and enabled. Prefer a normal
        // user-like click, then use the shared DOM-click fallback when
        // Playwright's actionability check cannot make progress.
        await activateLocator(send, { timeout: configuredTimeouts.sendClick });
      },
    );
    await stages.run(
      "sent-confirm",
      "CHATGPT_SEND_CONFIRM_TIMEOUT",
      "ChatGPTへの送信完了を確認できませんでした",
      () => waitForSentConfirmation({
        page: chatgptPage,
        composer,
        previousUserMessages,
        expectedPrompt: prompt,
        timeout: configuredTimeouts.sentConfirm,
        poll: configuredTimeouts.poll,
      }),
    );
  } catch (error) {
    await cleanupFailedAttachment({
      page: chatgptPage,
      composer,
      input: uploaded?.input,
      filename,
      baseline: controls.baseline,
    });
    throw error;
  }

  return {
    sent: true,
    width: capture.dimensions.width,
    height: capture.dimensions.height,
    bytes: capture.screenshot.byteLength,
    capturedAt: new Date(startedAt).toISOString(),
    elapsedMs: Date.now() - startedAt,
    stages: { ...stages.timings },
  };
}
