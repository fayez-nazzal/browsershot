#!/usr/bin/env bun

import { parseArgs } from "node:util";
import packageJson from "../package.json";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { capture, isAuthenticationCaptureFailure, NAVIGATION_TIMEOUT_MS, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, type CaptureOptions, type CaptureResult } from "./capture.ts";
import { drawAnnotations, parseBoxFlag, parseMarkerFlag, type BoxAnnotation, type MarkerAnnotation } from "./annotate.ts";
import { publish, labelFromPath, DEFAULT_EMBED_WIDTH } from "./publish.ts";
import { parseActions, type Action } from "./act.ts";
import type { InspectOptions } from "./inspect.ts";
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, EXIT_WRITE_ERROR, publishFailure, type ExitCode } from "./exit-codes.ts";
import { resolveAuthJar, AuthStateFailure, discoverAuthCredentials } from "./authstate.ts";
import { profilePaths, readProfile, resolveQuickUrl, setProfileValue, unsetProfileValue } from "./profile.ts";
import { openFile } from "./open.ts";
import { createRunTmpDir, ensureWorkspace, removeRunTmpDir } from "./workspace.ts";

export const VERSION = `${packageJson.version}-alpha`;

const HELP = `browsershot ${VERSION} — capture a page and return evidence

START HERE
  Complete URL, no setup:
    browsershot https://example.com/pricing

  Saved route, convenient for a project:
    browsershot config set baseUrl https://example.com
    browsershot /pricing

  A complete URL uses itself. A path beginning with / is appended to the saved
  baseUrl in the current directory. The legacy saved key url is accepted.

USAGE
  browsershot <url-or-path> [options]
  browsershot config set <name> [value]
  browsershot config unset <name>
  browsershot config show | path

CAPTURE
  -o, --output <path>       Output PNG path
                            (default: .browsershot/captures/<timestamp>.png)
      --size <WxH>          Viewport size (default: 1440x900)
      --delay <ms>          Extra wait after load before capture (default: 0)
      --full-page           Capture the whole scrollable page
      --auto-open           Open the written capture with the platform viewer
      --no-auto-open        Disable a saved autoOpen setting for this run
      --json                Print one JSON result instead of a path
      --no-json             Disable a saved json setting for this run

  Defaults are the load event, a 30-second navigation timeout, and a 1440x900
  viewport at 2x device scale. Each capture uses one browser launch and one
  screenshot.
READINESS AND SAFETY
      --expect-text <text>  Require this case-sensitive text before actions
      --expect-element <selector>
                            Wait up to 10 seconds for the first matching CSS
                            element to become visible before actions
      --no-expect           Disable saved and explicit content assertions
      --allow-status        Capture non-2xx/3xx responses
      --allow-blank         Capture pages that still look blank after polling

  Explicit --expect-text or --expect-element flags replace the saved assertion
  set. If both are present, both must pass. Positive and negative options for
  the same setting are usage errors. Status and blank-render guards stay active
  when --no-expect is used.

AUTHENTICATION
      --auth                Discover credentials and run authstate
      --auth-user <name>    Use this credentials entry; implies --auth
      --auth-credentials <path>
                            Use this credentials file instead of discovery
      --auth-redirect <text>
                            Retry auth when a redirected URL contains this
                            literal text; can be saved as authRedirect
      --no-auth-redirect    Disable a saved authRedirect for this run
      --no-auth             Disable saved authentication for this run

INTERACTION AND INSPECTION
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

  Actions run after readiness and before inspection. Steps are separated by ;
  and use focus, click, press, type or wait. Selectors are CSS.
  Example: --act 'click:#menu;wait:250'

PUBLISH
      --publish [dest]      Upload with rclone and print a public embed
      --publish-size <px>   Embed long-edge width (default: ${DEFAULT_EMBED_WIDTH})
      --publish-label <text> Embed alt text (default: file name)

PUBLISHING RULES
  A destination passed to --publish wins. Bare --publish uses the saved publish
  setting and fails with usage error 2 if none is saved.

OUTPUT AND ERRORS
  Without --json, the absolute PNG path is the first stdout line. With --json,
  stdout is exactly one object with outputPath, bytes, sha256, inspectJsonPath,
  inspected and publishedUrl. Human diagnostics are on stderr.

  Exit 0  capture written
  Exit 1  page guard or capture failure
  Exit 2  invalid command, option or conflicting flags
  Exit 3  authstate or credentials environment failure
  Exit 4  PNG written but inspection sidecar failed
  Exit 5  PNG written but publishing failed

CONFIGURATION
  Canonical saved names: baseUrl, authUser, expectElement, expectText, output,
  json, autoOpen and publish. Kebab-case aliases are accepted for config set
  and unset, including base-url, auth-user, expect-element, expect-text and
  auto-open. Reads never rewrite the config file.

META
      --verbose         Playwright progress detail on stderr: phase timings,
                        failed requests, console errors, act step echo
  -h, --help            Show this help
  -v, --version         Show version
`;

