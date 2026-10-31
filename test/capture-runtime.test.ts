import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { Browser, LaunchOptions } from "playwright";
import { capture, type CaptureOptions } from "../src/capture.ts";

const BASE_OPTIONS: CaptureOptions = {
  url: "https://example.test/",
  fullPage: false,
  delayMs: 0,
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
function errorPage() {
  const handlers: Record<string, Array<(value: unknown) => void>> = {};
  const page = {
    ...fakePage(),
    on: (event: string, handler: (value: unknown) => void) => {
      (handlers[event] ??= []).push(handler);
      return page;
    },
    goto: async () => {
      for (const handler of handlers.console ?? []) {
        handler({
          type: () => "warning",
          text: () => "not collected",
          location: () => ({ url: "https://example.test/app.js", lineNumber: 1, columnNumber: 2 }),
        });
      }
      for (const handler of handlers.requestfailed ?? []) {
        handler({ url: () => "https://example.test/missing.js", failure: () => ({ errorText: "failed" }) });
      }
      for (const handler of handlers.pageerror ?? []) {
        handler(Object.assign(new Error("uncaught"), { stack: "Error: uncaught\n at app.js:3:4" }));
      }
      for (const handler of handlers.console ?? []) {
        handler({
          type: () => "error",
          text: () => "console broke",
          location: () => ({ url: "https://example.test/app.js", lineNumber: 7, columnNumber: 8 }),
        });
      }
      return { status: () => 200, url: () => BASE_OPTIONS.url };
    },
  };
  return page;
}

function elementPage(events: string[]) {
  const locator = {
    first: () => locator,
    waitFor: async () => { events.push("waitFor"); },
    screenshot: async () => { events.push("elementScreenshot"); return new Uint8Array([1, 2]); },
  };
  return {
    ...fakePage(),
    locator: (selector: string) => { events.push(`locator:${selector}`); return locator; },
    screenshot: async () => { events.push("pageScreenshot"); return new Uint8Array([3]); },
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
test("with-errors collects ordered console errors and page exceptions only", async () => {
  const { launchBrowser } = scriptedLauncher(fakeBrowser(errorPage()), []);
  const result = await capture({ ...BASE_OPTIONS, withErrors: true }, { launchBrowser });
  expect(result.consoleErrors).toEqual([
    { kind: "pageerror", text: "uncaught", message: "uncaught", stack: "Error: uncaught\n at app.js:3:4" },
    { kind: "console", text: "console broke", url: "https://example.test/app.js", line: 7, column: 8 },
  ]);
});

test("without with-errors omits collected error records", async () => {
  const { launchBrowser } = scriptedLauncher(fakeBrowser(errorPage()), []);
  const result = await capture(BASE_OPTIONS, { launchBrowser });
  expect(result.consoleErrors).toBeUndefined();
});

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

test("element capture screenshots the first visible matching element", async () => {
  const events: string[] = [];
  const { launchBrowser } = scriptedLauncher(fakeBrowser(elementPage(events)), []);
  const result = await capture({ ...BASE_OPTIONS, element: "#card" }, { launchBrowser });
  expect(result.artifact).toEqual({ kind: "png", png: new Uint8Array([1, 2]) });
  expect(events).toEqual(["locator:css=#card:visible", "waitFor", "elementScreenshot"]);
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

test("video recording waits after readiness, closes before reading, and uses the supplied temp directory", async () => {
  const events: string[] = [];
  const videoDir = mkdtempSync(join(tmpdir(), "browsershot-video-runtime-"));
  const videoPath = join(videoDir, "recording.webm");
  const videoBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]);
  writeFileSync(videoPath, videoBytes);
  const page = {
    ...fakePage(),
    video: () => ({
      path: async () => { events.push("video.path"); return videoPath; },
    }),
    waitForTimeout: async (ms: number) => { events.push(`wait:${ms}`); },
  };
  let contextOptions: Record<string, unknown> | undefined;
  const browser = {
    newContext: async (options: Record<string, unknown>) => {
      contextOptions = options;
      return {
        newPage: async () => page,
        close: async () => { events.push("context.close"); },
      };
    },
    close: async () => { events.push("browser.close"); },
  } as unknown as Browser;
  try {
    const { launchBrowser } = scriptedLauncher(browser, []);
    const result = await capture({
      ...BASE_OPTIONS,
      artifact: "webm",
      durationMs: 1200,
      videoDir,
    }, { launchBrowser });
    expect(result.artifact).toEqual({ kind: "webm", webm: videoBytes });
    expect(contextOptions?.recordVideo).toEqual({ dir: videoDir });
    expect(events).toEqual(["wait:1200", "context.close", "browser.close", "video.path"]);
  } finally {
    rmSync(videoDir, { recursive: true, force: true });
  }
});

test("video capture refuses an implicit recording directory before browser launch", async () => {
  const { launchBrowser, calls } = scriptedLauncher(fakeBrowser(fakePage()), []);
  await expect(capture({ ...BASE_OPTIONS, artifact: "webm", durationMs: 1 }, { launchBrowser }))
    .rejects.toThrow("temporary recording directory");
  expect(calls).toHaveLength(0);
});
