#!/usr/bin/env bun

import { parseArgs } from "node:util";
import packageJson from "../package.json";
import { DEFAULT_EMBED_WIDTH } from "./publish.ts";
import { ExitError, EXIT_FAILED, EXIT_OK, EXIT_USAGE, type ExitCode } from "./exit-codes.ts";
import { profilePaths, readProfile, setProfileValue, unsetProfileValue } from "./profile.ts";
import { ensureWorkspace } from "./workspace.ts";
import { resolveRunOptions } from "./run-options.ts";
import { runCapture } from "./run-capture.ts";

export { timestamp } from "./output-path.ts";
export {
  normalizeUrl,
  parseSize,
  resolveCaptureUrl,
  resolvePublishDestination as resolvePublishDest,
} from "./run-options.ts";
export {
  captureWithAuthRetry,
  emptySuccess,
  inspectJsonPath,
  inspectSummary,
  sha256Hex,
} from "./run-capture.ts";
export type { SuccessSummary } from "./run-capture.ts";

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
  -o, --output <path>       Exact PNG path or template (advanced override)
      --group <path>        Group under captures, before the host directory
      --label <text>        Describe the captured state in the file name
                            Example: --group PR-123 --label menu-open
  Default: .browsershot/captures/{host}/{route}_{timestamp}.png
  Output placeholders: {host}, {route}, {date}, {time}, {timestamp}.
  Use {{ and }} for literal braces. Unknown placeholders are errors.
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
                        hover, press, type or wait (milliseconds). Selectors are CSS.
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
  and use focus, click, hover, press, type or wait. Selectors are CSS.
  Example: --act 'hover:button#menu;click:button#menu;wait:250'

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
  group, label, json, autoOpen and publish. Kebab-case aliases are accepted for
  config set and unset, including base-url, auth-user, expect-element,
  expect-text and auto-open. Reads never rewrite the config file.

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
      group: { type: "string" },
      label: { type: "string" },
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
    ensureWorkspace();
    if (positionals[0] === "config") {
      runConfigCommand(positionals.slice(1));
    }
    let profile: ReturnType<typeof readProfile> = {};
    try {
      profile = readProfile();
    } catch (e) {
      fail((e as Error).message);
    }
    if (positionals.length === 0) {
      fail("missing <url> or <quick-path> (try: browsershot --help)");
    }
    if (positionals.length > 1) {
      fail(`unexpected extra arguments: ${positionals.slice(1).join(" ")}`);
    }
    const cwd = process.cwd();
    let runOptions: ReturnType<typeof resolveRunOptions>;
    try {
      runOptions = resolveRunOptions({
        positional: positionals[0]!,
        flags: values,
        profile,
        paths: profilePaths(cwd),
        cwd,
      });
    } catch (e) { fail((e as Error).message); }
    try {
      await runCapture(runOptions, {
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
      });
    } catch (e) {
      if (e instanceof ExitError) {
        fail(e.message, e.code);
      }
      fail((e as Error).message, EXIT_FAILED);
    }
  }
}

if (import.meta.main) {
  await main();
}
