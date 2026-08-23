import { MeetronError } from "../core/errors.mjs";

const REQUIRED_METHODS = Object.freeze(["get", "set", "delete"]);

export function defineCredentialStore(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new MeetronError("INVALID_CREDENTIAL_STORE", "Credential store must be an object");
  }
  if (typeof definition.id !== "string" || !definition.id.trim()) {
    throw new MeetronError("INVALID_CREDENTIAL_STORE", "Credential store id is required");
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof definition[method] !== "function") {
      throw new MeetronError(
        "INVALID_CREDENTIAL_STORE",
        `Credential store ${definition.id} must implement ${method}()`,
      );
    }
  }
  return Object.freeze({ ...definition });
}
