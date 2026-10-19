import { readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, chromium } from "playwright";
import { improveLaunchError, NAVIGATION_TIMEOUT_MS } from "./capture.ts";
import { writeOpenState } from "./open-state.ts";
import { UsageError } from "./exit-codes.ts";

export type LaunchPersistentContext = typeof chromium.launchPersistentContext;

export interface OpenWindowOptions {
  url: string | null;
  directory: string;
  viewport: { width: number; height: number };
  authJarPath: string | null;
  statePath: string;
  log: (message: string) => void;
}

// Playwright does not reliably emit a page "close" event when the user closes the
// last window, so the window state is read from context.pages() on an interval.
const WINDOW_CHECK_INTERVAL_MS = 250;

// Chromium marks a profile in use with a SingletonLock symlink named "<host>-<pid>".
// The lock belongs to a live browser only if that pid still exists; a dead pid is a
// stale lock that Chromium clears on the next launch.
function profileOpenElsewhere(directory: string): boolean {
  let target: string;
  try {
    target = readlinkSync(join(directory, "SingletonLock"));
  } catch {
    return false;
  }
  const pid = Number(target.slice(target.lastIndexOf("-") + 1));
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// The authstate jar is a Playwright storageState file. launchPersistentContext
// cannot take storageState, so its cookies and localStorage are applied to the
// persistent context before the first navigation, the same state a capture gets.
interface AuthOrigin {
  origin: string;
  localStorage?: { name: string; value: string }[];
}

interface AuthJar {
  cookies?: Parameters<BrowserContext["addCookies"]>[0];
  origins?: AuthOrigin[];
}

async function applyAuthJar(context: BrowserContext, path: string): Promise<void> {
  const jar = JSON.parse(readFileSync(path, "utf8")) as AuthJar;
  const cookies = jar.cookies ?? [];
  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }
  const origins = jar.origins ?? [];
  if (origins.length > 0) {
    await context.addInitScript((entries: AuthOrigin[]) => {
      const entry = entries.find((item) => item.origin === location.origin);
      for (const item of entry?.localStorage ?? []) {
        localStorage.setItem(item.name, item.value);
      }
    }, origins);
  }
}

// Opens a headed browser on a persistent profile. Cookies, sign-ins and
// localStorage are written to the profile as the window runs. The command returns
// once the user closes the window or presses Ctrl-C, and both paths close the
// context so the profile is flushed before exit.
export async function runOpenWindow(o: OpenWindowOptions, launch: LaunchPersistentContext): Promise<void> {
  if (profileOpenElsewhere(o.directory)) {
    throw new UsageError("the browser profile is open in another window; close that window and retry");
  }
  o.log(`opening ${o.url ?? "a blank page"} in a headed browser; close the window or press Ctrl-C to finish`);
  const sigintBeforeLaunch = new Set(process.listeners("SIGINT"));
  let context: BrowserContext;
  try {
    context = await launch(o.directory, { headless: false, viewport: o.viewport });
  } catch (error) {
    throw improveLaunchError(error as Error);
  }
  // Playwright's launcher installs a SIGINT handler that runs its own cleanup and
  // then calls process.exit(130). That exit can cut the profile flush short and
  // leave SingletonLock behind. Remove the listeners it added so Ctrl-C reaches
  // onInterrupt and the process exits 0 after the context closes.
  for (const listener of process.listeners("SIGINT")) {
    if (!sigintBeforeLaunch.has(listener)) {
      process.removeListener("SIGINT", listener);
    }
  }
  const interrupted = Promise.withResolvers<void>();
  const windowClosed = Promise.withResolvers<void>();
  const onInterrupt = () => interrupted.resolve();
  process.once("SIGINT", onInterrupt);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    if (o.authJarPath !== null) {
      await applyAuthJar(context, o.authJarPath);
    }
    const check = setInterval(() => {
      if (context.pages().length === 0) {
        windowClosed.resolve();
      }
    }, WINDOW_CHECK_INTERVAL_MS);
    try {
      if (o.url !== null) {
        await page.goto(o.url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
      }
      await Promise.race([windowClosed.promise, interrupted.promise]);
    } finally {
      clearInterval(check);
    }
  } finally {
    process.off("SIGINT", onInterrupt);
    await saveOpenState(context, o);
    await context.close();
  }
 }

// Captures cannot read the live profile (Chromium locks it, and captures must stay
// isolated and parallel-safe), so the profile's cookies and localStorage are
// snapshotted for them. A failed snapshot is reported, never fatal: the profile
// itself is still flushed by the close that follows.
async function saveOpenState(context: BrowserContext, o: OpenWindowOptions): Promise<void> {
  try {
    writeOpenState(o.statePath, await context.storageState());
  } catch (error) {
    o.log(`could not save the browser state for captures: ${(error as Error).message}`);
  }
}
