import { MeetronError, serializeError } from "./errors.mjs";

export const PROTOCOL_VERSION = 1;

const COMMAND_ALIASES = Object.freeze({
  "status.get": "session.status.get",
  "meeting.start": "session.start",
  "meet.mic.toggle": "participant.mic.toggle",
});

export function normalizeProtocolRequest(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new MeetronError("INVALID_REQUEST", "Native Host request must be an object");
  }

  const protocolVersion = message.protocolVersion ?? PROTOCOL_VERSION;
  if (protocolVersion !== PROTOCOL_VERSION) {
    throw new MeetronError(
      "PROTOCOL_VERSION_UNSUPPORTED",
      `Unsupported protocol version: ${protocolVersion}`,
      { supportedVersions: [PROTOCOL_VERSION] },
    );
  }

  const requestId = message.requestId ?? message.id;
  if (requestId !== undefined && (typeof requestId !== "string" || requestId.length > 128)) {
    throw new MeetronError("INVALID_REQUEST_ID", "requestId must be a string of at most 128 characters");
  }
  if (typeof message.type !== "string" || !message.type) {
    throw new MeetronError("INVALID_COMMAND", "Native Host request type is required");
  }

  return {
    protocolVersion,
    requestId,
    type: COMMAND_ALIASES[message.type] || message.type,
    originalType: message.type,
    payload: message.payload && typeof message.payload === "object" ? message.payload : {},
    sessionId: message.sessionId ?? message.payload?.sessionId,
  };
}

export function createProtocolResponse(request, { data, error } = {}) {
  const requestId = request?.requestId;
  const response = {
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    // `id` is retained until every installed extension has migrated.
    id: requestId,
    ok: !error,
  };
  if (error) {
    const serialized = serializeError(error);
    return { ...response, error: serialized.message, errorData: serialized };
  }
  return { ...response, data };
}