export function parseCliArgs(argv: string[]) {
  return parseArgs({
    args: normalizeArgv(argv),
    options: {
      output: { type: "string", short: "o" },
      size: { type: "string" },
      "full-page": { type: "boolean", default: false },
      auth: { type: "boolean", default: false },
      "auth-user": { type: "string" },
      "auth-credentials": { type: "string" },
      "auth-redirect": { type: "string" },
      "auth-purpose": { type: "string" },
      verbose: { type: "boolean", default: false },
      delay: { type: "string" },
      act: { type: "string" },
      "allow-blank": { type: "boolean", default: false },
      "allow-status": { type: "boolean", default: false },
      "expect-text": { type: "string" },
      "expect-element": { type: "string" },
      "no-expect": { type: "boolean", default: false },
      "no-auth": { type: "boolean", default: false },
      "no-auth-redirect": { type: "boolean", default: false },
      "no-json": { type: "boolean", default: false },
      "no-auto-open": { type: "boolean", default: false },
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

function parse() { return parseCliArgs(process.argv.slice(2)); }

export interface RunDefaultFlags {
  auth?: boolean; "auth-user"?: string; "auth-credentials"?: string; "auth-redirect"?: string; "no-auth"?: boolean; "no-auth-redirect"?: boolean;
  "expect-text"?: string; "expect-element"?: string; "no-expect"?: boolean;
  json?: boolean; "no-json"?: boolean; "auto-open"?: boolean; "no-auto-open"?: boolean;
}

export interface RunDefaults {
  authRequested: boolean; authUser?: string; authCredentials?: string;
  authRedirect?: string;
  expectText?: string; expectElement?: string; json: boolean; autoOpen: boolean;
}

function nonEmptyFlag(name: string, value: string | undefined): string | undefined {
  if (value !== undefined && value.trim() === "") throw new Error(`--${name} needs a non-empty value`);
  return value;
}

export function resolveRunDefaults(flags: RunDefaultFlags, profile: ReturnType<typeof readProfile>): RunDefaults {
  if (flags["no-auth"] === true && (flags.auth === true || flags["auth-user"] !== undefined || flags["auth-credentials"] !== undefined)) {
    throw new Error("conflict between --no-auth and positive auth options");
  }
  if (flags["no-auth-redirect"] === true && flags["auth-redirect"] !== undefined) {
    throw new Error("conflict between --no-auth-redirect and --auth-redirect");
  }
  if (flags["no-expect"] === true && (flags["expect-text"] !== undefined || flags["expect-element"] !== undefined)) {
    throw new Error("conflict between --no-expect and positive expectation options");
  }
  if (flags["no-json"] === true && flags.json === true) throw new Error("conflict between --no-json and --json");
  if (flags["no-auto-open"] === true && flags["auto-open"] === true) throw new Error("conflict between --no-auto-open and --auto-open");
  const authUser = nonEmptyFlag("auth-user", flags["auth-user"] ?? profile.authUser);
  const authRedirect = flags["no-auth-redirect"] === true ? undefined : nonEmptyFlag("auth-redirect", flags["auth-redirect"] ?? profile.authRedirect);
  const authRequested = flags["no-auth"] === true ? false : Boolean(flags.auth || authUser !== undefined || flags["auth-credentials"] !== undefined);
  const explicitExpectation = flags["expect-text"] !== undefined || flags["expect-element"] !== undefined;
  const expectations = flags["no-expect"] === true ? {} : explicitExpectation
    ? { expectText: nonEmptyFlag("expect-text", flags["expect-text"]), expectElement: nonEmptyFlag("expect-element", flags["expect-element"]) }
    : { expectText: profile.expectText, expectElement: profile.expectElement };
  return {
    authRequested,
    authUser,
    authCredentials: flags["auth-credentials"],
    authRedirect,
    expectText: expectations.expectText,
    expectElement: expectations.expectElement,
    json: flags["no-json"] === true ? false : Boolean(flags.json || profile.json),
    autoOpen: flags["no-auto-open"] === true ? false : Boolean(flags["auto-open"] || profile.autoOpen),
  };
}

export function resolveCaptureUrl(positional: string, profile: ReturnType<typeof readProfile>): string {
  if (positional.startsWith("/")) {
    if (profile.baseUrl == null) throw new Error("quick capture needs a saved baseUrl; run: browsershot config set baseUrl <url>");
    return resolveQuickUrl(profile.baseUrl, positional);
  }
  return normalizeUrl(positional);
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

export interface AuthCaptureRetryDeps {
  capture: (options: CaptureOptions) => Promise<CaptureResult>;
  resolveAuthJar: typeof resolveAuthJar;
}

export async function captureWithAuthRetry(
  options: CaptureOptions,
  auth: { credentialsPath: string; user?: string } | null,
  deps: AuthCaptureRetryDeps = { capture, resolveAuthJar },
  onAuthStateStderr?: (chunk: string) => void,
): Promise<CaptureResult> {
  try {
    return await deps.capture(options);
  } catch (initialError) {
    if (auth == null || !isAuthenticationCaptureFailure(initialError)) {
      throw initialError;
    }
    const initialMessage = (initialError as Error).message;
    process.stderr.write("browsershot: authentication appears invalid; verifying session and retrying once\n");
    let verifiedJar: string;
    try {
      verifiedJar = await deps.resolveAuthJar({ ...auth, verify: true }, undefined, onAuthStateStderr);
    } catch (verificationError) {
      if (verificationError instanceof AuthStateFailure) {
        throw new AuthStateFailure(
          `authentication retry failed after ${initialMessage}: ${verificationError.message}`,
          verificationError.code,
        );
      }
      throw new Error(`authentication retry failed after ${initialMessage}: ${(verificationError as Error).message}`);
    }
    try {
      return await deps.capture({ ...options, cookiesPath: verifiedJar });
    } catch (retryError) {
      throw new Error(`authentication retry failed after ${initialMessage}: ${(retryError as Error).message}`);
    }
  }
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
      try { url = resolveCaptureUrl(positional, profile); } catch (e) { fail((e as Error).message); }
    }
    let defaults: RunDefaults;
    try {
      defaults = resolveRunDefaults(values, profile);
    } catch (e) { fail((e as Error).message); }
    const json = defaults.json;

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
    if (values["auth-purpose"]) {
      fail("--auth-purpose was removed — use --auth-user");
    }
    let jarPath: string | undefined;
    let authCredentialsPath: string | null = null;
    if (defaults.authRequested) {
      try {
        let credentialsPath = defaults.authCredentials;
        if (credentialsPath == null) {
          credentialsPath = discoverAuthCredentials(process.cwd());
          process.stderr.write(`browsershot: using ${credentialsPath}\n`);
        }
        authCredentialsPath = credentialsPath;
        const user = defaults.authUser;
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
    const expectText = defaults.expectText;
    const expectElement = defaults.expectElement;

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
      authRedirect: defaults.authRedirect,
      inspect,
      inspectFooter,
      actions,
      allowStatus,
      expectText,
      expectElement,
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
      const result = await captureWithAuthRetry(
        options,
        defaults.authRequested && authCredentialsPath != null
          ? { credentialsPath: authCredentialsPath, user: defaults.authUser }
          : null,
        undefined,
        (chunk) => process.stderr.write(chunk),
      );
      png = result.png;
      inspected = result.inspected;
    } catch (e) {
      if (e instanceof AuthStateFailure) {
        fail(e.message, e.code);
      }
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
    if (defaults.autoOpen) {
      openFile(out, (message) => process.stderr.write(`browsershot: warning: ${message}\n`));
    }
  }
}

if (import.meta.main) {
  await main();
}
