import { chromium } from "playwright";
import type { Browser, BrowserContext, LaunchOptions, Page } from "playwright";
import { runActions, type Action, type HoverElementHandle } from "./act.ts";
import { renderHoverCursor } from "./hover-cursor.ts";
import { inspectElement, type ElementRecord, type InspectOptions } from "./inspect.ts";
import { assertLanding } from "./landing.ts";
import { createNetworkCollector, type NetworkAttempt, type NetworkCategory } from "./network-observability.ts";

export interface CaptureOptions {
  url: string;
  viewport?: { width: number; height: number };
  fullPage: boolean;
  element?: string;
  delayMs: number;
  cookiesPath?: string;
  authRedirect?: string;
  allowBlank: boolean;
  inspect?: InspectOptions;
  inspectFooter?: string;
  actions?: Action[];
  allowStatus?: boolean;
  expectText?: string;
  expectElement?: string;
  log?: (message: string) => void;
  verbose?: boolean;
  withErrors?: boolean;
  network?: readonly NetworkCategory[];
}

export interface ConsoleErrorRecord {
  kind: "console" | "pageerror";
  text: string;
  url?: string;
  line?: number;
  column?: number;
  message?: string;
  stack?: string;
  truncated?: boolean;
}

export interface CaptureResult {
  png: Uint8Array;
  inspected: ElementRecord | null;
  consoleErrors?: ConsoleErrorRecord[];
  network?: NetworkAttempt;
}

export class AuthenticationCaptureFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationCaptureFailure";
  }
}

export const VIEWPORT_WIDTH = 1440;
export const VIEWPORT_HEIGHT = 900;
const MAX_CONSOLE_ERROR_RECORDS = 1000;
const MAX_CONSOLE_ERROR_TEXT_LENGTH = 8192;

function limitedErrorText(value: string): { value: string; truncated: boolean } {
  if (value.length <= MAX_CONSOLE_ERROR_TEXT_LENGTH) return { value, truncated: false };
  return { value: `${value.slice(0, MAX_CONSOLE_ERROR_TEXT_LENGTH)}…`, truncated: true };
}
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
export const ELEMENT_READY_TIMEOUT_MS = 10000;

function authenticationFailure(httpStatus: number | null, finalUrl: string, requestedUrl: string, authRedirect?: string): AuthenticationCaptureFailure | null {
  if (httpStatus === 401 || httpStatus === 403) {
    return new AuthenticationCaptureFailure(`page requires authentication: HTTP ${httpStatus}`);
  }
  if (authRedirect != null && finalUrl !== requestedUrl && finalUrl.includes(authRedirect)) {
    return new AuthenticationCaptureFailure("page redirected to an authentication page");
  }
  return null;
}

export function isAuthenticationCaptureFailure(error: unknown): error is AuthenticationCaptureFailure {
  return error instanceof AuthenticationCaptureFailure;
}

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
  const httpStatus = response != null ? response.status() : null;
  const finalUrl = response != null ? response.url() : page.url();
  const authFailure = authenticationFailure(httpStatus, finalUrl, o.url, o.authRedirect);
  if (authFailure != null) {
    throw authFailure;
  }
  assertLanding({ httpStatus, finalUrl, bodyText: "" }, { allowStatus: Boolean(o.allowStatus) });
  o.log?.("waiting for render…");
  await waitForRender(page, o);
  if (o.delayMs > 0) {
    await page.waitForTimeout(o.delayMs);
  }
  if (o.expectElement !== undefined) {
    try {
      await page.locator(`css=${o.expectElement}`).first().waitFor({ state: "visible", timeout: ELEMENT_READY_TIMEOUT_MS });
    } catch (error) {
      throw new Error(`--expect-element ${JSON.stringify(o.expectElement)} failed: ${(error as Error).message}`);
    }
  }
  let bodyText = "";
  if (o.expectText != null) {
    bodyText = await readBodyText(page);
  }
  assertLanding(
    { httpStatus, finalUrl, bodyText },
    { allowStatus: Boolean(o.allowStatus), expectText: o.expectText },
  );
}

