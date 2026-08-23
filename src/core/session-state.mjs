import { randomUUID } from "node:crypto";
import { MeetronError } from "./errors.mjs";
import { PROTOCOL_VERSION } from "./protocol.mjs";

export const SESSION_STATES = Object.freeze([
  "starting",
  "running",
  "completed",
  "failed",
  "stopped",
]);

export function createSessionState({ meeting, audioBackendId = "custom", now = new Date() }) {
  if (!meeting?.providerId || !meeting?.url || !meeting?.meetingKey) {
    throw new MeetronError("INVALID_MEETING", "Normalized meeting data is required");
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId: randomUUID(),
    providerId: meeting.providerId,
    audioBackendId,
    // Persist only the redacted URL. Provider secrets remain in the launch request.
    meetingUrl: meeting.displayUrl,
    meetingKey: meeting.meetingKey,
    meetingDisplay: meeting.displayUrl,
    status: "starting",
    pid: null,
    startedAt: now.toISOString(),
  };
}

export function migrateSessionState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return {
    protocolVersion: state.protocolVersion ?? PROTOCOL_VERSION,
    sessionId: state.sessionId ?? null,
    providerId: state.providerId ?? "google-meet",
    audioBackendId: state.audioBackendId ?? "legacy",
    ...state,
  };
}

export function assertSessionOwnership(current, sessionId) {
  if (current?.sessionId && current.sessionId !== sessionId) {
    throw new MeetronError(
      "STALE_SESSION",
      "A previous session tried to overwrite the current session state",
      { currentSessionId: current.sessionId, attemptedSessionId: sessionId },
    );
  }
}
