import { expect, test } from "bun:test";
import { captureGif, type CaptureGifDeps, type CaptureOptions } from "../src/capture.ts";

const BASE_OPTIONS: CaptureOptions = {
  url: "https://example.com",
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

const WORK_DIR = "/tmp/browsershot-gif-work";

function fakeDeps(failingStep: "preparePage" | "playActions" | "videoPath"): { deps: CaptureGifDeps; openCount: () => number } {
  let openCount = 0;
  const fakeBrowser = { close: async () => { openCount = openCount - 1; } };
  const fakeContext = { close: async () => {} };
  const fakeVideo = {
    path: async () => {
      if (failingStep === "videoPath") {
        throw new Error("video path blew up");
      }
      return "/tmp/does-not-matter.webm";
    },
  };
  const fakePage = {
    waitForTimeout: async () => {},
    video: () => fakeVideo,
  };
  const fakeSession = {
    context: { newPage: async () => fakePage, close: fakeContext.close },
    browser: fakeBrowser,
  };
  const deps: CaptureGifDeps = {
    openSession: async () => {
      openCount = openCount + 1;
      return fakeSession as never;
    },
    closeSession: async () => {
      await fakeSession.context.close();
      await fakeSession.browser.close();
    },
    preparePage: async () => {
      if (failingStep === "preparePage") {
        throw new Error("preparePage blew up");
      }
    },
    playActions: async () => {
      if (failingStep === "playActions") {
        throw new Error("playActions blew up");
      }
    },
    convert: () => {},
  };
  return { deps, openCount: () => openCount };
}

test("a rejecting preparePage still closes the opened browser", async () => {
  const { deps, openCount } = fakeDeps("preparePage");
  await expect(captureGif(BASE_OPTIONS, 100, "/tmp/out.gif", WORK_DIR, deps)).rejects.toThrow("preparePage blew up");
  expect(openCount()).toBe(0);
});

test("a rejecting playActions still closes the opened browser", async () => {
  const { deps, openCount } = fakeDeps("playActions");
  await expect(captureGif(BASE_OPTIONS, 100, "/tmp/out.gif", WORK_DIR, deps)).rejects.toThrow("playActions blew up");
  expect(openCount()).toBe(0);
});

test("a rejecting video.path still closes the opened browser", async () => {
  const { deps, openCount } = fakeDeps("videoPath");
  await expect(captureGif(BASE_OPTIONS, 100, "/tmp/out.gif", WORK_DIR, deps)).rejects.toThrow("video path blew up");
  expect(openCount()).toBe(0);
});

test("the video is converted after the session closes", async () => {
  const order: string[] = [];
  const fakeVideo = { path: async () => "/tmp/does-not-matter.webm" };
  const fakePage = { waitForTimeout: async () => {}, video: () => fakeVideo };
  const fakeSession = { context: { newPage: async () => fakePage, close: async () => {} }, browser: { close: async () => {} } };
  const deps: CaptureGifDeps = {
    openSession: async () => fakeSession as never,
    closeSession: async () => { order.push("closeSession"); },
    preparePage: async () => {},
    playActions: async () => {},
    convert: () => { order.push("convert"); },
  };
  await captureGif(BASE_OPTIONS, 10, "/tmp/out.gif", WORK_DIR, deps);
  expect(order).toEqual(["closeSession", "convert"]);
});
