#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { capture, captureGif, parseHtmlClassFlag, type HtmlClassChange, type WaitUntil } from "./capture.ts";
import { drawAnnotations, parseBoxFlag, parseMarkerFlag, type BoxAnnotation, type MarkerAnnotation } from "./annotate.ts";
import { publish, labelFromPath, DEFAULT_EMBED_WIDTH } from "./publish.ts";
import { buildEvidenceHtml, readEvidenceSpec } from "./evidence.ts";
import { parseActions, type Action } from "./act.ts";
import { parseMocks, type Mock } from "./mock.ts";
import type { InspectOptions } from "./inspect.ts";
import { buildCardHtml, buildSide, parsePair, DEFAULT_LABELS } from "./card.ts";
import { EXIT_FAILED, EXIT_USAGE, EXIT_WRITE_ERROR, publishFailure, type ExitCode } from "./exit-codes.ts";

export const VERSION = "1.0.0";

const WAIT_EVENTS = ["load", "domcontentloaded", "networkidle", "commit"] as const;

export const COMPARE_WIDTH = 2000;
export const COMPARE_HEIGHT = 1200;
export const EVIDENCE_WIDTH = 1100;

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
      --cookies <path>  Playwright storageState jar for an authenticated capture.
                        browsershot never logs in and never stores credentials.
                        Produce the jar with authstate, which owns every login:
                          jar=$(authstate ensure --credentials <yaml> --purpose <name>)
                          browsershot <url> --cookies "$jar"
                        A jar is a plain file, so any number of captures can read
                        the same one at once, and captures on different accounts
                        simply pass different jars.
      --scale <n>       deviceScaleFactor for hi-dpi (default: 2, retina)
      --wait <event>    ${WAIT_EVENTS.join(" | ")} (default: load)
      --delay <ms>      Extra wait after load before capture (default: 0)
      --timeout <ms>    Navigation timeout (default: 30000)
      --act <steps>     Drive the page before capturing, so states that only exist
                        after an interaction can be shot: an open menu, a focused
                        control, a selected row. Steps are separated by ; and each
                        is kind:value, where kind is focus, click, press, type or
                        wait (milliseconds). Selectors are CSS. Example:
                        --act 'focus:button[aria-label="More actions"];press:Enter'
                        Runs after the page has rendered and after --html-class,
                        and before --inspect, so --inspect :focus reports where the
                        keyboard actually landed. With --gif the steps are recorded.
      --mock <spec.json>  Intercept matching requests before the page sees them, so a
                        flow can be driven into a state the server will not serve
                        yet. The file holds a "mocks" array; every entry has a "url"
                        glob plus one of:
                          "redirect": send the browser somewhere else (302), which is
                            how you stand in for a server side redirect that is still
                            behind a flag
                          "merge": fetch the real response and deep merge this JSON
                            patch into it, e.g. flipping one feature flag on while
                            every other field stays real
                          "json": replace the body outright, with optional "status"
                        Matching is by URL glob and applies to navigations too. What
                        the page renders is then a simulation, so label any capture
                        built this way as simulated.
      --html-class <list>  Add classes to <html> before capture; prefix a token
                        with - to remove it first (e.g. --html-class=-light,dark
                        forces a class-based dark theme; both the = form and the
                        space form work). Waits 600ms for the repaint.
      --allow-status    Skip the response-status guard. By default a non-2xx/3xx
                        response fails the capture instead of writing a screenshot
                        of an error page.
      --expect-text <s> Fail the capture if the rendered page text does not
                        contain this string.
      --allow-blank     Skip the blank-render guard. By default a page whose
                        body still has almost no text or elements after 10s of
                        polling fails the capture instead of writing a blank
                        PNG (SPAs render well after their load event). Every
                        written file also gets a "sha256 <hex>" stderr line so
                        batch captures can spot duplicate outputs without
                        opening the images.
      --gif <seconds>   Record the page for that long, write a .gif next to the normal output path
      --inspect <selector>  Highlight the first match and draw a DevTools style panel
                        over the shot: its outerHTML on the left, its computed
                        role, name and ARIA state on the right. Long class and
                        style values are shortened so the markup stays readable.
      --inspect-attr <name>  Emphasise this attribute in the panel and report it
                        first in the JSON, e.g. --inspect-attr aria-expanded
      --inspect-json <path>  Write the recorded element data (role, name, every
                        attribute, outerHTML, box) as JSON. Defaults to the
                        output path with a .json extension. Read this instead of
                        the PNG to assert on state without opening an image.
      --inspect-note <text>  Extra line printed at the bottom of the panel
      --compare <before.png,after.png>  Build a two column before and after card
                        from two PNGs and capture it. Needs no <url>. When a
                        sidecar .json sits next to a PNG (as --inspect-json
                        writes), its role, name and state table is shown under
                        that side. Implies --full-page.
      --compare-labels <a,b>   Column labels (default: ${DEFAULT_LABELS.before},${DEFAULT_LABELS.after})
      --compare-title <text>   Card heading
      --compare-chips <a,b,..> Small pills under the heading, comma separated
      --evidence <spec.json>  Build a before and after page from DATA and capture it.
                        Needs no <url>. Use this when the evidence is text rather
                        than two screenshots: what went in, what came back before,
                        what came back after, each with a plain-English reading, so
                        a reviewer never has to read a terminal dump. Implies
                        --full-page. The file holds: title, optional step and lede,
                        an input block (heading, meta pairs, text, chips, hidden),
                        before and after blocks (label, note, output, badge, plain,
                        outcome) and an optional result line.
      --box <x,y,w,h[,color]>  Draw a rectangle outline on the PNG at those pixel
                        coordinates (top-left origin, post-scale); repeatable
      --marker <x,y[,color]>   Draw a point marker (filled dot) on the PNG at
                        that pixel coordinate; repeatable
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
      cookies: { type: "string" },
      scale: { type: "string" },
      wait: { type: "string" },
      delay: { type: "string" },
      timeout: { type: "string" },
      "html-class": { type: "string" },
      act: { type: "string" },
      mock: { type: "string" },
      "allow-blank": { type: "boolean", default: false },
      "allow-status": { type: "boolean", default: false },
      "expect-text": { type: "string" },
      gif: { type: "string" },
      inspect: { type: "string" },
      "inspect-attr": { type: "string" },
      "inspect-json": { type: "string" },
      "inspect-note": { type: "string" },
      compare: { type: "string" },
      evidence: { type: "string" },
      "compare-labels": { type: "string" },
      "compare-title": { type: "string" },
      "compare-chips": { type: "string" },
      box: { type: "string", multiple: true, default: [] },
      marker: { type: "string", multiple: true, default: [] },
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

