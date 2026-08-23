import { MeetronError } from "../core/errors.mjs";
import { macosPlatformAdapter } from "./macos/macos-platform-adapter.mjs";

const adapters = new Map([[macosPlatformAdapter.id, macosPlatformAdapter]]);

export function getPlatformAdapter(platformId = process.platform) {
  const adapter = adapters.get(platformId);
  if (!adapter) {
    throw new MeetronError(
      "PLATFORM_UNSUPPORTED",
      `Meetron Community does not support platform: ${platformId}`,
      { supportedPlatforms: [...adapters.keys()] },
    );
  }
  return adapter;
}

export function supportedPlatforms() {
  return [...adapters.keys()];
}
