import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { runActions, type Action } from "./act.ts";
import { inspectElement, type ElementRecord, type InspectOptions } from "./inspect.ts";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";

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
  userDataDir?: string;
  htmlClass?: HtmlClassChange;
  allowBlank: boolean;
  inspect?: InspectOptions;
  inspectFooter?: string;
  actions?: Action[];
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

interface Session {
  context: BrowserContext;
  browser: Browser | null;
}

async function launch(headless: boolean): Promise<Browser> {
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless, channel: "chrome" });
  } catch {
    process.stderr.write("browsershot: warning: Google Chrome unavailable, falling back to bundled Chromium\n");
    try {
      browser = await chromium.launch({ headless });
    } catch (e) {
      const msg = (e as Error).message;
      let error = e as Error;
      if (/Executable doesn'?t exist|please run|install/i.test(msg)) {
        error = new Error(`Chromium not found. Install it once with: bun playwright install chromium\n${msg}`);
      }
      throw error;
    }
  }
  return browser;
}

async function launchPersistent(o: CaptureOptions, extra: Record<string, unknown>): Promise<BrowserContext> {
  const dir = o.userDataDir as string;
  mkdirSync(dir, { recursive: true });
  const base = {
    headless: o.headless,
    viewport: { width: o.width, height: o.height },
    deviceScaleFactor: o.scale,
    ...extra,
  };
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(dir, { channel: "chrome", ...base });
  } catch (e) {
    const detail = (e as Error).message;
    throw new Error(
      `could not launch Google Chrome with profile ${dir}: ${detail}\n` +
        `If another Chrome or Chromium process holds this profile, close it and retry. ` +
        `Sessions saved by a different browser channel do not carry over, so falling back ` +
        `to bundled Chromium is disabled for persistent profiles: it would silently lose the login.`,
    );
  }
  return context;
}

async function openSession(o: CaptureOptions, extra: Record<string, unknown> = {}): Promise<Session> {
  let session: Session;
  if (o.userDataDir != null) {
    const context = await launchPersistent(o, extra);
    session = { context, browser: null };
  } else {
    const browser = await launch(o.headless);
    const viewport = { width: o.width, height: o.height };
    const context = await browser.newContext({ viewport, deviceScaleFactor: o.scale, ...extra });
    session = { context, browser };
  }
  return session;
}

async function closeSession(session: Session): Promise<void> {
  await session.context.close();
  if (session.browser != null) {
    await session.browser.close();
  }
}

export async function login(o: CaptureOptions): Promise<void> {
  if (o.userDataDir == null) {
    throw new Error("--login requires --user-data-dir <dir>");
  }
  const context = await launchPersistent({ ...o, headless: false }, {});
  const page = await context.newPage();
  await page.goto(o.url, { waitUntil: o.waitUntil, timeout: o.timeoutMs });
  process.stderr.write("browsershot: log in in the opened window, then press Enter here to save the session...\n");
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => {
      resolve();
    });
  });
  await context.close();
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
          `The app may not have rendered: check the URL, the auth session in --user-data-dir, ` +
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

async function preparePage(page: Page, o: CaptureOptions): Promise<void> {
  await page.goto(o.url, { waitUntil: o.waitUntil, timeout: o.timeoutMs });
  await waitForRender(page, o);
  await applyHtmlClass(page, o);
  if (o.delayMs > 0) {
    await page.waitForTimeout(o.delayMs);
  }
}

async function playActions(page: Page, o: CaptureOptions): Promise<void> {
  if (o.actions != null) {
    await runActions(page, o.actions, o.timeoutMs);
  }
}

export async function capture(o: CaptureOptions): Promise<CaptureResult> {
  const session = await openSession(o);
  let png: Uint8Array;
  let inspected: ElementRecord | null = null;
  try {
    const page = await session.context.newPage();
    await preparePage(page, o);
    await playActions(page, o);
    if (o.inspect != null) {
      inspected = await inspectElement(page, o.inspect, o.inspectFooter);
    }
    png = await page.screenshot({ fullPage: o.fullPage });
  } finally {
    await closeSession(session);
  }
  return { png, inspected };
}

export async function captureGif(o: CaptureOptions, durationMs: number, gifPath: string): Promise<void> {
  const videoDir = mkdtempSync(join(tmpdir(), "browsershot-video-"));
  const size = { width: o.width, height: o.height };
  const session = await openSession(o, { recordVideo: { dir: videoDir, size } });
  let videoPath = "";
  try {
    const page = await session.context.newPage();
    await preparePage(page, o);
    await playActions(page, o);
    await page.waitForTimeout(durationMs);
    const video = page.video();
    await closeSession(session);
    if (video != null) {
      videoPath = await video.path();
    }
  } finally {
    // context and browser closed inside the try above
  }
  try {
    if (videoPath === "") {
      throw new Error("video recording produced no file");
    }
    convertVideoToGif(videoPath, gifPath);
  } finally {
    rmSync(videoDir, { recursive: true, force: true });
  }
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

function convertVideoToGif(videoPath: string, gifPath: string): void {
  const framesDir = mkdtempSync(join(tmpdir(), "browsershot-frames-"));
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
