import { isAbsolute } from "node:path";
import { MeetronError } from "../core/errors.mjs";

const REQUIRED_PATH_FIELDS = Object.freeze([
  "runtimeDir",
  "dedicatedProfileDir",
  "legacyProfileDir",
]);

export function definePlatformAdapter(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new MeetronError("INVALID_PLATFORM_ADAPTER", "Platform adapter must be an object");
  }
  if (typeof definition.id !== "string" || !definition.id) {
    throw new MeetronError("INVALID_PLATFORM_ADAPTER", "Platform adapter id is required");
  }
  if (typeof definition.label !== "string" || !definition.label) {
    throw new MeetronError(
      "INVALID_PLATFORM_ADAPTER",
      `Platform adapter ${definition.id} requires a label`,
    );
  }
  if (typeof definition.resolvePaths !== "function") {
    throw new MeetronError(
      "INVALID_PLATFORM_ADAPTER",
      `Platform adapter ${definition.id} must implement resolvePaths()`,
    );
  }
  if (typeof definition.meetingMuteShortcut !== "string" || !definition.meetingMuteShortcut) {
    throw new MeetronError(
      "INVALID_PLATFORM_ADAPTER",
      `Platform adapter ${definition.id} requires a meetingMuteShortcut`,
    );
  }
  return Object.freeze({ ...definition });
}

export function assertResolvedPlatformPaths(paths) {
  for (const field of REQUIRED_PATH_FIELDS) {
    if (typeof paths?.[field] !== "string" || !isAbsolute(paths[field])) {
      throw new MeetronError(
        "INVALID_PLATFORM_PATHS",
        `Platform path ${field} must be absolute`,
      );
    }
  }
  if (!Array.isArray(paths.chromeApplications) ||
      paths.chromeApplications.some((entry) => typeof entry !== "string" || !isAbsolute(entry))) {
    throw new MeetronError(
      "INVALID_PLATFORM_PATHS",
      "chromeApplications must contain absolute paths",
    );
  }
  return paths;
}
