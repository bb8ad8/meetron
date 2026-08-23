import { resolve } from "node:path";
import {
  assertResolvedPlatformPaths,
  definePlatformAdapter,
} from "../platform-contract.mjs";
import { MeetronError } from "../../core/errors.mjs";

function requireAbsolute(name, value) {
  if (!value || !String(value).startsWith("/")) {
    throw new MeetronError("INVALID_PLATFORM_CONTEXT", `${name} must be an absolute path`);
  }
  return value;
}

export const macosPlatformAdapter = definePlatformAdapter({
  id: "darwin",
  label: "macOS",
  meetingMuteShortcut: "Meta+d",
  resolvePaths({ repoRoot, home, env = process.env }) {
    const safeRepoRoot = requireAbsolute("repoRoot", repoRoot);
    const safeHome = requireAbsolute("home", home);
    const applicationSupport = resolve(safeHome, "Library/Application Support");
    return assertResolvedPlatformPaths({
      runtimeDir: resolve(
        env.MEETING_COPILOT_RUNTIME_DIR || resolve(safeRepoRoot, ".meeting-copilot-runtime"),
      ),
      dedicatedProfileDir: resolve(
        env.MEETING_COPILOT_PROFILE_DIR ||
          resolve(applicationSupport, "MeetingCopilot/GPTParticipantChrome"),
      ),
      legacyProfileDir: resolve(applicationSupport, "MeetingCopilot/ChatGPTVoiceChrome"),
      chromeApplications: [
        "/Applications/Google Chrome.app",
        resolve(safeHome, "Applications/Google Chrome.app"),
      ],
      nativeMessagingManifestDirs: [
        resolve(applicationSupport, "Google/Chrome/NativeMessagingHosts"),
        resolve(
          env.MEETING_COPILOT_PROFILE_DIR ||
            resolve(applicationSupport, "MeetingCopilot/GPTParticipantChrome"),
          "NativeMessagingHosts",
        ),
      ],
    });
  },
});
