import { expect, test } from "bun:test";
import type { Browser, LaunchOptions } from "playwright";
import { capture, type CaptureOptions } from "../src/capture.ts";

const BASE_OPTIONS: CaptureOptions = {
  url: "https://example.test/",
  width: 800,
  height: 600,
  fullPage: false,
  scale: 1,
  waitUntil: "load",
  delayMs: 0,
  timeoutMs: 1000,
  allowBlank: true,
};

function fakePage(gotoError?: Error) {
  return {
    goto: async () => {
      if (gotoError != null) {
        throw gotoError;
      }
      return { status: () => 200, url: () => BASE_OPTIONS.url };
    },
    evaluate: async () => ({ textLength: 500, elementCount: 300 }),
    waitForTimeout: async () => {},
    screenshot: async () => new Uint8Array([137, 80, 78, 71]),
  };
}

function fakeBrowser(page: unknown): Browser {
  return {
    newContext: async () => ({
      newPage: async () => page,
      close: async () => {},
    }),
    close: async () => {},
  } as unknown as Browser;
}

function scriptedLauncher(browser: Browser, errors: Error[]) {
  const calls: LaunchOptions[] = [];
  const launchBrowser = async (options: LaunchOptions) => {
    calls.push(options);
    const error = errors[calls.length - 1];
    if (error != null) {
      throw error;
    }
    return browser;
  };
  return { launchBrowser, calls };
}

test("capture launches the chromium headless shell once", async () => {
  const { launchBrowser, calls } = scriptedLauncher(fakeBrowser(fakePage()), []);
  const result = await capture(BASE_OPTIONS, { launchBrowser });
  expect(calls).toEqual([{ headless: true }]);
  expect(result.png.length).toBe(4);
});

test("capture forwards launch progress to the log", async () => {
  const messages: string[] = [];
  const options = { ...BASE_OPTIONS, log: (message: string) => { messages.push(message); } };
  const { launchBrowser } = scriptedLauncher(fakeBrowser(fakePage()), []);
  await capture(options, { launchBrowser });
  expect(messages).toContain("launching chromium headless shell");
});

test("a failed launch surfaces the install hint", async () => {
  const errors = [new Error("Executable doesn't exist at /fake/headless-shell")];
  const { launchBrowser, calls } = scriptedLauncher(fakeBrowser(fakePage()), errors);
  let message = "";
  try {
    await capture(BASE_OPTIONS, { launchBrowser });
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message).toContain("bun playwright install chromium");
  expect(message).toContain("/fake/headless-shell");
  expect(calls.length).toBe(1);
});

test("page failures do not trigger a second capture", async () => {
  const { launchBrowser, calls } = scriptedLauncher(fakeBrowser(fakePage(new Error("navigation blew up"))), []);
  let message = "";
  try {
    await capture(BASE_OPTIONS, { launchBrowser });
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message).toBe("navigation blew up");
  expect(calls.length).toBe(1);
});