async function playActions(page: Page, o: CaptureOptions): Promise<HoverElementHandle | null> {
  if (o.actions != null) {
    return runActions(page, o.actions, NAVIGATION_TIMEOUT_MS, o.verbose === true ? (message) => process.stderr.write(`browsershot: ${message}\n`) : undefined);
  }
  return null;
}
async function captureScreenshot(page: Page, o: CaptureOptions): Promise<Uint8Array> {
  if (o.element === undefined) {
    return page.screenshot({ fullPage: o.fullPage });
  }
  try {
    const element = page.locator(`css=${o.element}:visible`).first();
    await element.waitFor({ state: "visible", timeout: ELEMENT_READY_TIMEOUT_MS });
    return element.screenshot();
  } catch (error) {
    throw new Error(`--element ${JSON.stringify(o.element)} failed: ${(error as Error).message}`);
  }
}

export async function capture(o: CaptureOptions, deps: CaptureDeps = defaultCaptureDeps): Promise<CaptureResult> {
  let network: NetworkAttempt | undefined;
  const session = await openSession(o, deps);
  let png: Uint8Array;
  let inspected: ElementRecord | null = null;
  const consoleErrors: ConsoleErrorRecord[] = [];
  try {
    const page = await session.context.newPage();
    const collector = o.network == null || o.network.length === 0 ? undefined : createNetworkCollector(page, o.network);
    if (o.withErrors === true) {
      const recordError = (record: ConsoleErrorRecord): void => {
        if (consoleErrors.length >= MAX_CONSOLE_ERROR_RECORDS) {
          const last = consoleErrors[consoleErrors.length - 1];
          if (last != null) last.truncated = true;
          return;
        }
        consoleErrors.push(record);
      };
      page.on("console", (msg) => {
        if (msg.type() !== "error") return;
        const text = limitedErrorText(msg.text());
        const location = msg.location();
        const record: ConsoleErrorRecord = { kind: "console", text: text.value };
        if (text.truncated) record.truncated = true;
        if (location.url !== "") record.url = location.url;
        if (location.lineNumber >= 0) record.line = location.lineNumber;
        if (location.columnNumber >= 0) record.column = location.columnNumber;
        recordError(record);
      });
      page.on("pageerror", (error) => {
        const message = limitedErrorText(error.message);
        const record: ConsoleErrorRecord = { kind: "pageerror", text: message.value, message: message.value };
        if (message.truncated) record.truncated = true;
        if (error.stack !== undefined) {
          const stack = limitedErrorText(error.stack);
          record.stack = stack.value;
          if (stack.truncated) record.truncated = true;
        }
        recordError(record);
      });
    }
    if (o.verbose === true) {
      page.on("console", (msg) => {
        if (msg.type() === "error" && o.withErrors !== true) {
          process.stderr.write(`browsershot: [console.error] ${msg.text()}\n`);
        }
      });
      page.on("requestfailed", (request) => {
        process.stderr.write(`browsershot: [request failed] ${request.url()} (${request.failure()?.errorText ?? "unknown"})\n`);
      });
    }
    await preparePage(page, o);
    const hoverTarget = await playActions(page, o);
    if (o.inspect != null) {
      inspected = await inspectElement(page, o.inspect, o.inspectFooter);
    }
    if (hoverTarget != null) {
      await renderHoverCursor(page, hoverTarget, o.fullPage);
    }
    o.log?.("capturing…");
    collector?.markCaptureInitiated();
    png = await captureScreenshot(page, o);
    network = collector?.finish();
  } finally {
    await closeSession(session);
  }
  const result: CaptureResult = { png, inspected };
  if (o.withErrors === true) result.consoleErrors = consoleErrors;
  if (network != null) result.network = network;
  return result;
}
