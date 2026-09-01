import { chromium } from "playwright";
import type { Browser, BrowserContext, LaunchOptions, Page } from "playwright";
import { runActions, type Action } from "./act.ts";
import { applyMocks, type Mock } from "./mock.ts";
import { inspectElement, type ElementRecord, type InspectOptions } from "./inspect.ts";
import { assertLanding } from "./landing.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { withScope } from "./session.ts";

export type WaitUntil = "load" | "domcontentloaded" | "networkidle" | "commit";

export interface CaptureOptions {
  url: string;
  width: number;
  height: number;
  fullPage: boolean;
  headless: boolean;
  scale: number;
  waitUntil: WaitUntil;
  delayMs: number;
  timeoutMs: number;
  cookiesPath?: string;
  htmlClass?: HtmlClassChange;
  allowBlank: boolean;
  inspect?: InspectOptions;
  inspectFooter?: string;
  actions?: Action[];
  mocks?: Mock[];
  allowStatus?: boolean;
  expectText?: string;
  log?: (message: string) => void;
  verbose?: boolean;
}

export interface CaptureResult {
  png: Uint8Array;
  inspected: ElementRecord | null;
}

export interface HtmlClassChange {
  add: string[];
  remove: string[];
}

export interface RenderStats {
  textLength: number;
  elementCount: number;
}

const BLANK_TEXT_THRESHOLD = 20;
const BLANK_ELEMENT_THRESHOLD = 15;
const RENDER_POLL_INTERVAL_MS = 250;
const RENDER_POLL_TIMEOUT_MS = 10000;
const HTML_CLASS_REPAINT_MS = 600;

export function renderLooksBlank(stats: RenderStats): boolean {
  let result = false;
  if (stats.textLength < BLANK_TEXT_THRESHOLD && stats.elementCount < BLANK_ELEMENT_THRESHOLD) {
    result = true;
  }
  return result;
}

export function parseHtmlClassFlag(raw: string): HtmlClassChange {
  const tokens = raw.split(/[\s,]+/).filter((token) => token.length > 0);
  const change: HtmlClassChange = { add: [], remove: [] };
  for (const token of tokens) {
    if (token.startsWith("-")) {
      change.remove.push(token.slice(1));
    } else {
      change.add.push(token);
    }
  }
  if (change.add.length === 0 && change.remove.length === 0) {
    throw new Error("--html-class needs at least one class name");
  }
  return change;
}

export type RuntimeName = "chromium-headless-shell" | "chrome" | "chromium";

export interface LaunchResult {
  browser: Browser;
  runtime: RuntimeName;
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
  browser: Browser | null;
  runtime: RuntimeName;
}

interface RuntimeAttempt {
  runtime: RuntimeName;
  options: LaunchOptions;
  note: string;
}

function attemptsFor(headless: boolean): RuntimeAttempt[] {
  let attempts: RuntimeAttempt[] = [
    { runtime: "chromium-headless-shell", options: { headless: true }, note: "launching chromium headless shell" },
    { runtime: "chrome", options: { headless: true, channel: "chrome" }, note: "chromium headless shell unavailable, launching full chrome" },
  ];
  if (!headless) {
    attempts = [
      { runtime: "chrome", options: { headless: false, channel: "chrome" }, note: "launching chrome (headed)" },
      { runtime: "chromium", options: { headless: false }, note: "chrome unavailable, launching bundled chromium (headed)" },
    ];
  }
  return attempts;
}

function improveLaunchError(error: Error): Error {
  let result = error;
  if (/Executable doesn'?t exist|please run|install/i.test(error.message)) {
    result = new Error(`Chromium not found. Install it once with: bun playwright install chromium\n${error.message}`);
  }
  return result;
}

