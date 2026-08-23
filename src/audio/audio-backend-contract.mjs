import { MeetronError } from "../core/errors.mjs";

function assertDeviceTarget(value, field, backendId) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MeetronError(
      "INVALID_AUDIO_BACKEND",
      `Audio backend ${backendId} requires ${field}`,
    );
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new MeetronError(
      "INVALID_AUDIO_BACKEND",
      `Audio backend ${backendId} requires ${field}.name`,
    );
  }
  if (value.uid !== undefined && typeof value.uid !== "string") {
    throw new MeetronError(
      "INVALID_AUDIO_BACKEND",
      `Audio backend ${backendId} ${field}.uid must be a string`,
    );
  }
  return Object.freeze({ name: value.name, uid: value.uid || "" });
}

export function defineAudioBackend(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new MeetronError("INVALID_AUDIO_BACKEND", "Audio backend must be an object");
  }
  if (typeof definition.id !== "string" || !definition.id.trim()) {
    throw new MeetronError("INVALID_AUDIO_BACKEND", "Audio backend id is required");
  }
  if (typeof definition.label !== "string" || !definition.label.trim()) {
    throw new MeetronError(
      "INVALID_AUDIO_BACKEND",
      `Audio backend ${definition.id} requires a label`,
    );
  }
  return Object.freeze({
    id: definition.id,
    label: definition.label,
    meetingToAI: assertDeviceTarget(definition.meetingToAI, "meetingToAI", definition.id),
    aiToMeeting: assertDeviceTarget(definition.aiToMeeting, "aiToMeeting", definition.id),
  });
}
