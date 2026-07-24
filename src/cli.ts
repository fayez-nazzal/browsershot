#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { capture, captureGif, login, parseHtmlClassFlag, type HtmlClassChange, type WaitUntil } from "./capture.ts";
import { drawAnnotations, parseBoxFlag, parseMarkerFlag, type BoxAnnotation, type MarkerAnnotation } from "./annotate.ts";
import { publish, labelFromPath, DEFAULT_EMBED_WIDTH } from "./publish.ts";

export const VERSION = "0.4.0";

const WAIT_EVENTS = ["load", "domcontentloaded", "networkidle", "commit"] as const;

export const PRESETS: Record<string, { width: number; height: number }> = {};
PRESETS.desktop = { width: 1920, height: 1080 };
PRESETS.laptop = { width: 1440, height: 900 };
PRESETS.phone = { width: 390, height: 844 };

const HELP = `browsershot ${VERSION} — capture a web page to a PNG

USAGE
  browsershot <url> [options]

  Loads <url> in your installed Google Chrome (headless, Playwright channel
  "chrome") and saves a screenshot of the viewport. Falls back to bundled
  Chromium with a warning when Chrome is unavailable.

OPTIONS
  -o, --output <path>   Output PNG path (default: ~/browsershot/<timestamp>.png)
      --width <px>      Viewport width  (default: 1440)
      --height <px>     Viewport height (default: 900)
      --size <WxH>      Shorthand for both, e.g. 1920x1080 (overrides all sizing flags)
      --preset <name>   Viewport preset: desktop 1920x1080, laptop 1440x900, phone 390x844
      --full-page       Capture the whole scrollable page (default: viewport only)
      --headed          Run with a visible window (default: headless)
      --user-data-dir <dir>  Reuse a persistent Chrome profile (keeps login/cookies
                        across runs). Combine with --login once to sign in.
      --login           Open a visible window at <url>, wait for you to log in and
                        press Enter, then save the session to --user-data-dir
      --scale <n>       deviceScaleFactor for hi-dpi (default: 2, retina)
      --wait <event>    ${WAIT_EVENTS.join(" | ")} (default: load)
      --delay <ms>      Extra wait after load before capture (default: 0)
      --timeout <ms>    Navigation timeout (default: 30000)
      --html-class <list>  Add classes to <html> before capture; prefix a token
                        with - to remove it first (e.g. --html-class=-light,dark
                        forces a class-based dark theme; both the = form and the
                        space form work). Waits 600ms for the repaint.
      --allow-blank     Skip the blank-render guard. By default a page whose
                        body still has almost no text or elements after 10s of
                        polling fails the capture instead of writing a blank
                        PNG (SPAs render well after their load event). Every
                        written file also gets a "sha256 <hex>" stderr line so
                        batch captures can spot duplicate outputs without
                        opening the images.
      --gif <seconds>   Record the page for that long, write a .gif next to the normal output path
      --box <x,y,w,h[,color]>  Draw a rectangle outline on the PNG at those pixel
                        coordinates (top-left origin, post-scale); repeatable
      --marker <x,y[,color]>   Draw a point marker (filled dot) on the PNG at
                        that pixel coordinate; repeatable
      --annotate        Open the written file in CleanShot for annotation
      --copy            Put the written PNG on the macOS clipboard
      --stdout          Write PNG bytes to stdout instead of a file
      --publish <dest>  Upload the written file to an rclone remote dir (e.g.
                        gdrive:PR-Shots/<repo>/<branch>/), make it public, and
                        print a PR-ready line to stdout: a high-res inline
                        Drive image embed for a PNG, or the path + Drive
                        archive link + drag-in instruction for a --gif
      --publish-size <px>   Long-edge width for the PNG embed (default: ${DEFAULT_EMBED_WIDTH})
      --publish-label <text>  Alt text for the PNG embed (default: file name)
  -h, --help            Show this help
  -v, --version         Show version
`;

