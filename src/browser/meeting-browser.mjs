import { MeetronError } from "../core/errors.mjs";

export async function firstBrowserContext(browser) {
  const context = browser.contexts()[0];
  if (!context) {
    throw new MeetronError("BROWSER_CONTEXT_UNAVAILABLE", "Chrome did not expose a browser context");
  }
  return context;
}

export function allBrowserPages(browser) {
  return browser.contexts().flatMap((context) => context.pages());
}

export function safePageUrl(page) {
  try {
    const url = new URL(page.url());
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export async function locatorIsVisible(locator) {
  try {
    return (await locator.count()) > 0 && (await locator.first().isVisible());
  } catch {
    return false;
  }
}

export async function firstVisibleLocator(locators) {
  for (const locator of locators) {
    try {
      const count = await locator.count();
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible()) return candidate;
      }
    } catch {
      // Provider UIs replace controls frequently; try the next representation.
    }
  }
  return null;
}

export async function activateLocator(
  locator,
  { method = "auto", timeout = 2_000 } = {},
) {
  const candidate = locator.first();
  let clickError;

  if (method !== "dom") {
    try {
      await candidate.click({ force: method === "force", timeout });
      return method === "force" ? "force-click" : "click";
    } catch (error) {
      clickError = error;
    }
  }

  try {
    await candidate.evaluate((element) => {
      if (typeof element.click !== "function") {
        throw new Error("The selected control is not clickable");
      }
      element.click();
    });
    return "dom-click";
  } catch (error) {
    if (clickError) error.cause = clickError;
    throw error;
  }
}

export async function clickFirstVisible(locators, { force = false, timeout = 2_000 } = {}) {
  const candidate = await firstVisibleLocator(locators);
  if (!candidate) return false;
  await activateLocator(candidate, { method: force ? "force" : "auto", timeout });
  return true;
}

export async function waitForValue(
  readValue,
  expected,
  { timeout = 500, interval = 50 } = {},
) {
  const deadline = Date.now() + timeout;
  let detected = await readValue();
  while (detected !== expected && Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, interval));
    detected = await readValue();
  }
  return detected;
}

export async function closeOtherPages(pages, keep) {
  await Promise.all(
    pages
      .filter((candidate) => candidate !== keep)
      .map((candidate) => candidate.close({ runBeforeUnload: false }).catch(() => {})),
  );
}

export function pageMatchesHostname(page, predicate) {
  try {
    return predicate(new URL(page.url()).hostname);
  } catch {
    return false;
  }
}
