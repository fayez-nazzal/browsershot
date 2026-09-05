import { expect, test } from "bun:test";
import { preparePage, type CaptureOptions } from "../src/capture.ts";

const BASE_OPTIONS: CaptureOptions = {
  url: "https://example.com/missing",
  fullPage: false,
  delayMs: 0,
  allowBlank: true,
};

function fakePage(status: number, events: string[] = []) {
  const page = {
    goto: async () => { events.push("goto"); return { status: () => status, url: () => "https://example.com/missing" }; },
    waitForTimeout: async () => { events.push("delay"); },
    evaluate: async () => {
      events.push("text");
      return "the page body text";
    },
    locator: (selector: string) => {
      events.push(`element:${selector}`);
      return {
        first: () => { events.push("first"); return { waitFor: async (options: unknown) => { events.push(`visible:${(options as { timeout: number }).timeout}`); } }; },
      };
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

test("element readiness runs before text assertion", async () => {
  const events: string[] = [];
  const page = fakePage(200, events);
  await preparePage(page as never, { ...BASE_OPTIONS, expectElement: "#ready", expectText: "page" });
  expect(events).toEqual(["goto", "element:css=#ready", "first", "visible:10000", "text"]);
});

test("HTTP rejection happens before render and readiness work", async () => {
  const events: string[] = [];
  const page = fakePage(404, events);
  await expect(preparePage(page as never, { ...BASE_OPTIONS, expectElement: "#ready", expectText: "page" })).rejects.toThrow(/404/);
  expect(events).toEqual(["goto"]);
});

test("element readiness errors identify the selector", async () => {
  const page = fakePage(200);
  (page.locator as (selector: string) => unknown) = (selector: string) => ({ first: () => ({ waitFor: async () => { throw new Error("timeout"); } }) });
  await expect(preparePage(page as never, { ...BASE_OPTIONS, expectElement: "#missing" })).rejects.toThrow(/--expect-element "#missing" failed: timeout/);
});