function parse() {
  return parseArgs({
    args: normalizeArgv(process.argv.slice(2)),
    options: {
      output: { type: "string", short: "o" },
      width: { type: "string" },
      height: { type: "string" },
      size: { type: "string" },
      preset: { type: "string" },
      "full-page": { type: "boolean", default: false },
      headed: { type: "boolean", default: false },
      "user-data-dir": { type: "string" },
      login: { type: "boolean", default: false },
      scale: { type: "string" },
      wait: { type: "string" },
      delay: { type: "string" },
      timeout: { type: "string" },
      "html-class": { type: "string" },
      "allow-blank": { type: "boolean", default: false },
      gif: { type: "string" },
      box: { type: "string", multiple: true, default: [] },
      marker: { type: "string", multiple: true, default: [] },
      annotate: { type: "boolean", default: false },
      copy: { type: "boolean", default: false },
      stdout: { type: "boolean", default: false },
      publish: { type: "string" },
      "publish-size": { type: "string" },
      "publish-label": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
  });
}

export function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function defaultOutput(): string {
  return join(homedir(), "browsershot", `${timestamp()}.png`);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeUrl(url: string): string {
  let result = `https://${url}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    result = url;
  }
  if (/^(about|data|blob|view-source|chrome|javascript):/i.test(url)) {
    result = url;
  }
  return result;
}

export function normalizeArgv(argv: string[]): string[] {
  const result: string[] = [];
  let index = 0;
  while (index < argv.length) {
    const token = argv[index]!;
    const next = argv[index + 1];
    const isHtmlClassFlag = "--html-class" === token;
    const nextIsDashValue = next != null && next.startsWith("-") && "--" !== next;
    if (isHtmlClassFlag && nextIsDashValue) {
      result.push(`--html-class=${next}`);
      index = index + 2;
    } else {
      result.push(token);
      index = index + 1;
    }
  }
  return result;
}

export function parseSize(s: string): { width: number; height: number } | null {
  const m = /^(\d+)x(\d+)$/i.exec(s.trim());
  let result: { width: number; height: number } | null = null;
  if (m) {
    result = { width: Number(m[1]), height: Number(m[2]) };
  }
  return result;
}

export function gifOutputPath(pngPath: string): string {
  let result = `${pngPath}.gif`;
  if (pngPath.toLowerCase().endsWith(".png")) {
    result = `${pngPath.slice(0, -4)}.gif`;
  }
  return result;
}

export function cleanshotAnnotateUrl(filePath: string): string {
  return `cleanshot://open-annotate?filepath=${encodeURIComponent(filePath)}`;
}

export function clipboardScript(filePath: string): string {
  const escaped = filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `set the clipboard to (read (POSIX file "${escaped}") as «class PNGf»)`;
}

function openInCleanshot(filePath: string): void {
  const proc = Bun.spawnSync(["open", "-g", cleanshotAnnotateUrl(filePath)]);
  if (!proc.success) {
    const err = new TextDecoder().decode(proc.stderr).trim();
    const detail = err || `exit ${proc.exitCode}`;
    throw new Error(`could not open CleanShot annotate: ${detail}`);
  }
}

function copyPngToClipboard(filePath: string): void {
  const proc = Bun.spawnSync(["osascript", "-e", clipboardScript(filePath)]);
  if (!proc.success) {
    const err = new TextDecoder().decode(proc.stderr).trim();
    const detail = err || `exit ${proc.exitCode}`;
    throw new Error(`could not copy PNG to clipboard: ${detail}`);
  }
}

function intFlag(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return n;
}

function fail(msg: string): never {
  process.stderr.write(`browsershot: ${msg}\n`);
  process.exit(1);
}

async function main() {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse();
  } catch (e) {
    fail((e as Error).message);
  }
  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(HELP);
  } else if (values.version) {
    process.stdout.write(`${VERSION}\n`);
  } else {
    if (positionals.length === 0) {
      fail("missing <url> (try: browsershot --help)");
    }
    if (positionals.length > 1) {
      fail(`unexpected extra arguments: ${positionals.slice(1).join(" ")}`);
    }
    const url = normalizeUrl(positionals[0]!);

    if (values.stdout && (values.gif != null || values.annotate || values.copy)) {
      fail("--stdout cannot be combined with --gif, --annotate, or --copy");
    }
    if (values.publish != null && values.stdout) {
      fail("--publish needs a written file; it cannot be combined with --stdout");
    }

    let publishSize = DEFAULT_EMBED_WIDTH;
    try {
      if (values["publish-size"] != null) {
        publishSize = intFlag("publish-size", values["publish-size"]);
      }
    } catch (e) {
      fail((e as Error).message);
    }
    if (values.gif != null && (values.annotate || values.copy)) {
      fail("--annotate and --copy work with PNG output only, not --gif");
    }
    if (values.gif != null && (values.box.length > 0 || values.marker.length > 0)) {
      fail("--box and --marker work with PNG output only, not --gif");
    }

    const boxes: BoxAnnotation[] = [];
    const markers: MarkerAnnotation[] = [];
    try {
      for (const raw of values.box) {
        boxes.push(parseBoxFlag(raw));
      }
      for (const raw of values.marker) {
        markers.push(parseMarkerFlag(raw));
      }
    } catch (e) {
      fail((e as Error).message);
    }

    let width = 1440;
    let height = 900;
    if (values.preset != null) {
      const preset = PRESETS[values.preset];
      if (preset == null) {
        fail(`--preset must be one of: ${Object.keys(PRESETS).join(", ")}`);
      }
      width = preset.width;
      height = preset.height;
    }
    try {
      if (values.width != null) {
        width = intFlag("width", values.width);
      }
      if (values.height != null) {
        height = intFlag("height", values.height);
      }
    } catch (e) {
      fail((e as Error).message);
    }
    if (values.size != null) {
      const size = parseSize(values.size);
      if (size == null) {
        fail(`--size must look like WxH (e.g. 1920x1080), got "${values.size}"`);
      }
      width = size.width;
      height = size.height;
    }

    let scale = 2;
    if (values.scale != null) {
      scale = Number(values.scale);
      if (!(scale > 0)) {
        fail("--scale must be a positive number");
      }
    }

    let waitUntil: WaitUntil = "load";
    if (values.wait != null) {
      waitUntil = values.wait as WaitUntil;
    }
    if (!WAIT_EVENTS.includes(waitUntil)) {
      fail(`--wait must be one of: ${WAIT_EVENTS.join(", ")}`);
    }

    let delayMs = 0;
    let timeoutMs = 30000;
    try {
      if (values.delay != null) {
        delayMs = intFlag("delay", values.delay);
      }
      if (values.timeout != null) {
        timeoutMs = intFlag("timeout", values.timeout);
      }
    } catch (e) {
      fail((e as Error).message);
    }

    let htmlClass: HtmlClassChange | undefined;
    try {
      if (values["html-class"] != null) {
        htmlClass = parseHtmlClassFlag(values["html-class"]);
      }
    } catch (e) {
      fail((e as Error).message);
    }

    const fullPage = Boolean(values["full-page"]);
    const headless = !values.headed;
    const userDataDir = values["user-data-dir"];
    const allowBlank = Boolean(values["allow-blank"]);
    const options = { url, width, height, fullPage, headless, scale, waitUntil, delayMs, timeoutMs, userDataDir, htmlClass, allowBlank };

    let out = defaultOutput();
    if (values.output != null) {
      out = values.output;
    }

    if (values.login) {
      if (userDataDir == null) {
        fail("--login requires --user-data-dir <dir>");
      }
      try {
        await login(options);
      } catch (e) {
        fail((e as Error).message);
      }
      process.stderr.write(`browsershot: session saved to ${userDataDir}\n`);
    } else if (values.gif != null) {
      let gifSeconds = 0;
      try {
        gifSeconds = intFlag("gif", values.gif);
      } catch (e) {
        fail((e as Error).message);
      }
      const gifOut = gifOutputPath(out);
      mkdirSync(dirname(gifOut), { recursive: true });
      try {
        await captureGif(options, gifSeconds * 1000, gifOut);
      } catch (e) {
        fail((e as Error).message);
      }
      const bytes = statSync(gifOut).size;
      process.stderr.write(`browsershot: wrote ${gifOut} (${bytes} bytes)\n`);
      process.stderr.write(`browsershot: sha256 ${sha256Hex(readFileSync(gifOut))}\n`);
      if (values.publish != null) {
        let gifLabel = labelFromPath(gifOut);
        if (values["publish-label"] != null) {
          gifLabel = values["publish-label"];
        }
        try {
          const published = publish({ filePath: gifOut, dest: values.publish, isGif: true, size: publishSize, label: gifLabel });
          process.stdout.write(`${gifOut}\n`);
          process.stdout.write(`${published.markdown}\n`);
        } catch (e) {
          fail(`wrote ${gifOut}, but publish failed: ${(e as Error).message}`);
        }
      }
    } else {
      let png: Uint8Array = new Uint8Array();
      try {
        png = await capture(options);
      } catch (e) {
        fail((e as Error).message);
      }
      try {
        png = drawAnnotations(png, boxes, markers);
      } catch (e) {
        fail((e as Error).message);
      }
      if (values.stdout) {
        process.stdout.write(png);
      } else {
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, png);
        try {
          if (values.annotate) {
            openInCleanshot(out);
          }
          if (values.copy) {
            copyPngToClipboard(out);
          }
        } catch (e) {
          fail(`wrote ${out}, but ${(e as Error).message}`);
        }
        process.stderr.write(`browsershot: wrote ${out} (${png.length} bytes)\n`);
        process.stderr.write(`browsershot: sha256 ${sha256Hex(png)}\n`);
        if (values.publish != null) {
          let pngLabel = labelFromPath(out);
          if (values["publish-label"] != null) {
            pngLabel = values["publish-label"];
          }
          try {
            const published = publish({ filePath: out, dest: values.publish, isGif: false, size: publishSize, label: pngLabel });
            process.stdout.write(`${published.markdown}\n`);
          } catch (e) {
            fail(`wrote ${out}, but publish failed: ${(e as Error).message}`);
          }
        }
      }
    }
  }
}

if (import.meta.main) {
  await main();
}
