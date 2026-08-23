import { MeetronError } from "../core/errors.mjs";

export async function resolveMeetingAudioDevices(
  { microphoneDevice = "", speakerDevice = "" },
  getAudioStatus,
) {
  if (microphoneDevice && speakerDevice) {
    return { microphoneDevice, speakerDevice };
  }
  const audio = await getAudioStatus();
  const resolved = {
    microphoneDevice: microphoneDevice || audio?.routing?.meetingMicrophone?.name || "",
    speakerDevice: speakerDevice || audio?.routing?.meetingSpeaker?.name || "",
  };
  if (!resolved.microphoneDevice || !resolved.speakerDevice) {
    throw new MeetronError(
      "AUDIO_DEVICE_UNAVAILABLE",
      "Meetron meeting audio devices are not available",
    );
  }
  return resolved;
}

export function exactDevicePattern(name) {
  return new RegExp(String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}
