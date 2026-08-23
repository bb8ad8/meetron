#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { connectToChromeOverCDP } from "./playwright-cdp.mjs";
import {
  installZoomExternalAppLaunchGuard,
  isZoomHostname,
  mountZoomBrowserInvitation,
  zoomBrowserInvitationUrl,
} from "../src/providers/zoom-web/zoom-web-provider.mjs";

const args = process.argv.slice(2);
let cdp = "http://127.0.0.1:9223";
let targetUrl = "";
let urlStdin = false;

function usage() {
  process.stdout.write(`Usage: node scripts/open-chrome-page.mjs (--url URL | --url-stdin) [--cdp URL]\n`);
}

for (let index = 0; index < args.length; index += 1) {
  switch (args[index]) {
    case "--cdp":
      cdp = args[++index] || "";
      break;
    case "--url":
      targetUrl = args[++index] || "";
      break;
    case "--url-stdin":
      urlStdin = true;
      break;
    case "-h":
    case "--help":
      usage();
      process.exit(0);
      break;
    default:
      process.stderr.write(`Unknown argument: ${args[index]}\n`);
      usage();
      process.exit(2);
  }
}

if (urlStdin) targetUrl = readFileSync(0, "utf8").trim();

let parsedUrl;
let zoomInvitation = false;
try {
  parsedUrl = new URL(targetUrl);
} catch {
  process.stderr.write("A valid URL is required with --url.\n");
  process.exit(2);
}
if (!new Set(["https:", "chrome:"]).has(parsedUrl.protocol)) {
  process.stderr.write("Only HTTPS and Chrome internal URLs are supported.\n");
  process.exit(2);
}
if (parsedUrl.protocol === "https:" && isZoomHostname(parsedUrl.hostname)) {
  try {
    targetUrl = zoomBrowserInvitationUrl(targetUrl);
    parsedUrl = new URL(targetUrl);
    zoomInvitation = true;
  } catch {
    // Preserve the generic opener behavior for non-meeting Zoom pages.
  }
}

const browser = await connectToChromeOverCDP(cdp);
if (zoomInvitation) {
  const context = browser.contexts()[0];
  if (!context) throw new Error("Chrome profile was not available.");
  await installZoomExternalAppLaunchGuard(context);
  const page = [...context.pages()].reverse().find((candidate) => candidate.url() === "about:blank")
    || await context.newPage();
  await mountZoomBrowserInvitation(page, targetUrl);
  await page.bringToFront();
  const displayUrl = new URL(targetUrl);
  for (const key of ["pwd", "passcode", "password", "zak", "tk"]) displayUrl.searchParams.delete(key);
  process.stdout.write(`${JSON.stringify({ opened: true, url: displayUrl.href, targetId: null })}\n`);
  process.exit(0);
}
const session = await browser.newBrowserCDPSession();
let targetId;
try {
  ({ targetId } = await session.send("Target.createTarget", { url: targetUrl }));
} catch {
  throw new Error("Chrome could not open the requested page.");
}
await session.send("Target.activateTarget", { targetId });
await session.detach();
const displayUrl = new URL(targetUrl);
for (const key of ["pwd", "passcode", "password", "zak", "tk"]) displayUrl.searchParams.delete(key);
process.stdout.write(`${JSON.stringify({ opened: true, url: displayUrl.href, targetId })}\n`);
process.exit(0);
