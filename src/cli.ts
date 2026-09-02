#!/usr/bin/env bun

import { parseArgs } from "node:util";
import packageJson from "../package.json";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { capture, NAVIGATION_TIMEOUT_MS, VIEWPORT_WIDTH, VIEWPORT_HEIGHT } from "./capture.ts";
import { drawAnnotations, parseBoxFlag, parseMarkerFlag, type BoxAnnotation, type MarkerAnnotation } from "./annotate.ts";
import { publish, labelFromPath, DEFAULT_EMBED_WIDTH } from "./publish.ts";
import { parseActions, type Action } from "./act.ts";
import type { InspectOptions } from "./inspect.ts";
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, EXIT_WRITE_ERROR, publishFailure, type ExitCode } from "./exit-codes.ts";
import { resolveAuthJar, AuthStateFailure, discoverAuthCredentials } from "./authstate.ts";
import { profilePaths, readProfile, resolveQuickUrl, setProfileValue, unsetProfileValue } from "./profile.ts";
import { openFile } from "./open.ts";
import { createRunTmpDir, ensureWorkspace, removeRunTmpDir } from "./workspace.ts";

export const VERSION = packageJson.version;

const HELP = `browsershot ${VERSION} — capture a web page to a PNG

USAGE
  browsershot <url-or-path> [options]
  browsershot config <set|unset|show|path> [name] [value]

  Loads the page headless in the bundled Chromium headless shell and saves a
  screenshot of the viewport. Hardcoded capture defaults: viewport 1440x900 at
  2x (retina), wait event load, navigation timeout 30s.

QUICK CAPTURE (the normal thing)
  -o, --output <path>       Output PNG path
                            (default: .browsershot/captures/<timestamp>.png)
      --size <WxH>          Viewport size, e.g. 1920x1080 (default: 1440x900)
      --delay <ms>          Extra wait after load before capture (default: 0)
      --full-page           Capture the whole scrollable page
      --auto-open           Open the written capture with the platform viewer
      --json                One JSON object on stdout with outputPath, bytes,
                            sha256, inspectJsonPath, inspected, publishedUrl.
                            Human readable lines stay on stderr. Without it the
                            absolute output path is the first stdout line.
      --auth                authstate one-step authenticated capture: discovers
                            .testing-credentials.yaml by walking up from the
                            working directory, runs "authstate ensure", and uses
                            the jar named by the JSON envelope's "path" field.
      --auth-user <name>    Credentials entry for --auth. Implies --auth.
      --auth-credentials <path>  Credentials file instead of discovery.
                            Implies the auth flow; combine with --auth-user.
      --publish [dest]      rclone upload plus public link embed (e.g.
                            gdrive:PR-Shots/<repo>/<branch>/). Without a value
                            the saved "publish" profile key is the destination:
                            browsershot config set publish <dest>
      --publish-size <px>   Long-edge width for the embed (default: ${DEFAULT_EMBED_WIDTH})
      --publish-label <text>  Alt text for the embed (default: file name)

PROVE IT
      --inspect <selector>       DevTools style panel over the shot: highlights
                        the first match and draws its outerHTML plus its
                        computed role, name and ARIA state over the capture.
      --inspect-attr <name>  Emphasise this attribute in the panel and report it
                        first in the JSON, e.g. --inspect-attr aria-expanded
      --inspect-json <path>  Write the recorded element data (role, name, every
                        attribute, outerHTML, box) as JSON. Defaults to the
                        output path with a .json extension. Read this instead of
                        the PNG to assert on state without opening an image.
      --inspect-note <text>  Extra line printed at the bottom of the panel
      --act <steps>     Drive the page before capturing, so states that only
                        exist after an interaction can be shot: an open menu, a
                        focused control, a selected row. Steps are separated by
                        ; and each is kind:value, where kind is focus, click,
                        press, type or wait (milliseconds). Selectors are CSS.
                        Example:
                        --act 'focus:button[aria-label="More actions"];press:Enter'
                        Runs after the page has rendered and before --inspect,
                        so --inspect :focus reports where the keyboard actually
                        landed.
      --box <x,y,w,h[,color]>  Draw a rectangle outline on the PNG at those pixel
                        coordinates (top-left origin, post-scale); repeatable
      --marker <x,y[,color]>   Draw a point marker (filled dot) on the PNG at
                        that pixel coordinate; repeatable
      --expect-text <s> Fail the capture if the rendered page text does not
                        contain this string.
      --allow-status    Skip the response-status guard. By default a non-2xx/3xx
                        response fails the capture instead of writing a screenshot
                        of an error page.
      --allow-blank     Skip the blank-render guard. By default a page whose
                        body still has almost no text or elements after 10s of
                        polling fails the capture instead of writing a blank
                        PNG (SPAs render well after their load event). Every
                        written file also gets a "sha256 <hex>" stderr line so
                        batch captures can spot duplicate outputs without
                        opening the images.

META
      --verbose         Playwright progress detail on stderr: phase timings,
                        failed requests, console errors, act step echo
  -h, --help            Show this help
  -v, --version         Show version
`;