export function inspectJsonPath(pngPath: string): string {
  let result = `${pngPath}.json`;
  if (pngPath.toLowerCase().endsWith(".png")) {
    result = `${pngPath.slice(0, -4)}.json`;
  }
  return result;
}

export function inspectSummary(record: { role: string; name: string; attributes: Record<string, string> }, attr?: string): string {
  let name = record.name;
  if (name === "") {
    name = "(empty)";
  }
  let summary = `role=${record.role} name="${name}"`;
  if (attr != null) {
    let value = record.attributes[attr];
    if (value === undefined) {
      value = "(not present)";
    }
    summary = `${summary} ${attr}=${value}`;
  }
  return summary;
}

function intFlag(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return n;
}

function fail(msg: string, code: ExitCode = EXIT_USAGE): never {
  process.stderr.write(`browsershot: ${msg}\n`);
  process.exit(code);
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
    const comparing = values.compare != null;
    const showingEvidence = values.evidence != null;
    const buildsItsOwnPage = comparing || showingEvidence;
    if (positionals.length === 0 && !buildsItsOwnPage) {
      fail("missing <url> (try: browsershot --help)");
    }
    if (positionals.length > 0 && buildsItsOwnPage) {
      fail("--compare and --evidence build their own page, so they take no <url>");
    }
    if (comparing && showingEvidence) {
      fail("--compare and --evidence are two ways to build the same page; pick one");
    }
    if (showingEvidence && (values.gif != null || values.inspect != null)) {
      fail("--evidence cannot be combined with --gif or --inspect");
    }
    if (positionals.length > 1) {
      fail(`unexpected extra arguments: ${positionals.slice(1).join(" ")}`);
    }
    if (comparing && (values.gif != null || values.inspect != null)) {
      fail("--compare cannot be combined with --gif or --inspect");
    }
    if (values.inspect != null && values.gif != null) {
      fail("--inspect works with PNG output only, not --gif");
    }

    let cardPath = "";
    if (comparing) {
      try {
        const pair = parsePair(values.compare as string, "compare");
        let labels = DEFAULT_LABELS;
        if (values["compare-labels"] != null) {
          labels = parsePair(values["compare-labels"], "compare-labels");
        }
        let title = "before and after";
        if (values["compare-title"] != null) {
          title = values["compare-title"];
        }
        let chips: string[] = [];
        if (values["compare-chips"] != null) {
          chips = values["compare-chips"].split(",").map((chip) => chip.trim()).filter((chip) => chip !== "");
        }
        const attr = values["inspect-attr"];
        const html = buildCardHtml({
          title,
          chips,
          before: buildSide(pair.before, labels.before, attr),
          after: buildSide(pair.after, labels.after, attr),
        });
        cardPath = join(mkdtempSync(join(tmpdir(), "browsershot-card-")), "card.html");
        writeFileSync(cardPath, html);
      } catch (e) {
        fail((e as Error).message);
      }
    }

    if (showingEvidence) {
      try {
        const html = buildEvidenceHtml(readEvidenceSpec(values.evidence as string));
        cardPath = join(mkdtempSync(join(tmpdir(), "browsershot-evidence-")), "evidence.html");
        writeFileSync(cardPath, html);
      } catch (e) {
        fail((e as Error).message);
      }
    }

    let url = "";
    if (buildsItsOwnPage) {
      url = `file://${cardPath}`;
    } else {
      url = normalizeUrl(positionals[0]!);
    }

    if (values.stdout && values.gif != null) {
      fail("--stdout cannot be combined with --gif");
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
    if (comparing) {
      width = COMPARE_WIDTH;
      height = COMPARE_HEIGHT;
    }
    if (showingEvidence) {
      width = EVIDENCE_WIDTH;
      height = COMPARE_HEIGHT;
    }
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

    let fullPage = Boolean(values["full-page"]);
    if (buildsItsOwnPage) {
      fullPage = true;
    }
    const headless = !values.headed;
    const cookiesPath = values.cookies;
    if (cookiesPath != null && !existsSync(cookiesPath)) {
      fail(`--cookies file not found: ${cookiesPath}`);
    }
    const allowBlank = Boolean(values["allow-blank"]);
    const allowStatus = Boolean(values["allow-status"]);
    const expectText = values["expect-text"];

    let inspect: InspectOptions | undefined;
    if (values.inspect != null) {
      if (values.inspect.trim() === "") {
        fail("--inspect needs a CSS selector");
      }
      inspect = { selector: values.inspect, attr: values["inspect-attr"], timeoutMs };
    }
    const inspectFooter = values["inspect-note"];

    let actions: Action[] | undefined;
    try {
      if (values.act != null) {
        actions = parseActions(values.act);
      }
    } catch (e) {
      fail((e as Error).message);
    }

    let mocks: Mock[] | undefined;
    try {
      if (values.mock != null) {
        mocks = parseMocks(readFileSync(values.mock, "utf8"));
      }
    } catch (e) {
      fail((e as Error).message);
    }

    const options = { url, width, height, fullPage, headless, scale, waitUntil, delayMs, timeoutMs, cookiesPath, htmlClass, allowBlank, inspect, inspectFooter, actions, mocks, allowStatus, expectText };

    let out = defaultOutput();
    if (values.output != null) {
      out = values.output;
    }

    if (values.gif != null) {
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
        fail((e as Error).message, EXIT_FAILED);
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
          const failure = publishFailure(gifOut, e as Error);
          fail(failure.message, failure.code);
        }
      }
    } else {
      let png: Uint8Array = new Uint8Array();
      let inspected = null;
      try {
        const result = await capture(options);
        png = result.png;
        inspected = result.inspected;
      } catch (e) {
        fail((e as Error).message, EXIT_FAILED);
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
        process.stderr.write(`browsershot: wrote ${out} (${png.length} bytes)\n`);
        process.stderr.write(`browsershot: sha256 ${sha256Hex(png)}\n`);
        if (inspected != null) {
          let jsonOut = inspectJsonPath(out);
          if (values["inspect-json"] != null) {
            jsonOut = values["inspect-json"];
          }
          try {
            mkdirSync(dirname(jsonOut), { recursive: true });
            writeFileSync(jsonOut, `${JSON.stringify(inspected, null, 2)}\n`);
          } catch (e) {
            fail(`wrote ${out}, but could not write ${jsonOut}: ${(e as Error).message}`, EXIT_WRITE_ERROR);
          }
          process.stderr.write(`browsershot: inspected ${inspectSummary(inspected, values["inspect-attr"])}\n`);
          process.stderr.write(`browsershot: element json ${jsonOut}\n`);
        }
        if (values.publish != null) {
          let pngLabel = labelFromPath(out);
          if (values["publish-label"] != null) {
            pngLabel = values["publish-label"];
          }
          try {
            const published = publish({ filePath: out, dest: values.publish, isGif: false, size: publishSize, label: pngLabel });
            process.stdout.write(`${published.markdown}\n`);
          } catch (e) {
            const failure = publishFailure(out, e as Error);
            fail(failure.message, failure.code);
          }
        }
      }
    }
  }
}

if (import.meta.main) {
  await main();
}
