import { MeetronError } from "../core/errors.mjs";
import {
  googleMeetDefinition,
  googleMeetRuntimeProvider,
} from "./google-meet/google-meet-provider.mjs";
import {
  zoomWebDefinition,
  zoomWebRuntimeProvider,
} from "./zoom-web/zoom-web-provider.mjs";

const providers = Object.freeze([googleMeetDefinition, zoomWebDefinition]);
const runtimeProviders = new Map([
  [googleMeetRuntimeProvider.id, googleMeetRuntimeProvider],
  [zoomWebRuntimeProvider.id, zoomWebRuntimeProvider],
]);

export function normalizeMeeting(value) {
  const provider = providers.find((candidate) => candidate.matchUrl(value));
  if (!provider) {
    throw new MeetronError(
      "UNSUPPORTED_MEETING_URL",
      "Google MeetまたはZoomの有効な会議URLを入力してください",
    );
  }
  return provider.normalizeUrl(value);
}

export function supportedMeetingProviders() {
  return providers.map(({ id }) => id);
}

export function getMeetingProvider(providerId) {
  const provider = runtimeProviders.get(providerId);
  if (!provider) {
    throw new MeetronError("PROVIDER_UNAVAILABLE", `Unsupported meeting provider: ${providerId}`);
  }
  return provider;
}