function parse() {
  return parseArgs({
    args: normalizeArgv(process.argv.slice(2)),
    options: {
      output: { type: "string", short: "o" },
      size: { type: "string" },
      "full-page": { type: "boolean", default: false },
      auth: { type: "boolean", default: false },
      "auth-user": { type: "string" },
      "auth-credentials": { type: "string" },
      "auth-purpose": { type: "string" },
      verbose: { type: "boolean", default: false },
      delay: { type: "string" },
      act: { type: "string" },
      "allow-blank": { type: "boolean", default: false },
      "allow-status": { type: "boolean", default: false },
      "expect-text": { type: "string" },
      inspect: { type: "string" },
      "inspect-attr": { type: "string" },
      "inspect-json": { type: "string" },
      "inspect-note": { type: "string" },
      box: { type: "string", multiple: true, default: [] },
      marker: { type: "string", multiple: true, default: [] },
      json: { type: "boolean", default: false },
      publish: { type: "string" },
      "publish-size": { type: "string" },
      "publish-label": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
      "auto-open": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
}

export function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface SuccessSummary {
  outputPath: string | null;
  bytes: number | null;
  sha256: string | null;
  inspectJsonPath: string | null;
  inspected: unknown;
  publishedUrl: string | null;
}

export function emptySuccess(): SuccessSummary {
  return {
    outputPath: null,
    bytes: null,
    sha256: null,
    inspectJsonPath: null,
    inspected: null,
    publishedUrl: null,
  };
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
    const isPublishFlag = "--publish" === token;
    const nextIsValue = next != null && !next.startsWith("-") && "--" !== next;
    if (isPublishFlag && nextIsValue) {
      result.push(`--publish=${next}`);
      index = index + 2;
    } else if (isPublishFlag) {
      result.push("--publish=");
      index = index + 1;
    } else {
      result.push(token);
      index = index + 1;
    }
  }
  return result;
}

export function resolvePublishDest(explicit: string | null, saved: string | undefined): string | null {
  let result: string | null = null;
  if (explicit != null) {
    if (explicit === "") {
      if (saved == null || saved.trim() === "") {
        throw new Error("bare --publish needs a saved destination; run: browsershot config set publish <dest>");
      }
      result = saved;
    } else {
      result = explicit;
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

function runConfigCommand(args: string[]): never {
  const root = process.cwd();
  const command = args[0];
  try {
    if (command === "set") {
      if (args.length < 2 || args.length > 3) {
        fail("config set needs a setting and value");
      }
      const config = setProfileValue(root, args[1]!, args[2]);
      process.stdout.write(`${JSON.stringify(config)}\n`);
    } else if (command === "unset") {
      if (args.length !== 2) {
        fail("config unset needs a setting");
      }
      const config = unsetProfileValue(root, args[1]!);
      process.stdout.write(`${JSON.stringify(config)}\n`);
    } else if (command === "show") {
      if (args.length !== 1) {
        fail("config show takes no arguments");
      }
      process.stdout.write(`${JSON.stringify(readProfile(root), null, 2)}\n`);
    } else if (command === "path") {
      if (args.length !== 1) {
        fail("config path takes no arguments");
      }
      process.stdout.write(`${profilePaths(root).config}\n`);
    } else {
      fail("config command must be set, unset, show, or path");
    }
  } catch (e) {
    fail((e as Error).message);
  }
  process.exit(EXIT_OK);
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
    const quickCapture = positionals[0] != null && positionals[0].startsWith("/");
    ensureWorkspace();
    if (positionals[0] === "config") {
      runConfigCommand(positionals.slice(1));
    }
    const runTmp = createRunTmpDir();
    process.on("exit", () => removeRunTmpDir(runTmp));
    let profile: ReturnType<typeof readProfile> = {};
    try {
      profile = readProfile();
    } catch (e) {
      if (quickCapture) {
        fail((e as Error).message);
      }
    }
    if (positionals.length === 0) {
      fail("missing <url> or <quick-path> (try: browsershot --help)");
    }
    if (positionals.length > 1) {
      fail(`unexpected extra arguments: ${positionals.slice(1).join(" ")}`);
    }
    let url = "";
    {
      const positional = positionals[0]!;
      if (positional.startsWith("/")) {
        if (profile.url == null) {
          fail("quick capture needs a saved url; run: browsershot config set url <url>");
        }
        try {
          url = resolveQuickUrl(profile.url, positional);
        } catch (e) {
          fail((e as Error).message);
        }
      } else {
        url = normalizeUrl(positional);
      }
    }
    const json = Boolean(values.json) || profile.json === true;

    let publishDest: string | null = null;
    try {
      publishDest = resolvePublishDest(values.publish ?? null, profile.publish);
    } catch (e) {
      fail((e as Error).message);
    }

    let publishSize = DEFAULT_EMBED_WIDTH;
    try {
      if (values["publish-size"] != null) {
        publishSize = intFlag("publish-size", values["publish-size"]);
      }
    } catch (e) {
      fail((e as Error).message);
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

    let viewport = { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };
    if (values.size != null) {
      const size = parseSize(values.size);
      if (size == null) {
        fail(`--size must look like WxH (e.g. 1920x1080), got "${values.size}"`);
      }
      viewport = size;
    }

    let delayMs = 0;
    try {
      if (values.delay != null) {
        delayMs = intFlag("delay", values.delay);
      }
    } catch (e) {
      fail((e as Error).message);
    }

    let fullPage = Boolean(values["full-page"]);
    const verbose = Boolean(values.verbose);
    const savedAuthUser = values["auth-user"] == null ? profile.authUser : values["auth-user"];
    const authRequested = Boolean(values.auth) || savedAuthUser != null || values["auth-credentials"] != null;
    if (values["auth-purpose"]) {
      fail("--auth-purpose was removed — use --auth-user");
    }
    let jarPath: string | undefined;
    if (authRequested) {
      try {
        let credentialsPath = values["auth-credentials"];
        if (credentialsPath == null) {
          credentialsPath = discoverAuthCredentials(process.cwd());
          process.stderr.write(`browsershot: using ${credentialsPath}\n`);
        }
        const user = savedAuthUser;
        jarPath = await resolveAuthJar(
          { credentialsPath: credentialsPath as string, user: user as string | undefined },
          undefined,
          (chunk) => process.stderr.write(chunk),
        );
      } catch (e) {
        if (e instanceof AuthStateFailure) {
          fail(e.message, e.code);
        }
        fail((e as Error).message, EXIT_FAILED);
      }
    }
    const allowBlank = Boolean(values["allow-blank"]);
    const allowStatus = Boolean(values["allow-status"]);
    const expectText = values["expect-text"] == null ? profile.expectText : values["expect-text"];

    let inspect: InspectOptions | undefined;
    if (values.inspect != null) {
      if (values.inspect.trim() === "") {
        fail("--inspect needs a CSS selector");
      }
      inspect = { selector: values.inspect, attr: values["inspect-attr"], timeoutMs: NAVIGATION_TIMEOUT_MS };
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

    const options = {
      url,
      viewport,
      fullPage,
      delayMs,
      cookiesPath: jarPath,
      allowBlank,
      inspect,
      inspectFooter,
      actions,
      allowStatus,
      expectText,
      verbose,
      log: (message: string) => process.stderr.write(`browsershot: ${message}\n`),
    };

    let out = join(profilePaths().captures, `${timestamp()}.png`);
    if (profile.output != null) {
      out = profile.output;
    }
    if (values.output != null) {
      out = values.output;
    }
    out = resolve(out);

    const success = emptySuccess();

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
      png = drawAnnotations(png, boxes, markers, runTmp);
    } catch (e) {
      fail((e as Error).message);
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, png);
    success.outputPath = out;
    success.bytes = png.length;
    success.sha256 = sha256Hex(png);
    process.stderr.write(`browsershot: wrote ${out} (${png.length} bytes)\n`);
    process.stderr.write(`browsershot: sha256 ${success.sha256}\n`);
    if (!json) {
      process.stdout.write(`${out}\n`);
    }
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
      success.inspectJsonPath = jsonOut;
      success.inspected = inspected;
      process.stderr.write(`browsershot: inspected ${inspectSummary(inspected, values["inspect-attr"])}\n`);
      process.stderr.write(`browsershot: element json ${jsonOut}\n`);
    }
    if (publishDest != null) {
      let pngLabel = labelFromPath(out);
      if (values["publish-label"] != null) {
        pngLabel = values["publish-label"];
      }
      try {
        const published = publish({ filePath: out, dest: publishDest, size: publishSize, label: pngLabel });
        success.publishedUrl = published.url;
        if (!json) {
          process.stdout.write(`${published.markdown}\n`);
        }
      } catch (e) {
        const failure = publishFailure(out, e as Error);
        fail(failure.message, failure.code);
      }
    }
    if (json) {
      process.stdout.write(`${JSON.stringify(success)}\n`);
    }
    if (profile.autoOpen === true || values["auto-open"]) {
      openFile(out, (message) => process.stderr.write(`browsershot: warning: ${message}\n`));
    }
  }
}

if (import.meta.main) {
  await main();
}
