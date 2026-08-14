import { expect, test } from "bun:test";
import { preparePage, type CaptureOptions } from "../src/capture.ts";

const BASE_OPTIONS: CaptureOptions = {
  url: "https://example.com/missing",
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

function fakePage(status: number) {
  let evaluateCalls = 0;
  const page = {
    goto: async () => ({ status: () => status, url: () => "https://example.com/missing" }),
    waitForTimeout: async () => {},
    evaluate: async () => {
      evaluateCalls = evaluateCalls + 1;
      if (evaluateCalls === 1) {
        return { textLength: 200, elementCount: 40 };
      }
      return "the page body text";
    },
  };
  return page;
}

test("preparePage rejects a 404 response instead of preparing to screenshot it", async () => {
  const page = fakePage(404);
  await expect(preparePage(page as never, BASE_OPTIONS)).rejects.toThrow(/404/);
});

test("preparePage accepts a 404 when --allow-status is set", async () => {
  const page = fakePage(404);
  const options: CaptureOptions = { ...BASE_OPTIONS, allowStatus: true };
  await expect(preparePage(page as never, options)).resolves.toBeUndefined();
});

test("preparePage passes a 200 response through unchanged", async () => {
  const page = fakePage(200);
  await expect(preparePage(page as never, BASE_OPTIONS)).resolves.toBeUndefined();
});
