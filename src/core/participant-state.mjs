import { MeetronError } from "./errors.mjs";

export const CONNECTION_STATES = Object.freeze([
  "not-running",
  "prejoin",
  "joining",
  "waiting",
  "joined",
  "rejected",
  "manual-action-required",
]);

export const MICROPHONE_STATES = Object.freeze(["muted", "unmuted", "unavailable"]);
export const CAMERA_STATES = Object.freeze(["off", "on", "unavailable", "unknown"]);
export const AUDIO_CONNECTION_STATES = Object.freeze([
  "connected",
  "disconnected",
  "unavailable",
  "unknown",
]);

export function assertMicrophoneState(state, { allowUnavailable = false } = {}) {
  const allowed = allowUnavailable ? MICROPHONE_STATES : MICROPHONE_STATES.slice(0, 2);
  if (!allowed.includes(state)) {
    throw new MeetronError(
      "INVALID_MICROPHONE_STATE",
      `Microphone state must be ${allowed.join(" or ")}`,
    );
  }
  return state;
}

export function createPreparationResult({
  providerId,
  meetingUrl,
  connection = "prejoin",
  microphone = "muted",
  camera = "off",
  ...details
}) {
  if (!CONNECTION_STATES.includes(connection)) {
    throw new MeetronError("INVALID_CONNECTION_STATE", `Unsupported connection state: ${connection}`);
  }
  assertMicrophoneState(microphone, { allowUnavailable: true });
  if (!CAMERA_STATES.includes(camera)) {
    throw new MeetronError("INVALID_CAMERA_STATE", `Unsupported camera state: ${camera}`);
  }
  return {
    providerId,
    meetingUrl,
    connection,
    microphone,
    camera,
    ...details,
  };
}

export function createParticipantStatus({
  browserConnected,
  connection,
  microphone,
  camera = "unknown",
  audioConnection = "unknown",
  ...details
}) {
  if (typeof browserConnected !== "boolean") {
    throw new MeetronError(
      "INVALID_PARTICIPANT_STATUS",
      "Participant browserConnected must be a boolean",
    );
  }
  if (!CONNECTION_STATES.includes(connection)) {
    throw new MeetronError("INVALID_CONNECTION_STATE", `Unsupported connection state: ${connection}`);
  }
  assertMicrophoneState(microphone, { allowUnavailable: true });
  if (!CAMERA_STATES.includes(camera)) {
    throw new MeetronError("INVALID_CAMERA_STATE", `Unsupported camera state: ${camera}`);
  }
  if (!AUDIO_CONNECTION_STATES.includes(audioConnection)) {
    throw new MeetronError(
      "INVALID_AUDIO_CONNECTION_STATE",
      `Unsupported audio connection state: ${audioConnection}`,
    );
  }
  return {
    browserConnected,
    connection,
    microphone,
    camera,
    audioConnection,
    ...details,
  };
}

export function createReconciliationResult({ ready, changed, ...details }) {
  if (typeof ready !== "boolean" || typeof changed !== "boolean") {
    throw new MeetronError(
      "INVALID_RECONCILIATION_RESULT",
      "Provider reconciliation must return boolean ready and changed fields",
    );
  }
  return { ready, changed, ...details };
}
