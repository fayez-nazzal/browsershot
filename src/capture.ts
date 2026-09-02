import { chromium } from "playwright";
import type { Browser, BrowserContext, LaunchOptions, Page } from "playwright";
import { runActions, type Action } from "./act.ts";
import { inspectElement, type ElementRecord, type InspectOptions } from "./inspect.ts";
import { assertLanding } from "./landing.ts";

export interface CaptureOptions {
  url: string;
  viewport?: { width: number; height: number };
  fullPage: boolean;
  delayMs: number;
  cookiesPath?: string;
  allowBlank: boolean;
  inspect?: InspectOptions;
  inspectFooter?: string;
  actions?: Action[];
  allowStatus?: boolean;
  expectText?: string;
  log?: (message: string) => void;
  verbose?: boolean;
}

export interface CaptureResult {
  png: Uint8Array;
  inspected: ElementRecord | null;
}

export const VIEWPORT_WIDTH = 1440;
export const VIEWPORT_HEIGHT = 900;
const DEVICE_SCALE_FACTOR = 2;
export const NAVIGATION_TIMEOUT_MS = 30000;

export interface RenderStats {
  textLength: number;
  elementCount: number;
}

const BLANK_TEXT_THRESHOLD = 20;
const BLANK_ELEMENT_THRESHOLD = 15;
const RENDER_POLL_INTERVAL_MS = 250;
const RENDER_POLL_TIMEOUT_MS = 10000;

export function renderLooksBlank(stats: RenderStats): boolean {
  let result = false;
  if (stats.textLength < BLANK_TEXT_THRESHOLD && stats.elementCount < BLANK_ELEMENT_THRESHOLD) {
    result = true;
  }
  return result;
}

export type LaunchBrowser = (options: LaunchOptions) => Promise<Browser>;

export interface CaptureDeps {
  launchBrowser: LaunchBrowser;
}

const defaultCaptureDeps: CaptureDeps = {
  launchBrowser: (options) => chromium.launch(options),
};

interface Session {
  context: BrowserContext;
  browser: Browser;
}

function improveLaunchError(error: Error): Error {
  let result = error;
  if (/Executable doesn'?t exist|please run|install/i.test(error.message)) {
    result = new Error(`Chromium not found. Install it once with: bun playwright install chromium\n${error.message}`);
  }
  return result;
}

async function openSession(o: CaptureOptions, deps: CaptureDeps, extra: Record<string, unknown> = {}): Promise<Session> {
  o.log?.("launching chromium headless shell");
  let browser: Browser;
  try {
    browser = await deps.launchBrowser({ headless: true });
  } catch (e) {
    throw improveLaunchError(e as Error);
  }
  const viewport = o.viewport ?? { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };
  const contextOptions: Record<string, unknown> = { viewport, deviceScaleFactor: DEVICE_SCALE_FACTOR, ...extra };
  if (o.cookiesPath != null) {
    contextOptions.storageState = o.cookiesPath;
  }
  const context = await browser.newContext(contextOptions);
  const session: Session = { context, browser };
  return session;
}

async function closeSession(session: Session): Promise<void> {
  await session.context.close();
  await session.browser.close();
}

async function readBodyText(page: Page): Promise<string> {
  return page.evaluate(() => {
    let text = "";
    if (document.body) {
      text = document.body.innerText;
    }
    return text;
  });
}

async function readRenderStats(page: Page): Promise<RenderStats> {
  return page.evaluate(() => {
    const body = document.body;
    let textLength = 0;
    let elementCount = 0;
    if (body) {
      textLength = body.innerText.trim().length;
      elementCount = body.querySelectorAll("*").length;
    }
    return { textLength, elementCount };
  });
}

async function waitForRender(page: Page, o: CaptureOptions): Promise<void> {
  if (!o.allowBlank) {
    let stats = await readRenderStats(page);
    let waited = 0;
    while (renderLooksBlank(stats) && waited < RENDER_POLL_TIMEOUT_MS) {
      await page.waitForTimeout(RENDER_POLL_INTERVAL_MS);
      waited = waited + RENDER_POLL_INTERVAL_MS;
      stats = await readRenderStats(page);
    }
    if (renderLooksBlank(stats)) {
      throw new Error(
        `page still looks blank after ${RENDER_POLL_TIMEOUT_MS / 1000}s ` +
          `(~${stats.textLength} chars of text, ${stats.elementCount} elements). ` +
          `The app may not have rendered: check the URL, the authstate jar, ` +
          `or raise --delay. Pass --allow-blank to capture anyway.`,
      );
    }
  }
}

export async function preparePage(page: Page, o: CaptureOptions): Promise<void> {
  o.log?.(`navigating ${o.url} (wait: load, timeout ${NAVIGATION_TIMEOUT_MS / 1000}s)`);
  const started = Date.now();
  const response = await page.goto(o.url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
  o.log?.(`page loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  o.log?.("waiting for render…");
  await waitForRender(page, o);
  if (o.delayMs > 0) {
    await page.waitForTimeout(o.delayMs);
  }
  const httpStatus = response != null ? response.status() : null;
  const finalUrl = response != null ? response.url() : page.url();
  let bodyText = "";
  if (o.expectText != null) {
    bodyText = await readBodyText(page);
  }
  assertLanding(
    { httpStatus, finalUrl, bodyText },
    { allowStatus: Boolean(o.allowStatus), expectText: o.expectText },
  );
}

async function playActions(page: Page, o: CaptureOptions): Promise<void> {
  if (o.actions != null) {
    await runActions(page, o.actions, NAVIGATION_TIMEOUT_MS, o.verbose === true ? (message) => process.stderr.write(`browsershot: ${message}\n`) : undefined);
  }
}

export async function capture(o: CaptureOptions, deps: CaptureDeps = defaultCaptureDeps): Promise<CaptureResult> {
  const session = await openSession(o, deps);
  let png: Uint8Array;
  let inspected: ElementRecord | null = null;
  try {
    const page = await session.context.newPage();
    if (o.verbose === true) {
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          process.stderr.write(`browsershot: [console.error] ${msg.text()}\n`);
        }
      });
      page.on("requestfailed", (request) => {
        process.stderr.write(`browsershot: [request failed] ${request.url()} (${request.failure()?.errorText ?? "unknown"})\n`);
      });
    }
    await preparePage(page, o);
    await playActions(page, o);
    if (o.inspect != null) {
      inspected = await inspectElement(page, o.inspect, o.inspectFooter);
    }
    o.log?.("capturing…");
    png = await page.screenshot({ fullPage: o.fullPage });
  } finally {
    await closeSession(session);
  }
  return { png, inspected };
}
