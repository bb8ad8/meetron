import { MeetronError } from "../core/errors.mjs";
import {
  createParticipantStatus,
  createReconciliationResult,
} from "../core/participant-state.mjs";

const DEFINITION_METHODS = Object.freeze(["matchUrl", "normalizeUrl"]);
const RUNTIME_METHODS = Object.freeze([
  "getStatus",
  "reconcileSession",
  "setMicrophone",
  "leave",
]);
const INITIAL_PAGES = new Set(["meeting-display-url", "blank"]);
const URL_TRANSPORTS = new Set(["argument", "stdin"]);

export function assertProviderDefinition(definition) {
  if (!definition || typeof definition.id !== "string" || !definition.id) {
    throw new MeetronError("INVALID_PROVIDER", "MeetingProvider.id is required");
  }
  if (typeof definition.label !== "string" || !definition.label) {
    throw new MeetronError("INVALID_PROVIDER", `MeetingProvider ${definition.id} requires a label`);
  }
  if (!definition.automation || typeof definition.automation !== "object") {
    throw new MeetronError(
      "INVALID_PROVIDER",
      `MeetingProvider ${definition.id} requires automation settings`,
    );
  }
  if (!INITIAL_PAGES.has(definition.automation.initialPage)) {
    throw new MeetronError(
      "INVALID_PROVIDER",
      `MeetingProvider ${definition.id} has an invalid initial page`,
    );
  }
  if (
    typeof definition.automation.preparationScript !== "string" ||
    !definition.automation.preparationScript.endsWith(".mjs") ||
    !URL_TRANSPORTS.has(definition.automation.urlTransport) ||
    typeof definition.automation.supportsJoinDelay !== "boolean"
  ) {
    throw new MeetronError(
      "INVALID_PROVIDER",
      `MeetingProvider ${definition.id} has invalid preparation settings`,
    );
  }
  for (const method of DEFINITION_METHODS) {
    if (typeof definition[method] !== "function") {
      throw new MeetronError(
        "INVALID_PROVIDER",
        `MeetingProvider ${definition.id} must implement ${method}()`,
      );
    }
  }
  return definition;
}

export function createRuntimeProvider(definition, operations) {
  assertProviderDefinition(definition);
  const provider = { ...definition };
  for (const name of RUNTIME_METHODS) {
    if (typeof operations?.[name] !== "function") {
      throw new MeetronError(
        "INVALID_PROVIDER",
        `MeetingProvider ${definition.id} must implement ${name}()`,
      );
    }
    provider[name] = operations[name];
  }
  provider.getStatus = async (...args) => createParticipantStatus(
    await operations.getStatus(...args),
  );
  provider.reconcileSession = async (...args) => createReconciliationResult(
    await operations.reconcileSession(...args),
  );
  return Object.freeze(provider);
}
