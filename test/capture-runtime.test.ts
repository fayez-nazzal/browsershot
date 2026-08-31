import { expect, test } from "bun:test";
import type { Browser, LaunchOptions } from "playwright";
import { capture, type CaptureOptions } from "../src/capture.ts";

const BASE_OPTIONS: CaptureOptions = {
  url: "https://example.test/",
  width: 800,
  height: 600,
  fullPage: false,
  headless: true,
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

test("headless capture runs on the injected launcher", async () => {
  const { launchBrowser, calls } = scriptedLauncher(fakeBrowser(fakePage()), []);
  const result = await capture(BASE_OPTIONS, { launchBrowser });
  expect(calls.length).toBe(1);
  expect(result.png.length).toBe(4);
});

test("headed capture launches chrome first", async () => {
  const options = { ...BASE_OPTIONS, headless: false };
  const { launchBrowser, calls } = scriptedLauncher(fakeBrowser(fakePage()), []);
  await capture(options, { launchBrowser });
  expect(calls[0]).toEqual({ headless: false, channel: "chrome" });
});

test("capture forwards launch progress to the log", async () => {
  const messages: string[] = [];
  const options = { ...BASE_OPTIONS, log: (message: string) => { messages.push(message); } };
  const { launchBrowser } = scriptedLauncher(fakeBrowser(fakePage()), []);
  await capture(options, { launchBrowser });
  expect(messages.length).toBeGreaterThan(0);
});

test("headless capture prefers the chromium headless shell", async () => {
  const { launchBrowser, calls } = scriptedLauncher(fakeBrowser(fakePage()), []);
  await capture(BASE_OPTIONS, { launchBrowser });
  expect(calls).toEqual([{ headless: true }]);
});

test("a failed headless shell launch retries full chrome once", async () => {
  const errors = [new Error("Executable doesn't exist at /fake/headless-shell")];
  const { launchBrowser, calls } = scriptedLauncher(fakeBrowser(fakePage()), errors);
  const result = await capture(BASE_OPTIONS, { launchBrowser });
  expect(calls).toEqual([{ headless: true }, { headless: true, channel: "chrome" }]);
  expect(result.png.length).toBe(4);
});

test("two failed launches preserve the final actionable error", async () => {
  const errors = [
    new Error("Executable doesn't exist at /fake/headless-shell"),
    new Error("Executable doesn't exist at /fake/chrome"),
  ];
  const { launchBrowser, calls } = scriptedLauncher(fakeBrowser(fakePage()), errors);
  let message = "";
  try {
    await capture(BASE_OPTIONS, { launchBrowser });
  } catch (e) {
    message = (e as Error).message;
  }
  expect(calls.length).toBe(2);
  expect(message).toContain("bun playwright install chromium");
  expect(message).toContain("/fake/chrome");
  expect(message).not.toContain("/fake/headless-shell");
});

test("headed capture falls back to bundled chromium once", async () => {
  const options = { ...BASE_OPTIONS, headless: false };
  const errors = [new Error("chrome is not installed")];
  const { launchBrowser, calls } = scriptedLauncher(fakeBrowser(fakePage()), errors);
  await capture(options, { launchBrowser });
  expect(calls).toEqual([{ headless: false, channel: "chrome" }, { headless: false }]);
});

test("page failures do not trigger a second capture", async () => {
  const page = fakePage(new Error("navigation blew up"));
  const { launchBrowser, calls } = scriptedLauncher(fakeBrowser(page), []);
  let message = "";
  try {
    await capture(BASE_OPTIONS, { launchBrowser });
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message).toBe("navigation blew up");
  expect(calls.length).toBe(1);
});

test("launch logs report the selected runtime", async () => {
  const messages: string[] = [];
  const options = { ...BASE_OPTIONS, log: (message: string) => { messages.push(message); } };
  const { launchBrowser } = scriptedLauncher(fakeBrowser(fakePage()), []);
  await capture(options, { launchBrowser });
  expect(messages).toContain("launching chromium headless shell");
  expect(messages).toContain("runtime chromium-headless-shell");
});

test("fallback logs report the full chrome runtime", async () => {
  const messages: string[] = [];
  const options = { ...BASE_OPTIONS, log: (message: string) => { messages.push(message); } };
  const errors = [new Error("Executable doesn't exist at /fake/headless-shell")];
  const { launchBrowser } = scriptedLauncher(fakeBrowser(fakePage()), errors);
  await capture(options, { launchBrowser });
  expect(messages).toContain("chromium headless shell unavailable, launching full chrome");
  expect(messages).toContain("runtime chrome");
});

test("headed logs report the chrome runtime", async () => {
  const messages: string[] = [];
  const options = { ...BASE_OPTIONS, headless: false, log: (message: string) => { messages.push(message); } };
  const { launchBrowser } = scriptedLauncher(fakeBrowser(fakePage()), []);
  await capture(options, { launchBrowser });
  expect(messages).toContain("runtime chrome");
});
