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