async function selectRuntime(headless: boolean, log: ((message: string) => void) | undefined, launchBrowser: LaunchBrowser): Promise<LaunchResult> {
  const attempts = attemptsFor(headless);
  let selected: LaunchResult | null = null;
  let lastError = new Error("no browser runtime could be launched");
  let index = 0;
  while (selected == null && index < attempts.length) {
    const attempt = attempts[index]!;
    try {
      log?.(attempt.note);
      const browser = await launchBrowser(attempt.options);
      log?.(`runtime ${attempt.runtime}`);
      selected = { browser, runtime: attempt.runtime };
    } catch (e) {
      lastError = e as Error;
    }
    index = index + 1;
  }
  let result: LaunchResult;
  if (selected == null) {
    throw improveLaunchError(lastError);
  }
  result = selected;
  return result;
}

async function openSession(o: CaptureOptions, deps: CaptureDeps, extra: Record<string, unknown> = {}): Promise<Session> {
  const launchResult = await selectRuntime(o.headless, o.log, deps.launchBrowser);
  const browser = launchResult.browser;
  const viewport = { width: o.width, height: o.height };
  const contextOptions: Record<string, unknown> = { viewport, deviceScaleFactor: o.scale, ...extra };
  if (o.cookiesPath != null) {
    contextOptions.storageState = o.cookiesPath;
  }
  const context = await browser.newContext(contextOptions);
  const session: Session = { context, browser, runtime: launchResult.runtime };
  if (o.mocks != null) {
    await applyMocks(
      session.context,
      o.mocks,
      o.verbose === true ? (message) => process.stderr.write(`browsershot: ${message}\n`) : undefined,
    );
  }
  return session;
}

async function closeSession(session: Session): Promise<void> {
  await session.context.close();
  if (session.browser != null) {
    await session.browser.close();
  }
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
          `The app may not have rendered: check the URL, the jar passed to --cookies, ` +
          `or raise --delay / use --wait networkidle. Pass --allow-blank to capture anyway.`,
      );
    }
  }
}

async function applyHtmlClass(page: Page, o: CaptureOptions): Promise<void> {
  if (o.htmlClass != null) {
    await page.evaluate((change) => {
      for (const name of change.remove) {
        document.documentElement.classList.remove(name);
      }
      for (const name of change.add) {
        document.documentElement.classList.add(name);
      }
    }, o.htmlClass);
    await page.waitForTimeout(HTML_CLASS_REPAINT_MS);
  }
}

