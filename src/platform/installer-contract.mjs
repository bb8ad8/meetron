import { MeetronError } from "../core/errors.mjs";

const REQUIRED_METHODS = Object.freeze(["getStatus", "install", "uninstall"]);

export function defineInstaller(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new MeetronError("INVALID_INSTALLER", "Installer must be an object");
  }
  if (typeof definition.id !== "string" || !definition.id.trim()) {
    throw new MeetronError("INVALID_INSTALLER", "Installer id is required");
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof definition[method] !== "function") {
      throw new MeetronError(
        "INVALID_INSTALLER",
        `Installer ${definition.id} must implement ${method}()`,
      );
    }
  }
  return Object.freeze({ ...definition });
}
