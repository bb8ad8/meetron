import { readFileSync } from "node:fs";
import { MeetronError } from "./errors.mjs";

export function parsePreparationOptions(
  argv,
  {
    allowUrlStdin = false,
    defaultCdp = "http://127.0.0.1:9223",
    defaultJoinDelay = 2,
    defaultName = "GPT-Live",
  } = {},
) {
  const options = {
    cdp: defaultCdp,
    join: false,
    joinDelay: defaultJoinDelay,
    microphoneDevice: "",
    name: defaultName,
    speakerDevice: "",
    url: "",
    urlStdin: false,
    help: false,
  };
  const valueOptions = new Map([
    ["--cdp", "cdp"],
    ["--name", "name"],
    ["--microphone-device", "microphoneDevice"],
    ["--speaker-device", "speakerDevice"],
    ["--url", "url"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (valueOptions.has(argument)) {
      const value = argv[++index];
      if (!value) throw new MeetronError("INVALID_ARGUMENT", `${argument} requires a value`);
      options[valueOptions.get(argument)] = value;
      continue;
    }
    switch (argument) {
      case "--join": options.join = true; break;
      case "--join-delay": {
        const value = argv[++index];
        options.joinDelay = Number(value);
        break;
      }
      case "--url-stdin":
        if (!allowUrlStdin) throw new MeetronError("INVALID_ARGUMENT", "--url-stdin is unavailable");
        options.urlStdin = true;
        break;
      case "-h":
      case "--help": options.help = true; break;
      default: throw new MeetronError("INVALID_ARGUMENT", `Unknown argument: ${argument}`);
    }
  }

  if (!Number.isFinite(options.joinDelay) || options.joinDelay < 0) {
    throw new MeetronError("INVALID_ARGUMENT", "--join-delay must be a non-negative number");
  }
  if (options.urlStdin) options.url = readFileSync(0, "utf8").trim();
  return options;
}

export function preparationUsage({ providerLabel, scriptName, allowUrlStdin = false }) {
  return `Usage: node scripts/${scriptName} [options]\n\nOptions:\n  --cdp URL                Chrome DevTools endpoint (default: http://127.0.0.1:9223)\n  --name NAME              ${providerLabel} participant name (default: GPT-Live)\n  --url URL                Expected ${providerLabel} invitation URL\n${allowUrlStdin ? "  --url-stdin              Read the invitation URL from standard input\n" : ""}  --microphone-device NAME Override the selected virtual microphone\n  --speaker-device NAME    Override the selected virtual speaker\n  --join                   Prepare and request admission\n  --join-delay SEC         Wait before requesting admission (default: 2)\n  -h, --help               Show this help\n`;
}

export const PREPARATION_EXIT_CODES = Object.freeze({
  loginRequired: 13,
  rejected: 14,
  stateUnknown: 15,
  manualActionRequired: 16,
});