export async function preparePage(page: Page, o: CaptureOptions): Promise<void> {
  o.log?.(`navigating ${o.url} (wait: ${o.waitUntil}, timeout ${Math.round(o.timeoutMs / 1000)}s)`);
  const started = Date.now();
  const response = await page.goto(o.url, { waitUntil: o.waitUntil, timeout: o.timeoutMs });
  o.log?.(`page loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  o.log?.("waiting for render…");
  await waitForRender(page, o);
  await applyHtmlClass(page, o);
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
    await runActions(page, o.actions, o.timeoutMs, o.verbose === true ? (message) => process.stderr.write(`browsershot: ${message}\n`) : undefined);
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

export interface CaptureGifDeps {
  openSession: typeof openSession;
  closeSession: typeof closeSession;
  preparePage: typeof preparePage;
  playActions: typeof playActions;
  convert: (videoPath: string, gifPath: string, workDir: string) => void;
}

const defaultCaptureGifDeps: CaptureGifDeps = {
  openSession,
  closeSession,
  preparePage,
  playActions,
  convert: convertVideoToGif,
};

export async function captureGif(
  o: CaptureOptions,
  durationMs: number,
  gifPath: string,
  workDir: string,
  deps: CaptureGifDeps = defaultCaptureGifDeps,
): Promise<void> {
  const videoDir = join(workDir, "video");
  mkdirSync(videoDir, { recursive: true });
  const videoPath = await withScope(async (scope) => {
    const size = { width: o.width, height: o.height };
    const session = await deps.openSession(o, defaultCaptureDeps, { recordVideo: { dir: videoDir, size } });
    scope.use({ close: () => deps.closeSession(session) });
    const page = await session.context.newPage();
    await deps.preparePage(page, o);
    await deps.playActions(page, o);
    await page.waitForTimeout(durationMs);
    const video = page.video();
    if (video == null) {
      throw new Error("video recording produced no file");
    }
    return await video.path();
  });
  deps.convert(videoPath, gifPath, workDir);
}

const GIF_FPS = 12;

const ASSEMBLE_GIF_JXA = `
  ObjC.import('Cocoa');
  ObjC.import('ImageIO');
  ObjC.bindFunction('CGImageDestinationCreateWithURL', ['void*', ['id', 'id', 'unsigned long', 'id']]);
  ObjC.bindFunction('CGImageSourceCreateWithURL', ['void*', ['id', 'id']]);
  ObjC.bindFunction('CGImageSourceCreateImageAtIndex', ['void*', ['void*', 'unsigned long', 'id']]);
  ObjC.bindFunction('CGImageDestinationAddImage', ['void', ['void*', 'void*', 'id']]);
  ObjC.bindFunction('CGImageDestinationSetProperties', ['void', ['void*', 'id']]);
  ObjC.bindFunction('CGImageDestinationFinalize', ['bool', ['void*']]);
  function run(argv) {
    var gifPath = argv[0];
    var delay = parseFloat(argv[1]);
    var framesDir = argv[2];
    var fm = $.NSFileManager.defaultManager;
    var names = ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError(framesDir, null));
    var frames = names.filter(function (n) { return n.endsWith('.png'); }).sort();
    if (frames.length === 0) { throw new Error('no frames extracted'); }
    var url = $.NSURL.fileURLWithPath(gifPath);
    var dest = $.CGImageDestinationCreateWithURL(url, 'com.compuserve.gif', frames.length, null);
    $.CGImageDestinationSetProperties(dest, { '{GIF}': { LoopCount: 0 } });
    var frameProps = { '{GIF}': { DelayTime: delay } };
    for (var i = 0; i < frames.length; i++) {
      var srcUrl = $.NSURL.fileURLWithPath(framesDir + '/' + frames[i]);
      var src = $.CGImageSourceCreateWithURL(srcUrl, null);
      var img = $.CGImageSourceCreateImageAtIndex(src, 0, null);
      $.CGImageDestinationAddImage(dest, img, frameProps);
    }
    if (!$.CGImageDestinationFinalize(dest)) { throw new Error('gif finalize failed'); }
    return 'ok';
  }
`;

export function ffmpegPath(): string {
  const root = join(homedir(), "Library", "Caches", "ms-playwright");
  const entries = readdirSync(root);
  const ffmpegDirs = entries.filter((entry) => entry.startsWith("ffmpeg-")).sort();
  let result = "";
  if (ffmpegDirs.length > 0) {
    const newest = ffmpegDirs[ffmpegDirs.length - 1]!;
    const candidate = join(root, newest, "ffmpeg-mac");
    if (existsSync(candidate)) {
      result = candidate;
    }
  }
  if (result === "") {
    throw new Error("Playwright ffmpeg not found under ~/Library/Caches/ms-playwright");
  }
  return result;
}

function convertVideoToGif(videoPath: string, gifPath: string, workDir: string): void {
  const framesDir = join(workDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  try {
    extractFrames(videoPath, framesDir);
    assembleGif(framesDir, gifPath);
  } finally {
    rmSync(framesDir, { recursive: true, force: true });
  }
}

function extractFrames(videoPath: string, framesDir: string): void {
  const args = [ffmpegPath(), "-y", "-i", videoPath, "-r", String(GIF_FPS), join(framesDir, "%05d.png")];
  const proc = Bun.spawnSync(args);
  if (!proc.success) {
    const err = new TextDecoder().decode(proc.stderr).trim();
    const detail = err.slice(-400) || `exit ${proc.exitCode}`;
    throw new Error(`ffmpeg frame extraction failed: ${detail}`);
  }
}

function assembleGif(framesDir: string, gifPath: string): void {
  const delay = (1 / GIF_FPS).toFixed(3);
  const args = ["osascript", "-l", "JavaScript", "-e", ASSEMBLE_GIF_JXA, gifPath, delay, framesDir];
  const proc = Bun.spawnSync(args);
  if (!proc.success) {
    const err = new TextDecoder().decode(proc.stderr).trim();
    const detail = err || `exit ${proc.exitCode}`;
    throw new Error(`gif assembly failed: ${detail}`);
  }
}
