import { MeetronError } from "../core/errors.mjs";
import { assertProviderDefinition } from "./provider-contract.mjs";

export function createProviderPreparationPlan(
  provider,
  meeting,
  {
    cdp,
    participantName,
    microphoneDevice = "",
    speakerDevice = "",
    requestJoin = false,
    joinDelay = 2,
  } = {},
) {
  assertProviderDefinition(provider);
  if (meeting?.providerId !== provider.id || typeof meeting.url !== "string") {
    throw new MeetronError(
      "INVALID_MEETING",
      `A normalized ${provider.label} meeting is required`,
    );
  }
  if (!Number.isFinite(joinDelay) || joinDelay < 0) {
    throw new MeetronError("INVALID_ARGUMENT", "joinDelay must be a non-negative number");
  }

  const automation = provider.automation;
  const initialUrl = automation.initialPage === "blank" ? "about:blank" : meeting.displayUrl;
  const args = ["--cdp", cdp, "--name", participantName];
  if (automation.urlTransport === "stdin") args.push("--url-stdin");
  else args.push("--url", meeting.url);
  if (microphoneDevice) args.push("--microphone-device", microphoneDevice);
  if (speakerDevice) args.push("--speaker-device", speakerDevice);
  if (requestJoin) {
    args.push("--join");
    if (automation.supportsJoinDelay) args.push("--join-delay", String(joinDelay));
  }

  return Object.freeze({
    providerId: provider.id,
    providerLabel: provider.label,
    initialUrl,
    preparationScript: automation.preparationScript,
    urlTransport: automation.urlTransport,
    stdin: automation.urlTransport === "stdin" ? meeting.url : "",
    args: Object.freeze(args),
    requestJoin,
  });
}
