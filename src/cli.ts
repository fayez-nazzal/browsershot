#!/usr/bin/env bun

import { parseArgs } from "node:util";
import packageJson from "../package.json";
import { DEFAULT_EMBED_WIDTH } from "./publish.ts";
import { ExitError, EXIT_FAILED, toUsageError, UsageError } from "./exit-codes.ts";
import {
  readPages,
  removePage,
  removePagePart,
  resolvePageTarget,
  RESERVED_PAGE_WORDS,
  savePage,
  savePageElement,
  savePageSetup,
  type PagesFile,
  type PageSetup,
  type SavedPage,
} from "./pages.ts";
import {
  fetchLibraryCatalog,
  readCachedCatalog,
  readLibraries,
  readResolvedLibrary,
  removeLibrary,
  resolveLibraryTarget,
  saveLibrary,
} from "./libraries.ts";
import { profilePaths, readProfile, setProfileValue, unsetProfileValue } from "./profile.ts";
import { resolveRunOptions, type CaptureFlags } from "./run-options.ts";
import { runCapture } from "./run-capture.ts";

export const VERSION = `${packageJson.version}-alpha`;

const HELP = `browsershot ${VERSION} — capture a page and return evidence

START HERE
  Complete URL, no setup:
    browsershot https://example.com/pricing

  Saved route, convenient for a project:
    browsershot config set baseUrl https://example.com
    browsershot /pricing

  A complete URL uses itself. A path beginning with / is appended to the saved
  baseUrl in the current directory. The legacy saved key url is accepted. A
  quick path changes only URL resolution; every capture option behaves the
  same for a quick path and a complete URL.
  Invalid saved configuration blocks both forms before capture starts.

USAGE
  browsershot <url-or-path> [options]
  browsershot config set <name> [value]
  browsershot config unset <name>
  browsershot config show | path
  browsershot page <page> [<element>] [--setup <name>]
  browsershot library <library> <entry>
  browsershot library add <library> <base-url> --plugin <name>

CAPTURE
  -o, --output <path>       Exact PNG path or template (advanced override)
      --group <path>        Group under captures, before the host directory
      --label <text>        Describe the captured state in the file name
                            Example: --group PR-123 --label menu-open
  Default name without a query:
    .browsershot/captures/example.com/pricing_2026-09-05_14-30-12.png
  Name shape with a query (illustrative, not a digest of a documented URL):
    .browsershot/captures/example.com/clients_q-filter-token-4e2a9c7d1130_2026-09-05_14-30-12.png
  Output placeholders: {host}, {route}, {query}, {date}, {time}, {timestamp}.
  Use {{ and }} for literal braces. Unknown placeholders are errors.
  {route} uses the pathname of a hash route (a fragment beginning with /);
  ordinary anchors are ignored. {query} holds sanitized parameter names plus a
  12-character hexadecimal fingerprint; query values are never written in plaintext.
  The fingerprint identifies a capture, it does not encrypt it; use --label for
  a readable state. The default name adds _q-{query} only when a query exists.
      --size <WxH>          Viewport size (default: 1440x900)
      --delay <ms>          Extra wait after load before capture (default: 0)
      --element <selector>  Capture only the first matching visible element
      --no-element          Disable a saved element selector for this run
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
  Exit 2  invalid command, option, conflicting flags or invalid saved configuration
  Exit 3  authstate or credentials environment failure
  Exit 4  PNG written but inspection sidecar failed
  Exit 5  PNG written but publishing failed

CONFIGURATION
  Canonical saved names: baseUrl, authUser, authRedirect, expectElement,
  expectText, element, output, group, label, json, autoOpen and publish.
  Kebab-case aliases are accepted for set and unset, including base-url,
  url, auth-user, expect-element, expect-text and auto-open. Reads never
  rewrite the config file and never create the workspace.

SAVED PAGES
  browsershot page add checkout /checkout --auth-user member
  browsershot page element checkout summary "#order-summary"
  browsershot page setup checkout empty /checkout?cart=empty
  browsershot page list
  browsershot page show checkout
  browsershot page remove checkout [element-or-setup]

  Capture by name:
    browsershot page checkout
    browsershot page checkout summary
    browsershot page checkout summary --setup empty

  A page saves a route or URL plus optional defaults (--auth-user, --auth-redirect,
  --expect-element, --expect-text, --act, --size); named elements save selectors;
  setups override fields for one state. Definitions live in .browsershot/pages.json,
  are never shared, and names match [a-z0-9][a-z0-9_-]*. add, element, setup, list,
  show and remove are reserved. Per-run flags still win; --act steps run page,
  setup, then per-run steps. Default output groups by name:
    .browsershot/captures/checkout/summary_empty_2026-09-05_14-30-12.png

COMPONENT LIBRARIES
  browsershot library add ui https://storybook.example --plugin storybook
  browsershot library list ui
  browsershot library show ui
  browsershot library refresh ui
  browsershot library remove ui

  Capture one example by name:
    browsershot library ui button--primary
    browsershot library ui "controls/button" --label hover

  A library is a running component environment described by a plugin (built-in:
  storybook, ladle; workspace overrides in .browsershot/plugins/<name>.json).
  Entries resolve by exact id, then case-insensitive group/name; ambiguous names
  are errors. Catalogs cache in .browsershot/cache/<library>.json and refresh on
  a miss. Readiness comes from the plugin's selector; --scope or --ready on
  library add override it. Default output groups by library:
    .browsershot/captures/ui/button--primary_2026-09-05_14-30-12.png
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
      element: { type: "string" },
      "no-element": { type: "boolean", default: false },
      setup: { type: "string" },
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
      plugin: { type: "string" },
      ready: { type: "string" },
      scope: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
      "auto-open": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
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

function writeStdout(text: string): void {
  process.stdout.write(text);
}

function writeStderr(text: string): void {
  process.stderr.write(text);
}

function fail(error: unknown): never {
  let message = String(error);
  if (error instanceof Error) {
    message = error.message;
  }
  let code = EXIT_FAILED;
  if (error instanceof ExitError) {
    code = error.code;
  }
  process.stderr.write(`browsershot: ${message}\n`);
  process.exit(code);
}

function parse(): ReturnType<typeof parseCliArgs> {
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    throw toUsageError(error);
  }
  return parsed;
}

function runConfigCommand(values: CaptureFlags, args: string[]): void {
  const root = process.cwd();
  const command = args[0];
  try {
    if (command === "set") {
      rejectCaptureOptions(values, "config set accepts no capture options");
      if (args.length < 2 || args.length > 3) {
        throw new UsageError("config set needs a setting and value");
      }
      const config = setProfileValue(root, args[1]!, args[2]);
      writeStdout(`${JSON.stringify(config)}\n`);
    } else if (command === "unset") {
      rejectCaptureOptions(values, "config unset accepts no capture options");
      if (args.length !== 2) {
        throw new UsageError("config unset needs a setting");
      }
      const config = unsetProfileValue(root, args[1]!);
      writeStdout(`${JSON.stringify(config)}\n`);
    } else if (command === "show") {
      rejectCaptureOptions(values, "config show accepts no capture options");
      if (args.length !== 1) {
        throw new UsageError("config show takes no arguments");
      }
      writeStdout(`${JSON.stringify(readProfile(root), null, 2)}\n`);
    } else if (command === "path") {
      rejectCaptureOptions(values, "config path accepts no capture options");
      if (args.length !== 1) {
        throw new UsageError("config path takes no arguments");
      }
      writeStdout(`${profilePaths(root).config}\n`);
    } else {
      throw new UsageError("config command must be set, unset, show, or path");
    }
  } catch (error) {
    throw toUsageError(error);
  }
}

const PAGE_DEFINITION_COMMANDS: readonly string[] = RESERVED_PAGE_WORDS;

function readPageDefinition(root: string, name: string): SavedPage {
  const pages = readPages(root);
  const page = pages.pages[name];
  if (page === undefined) {
    const known = Object.keys(pages.pages).sort();
    throw new UsageError(`unknown page "${name}"; known pages: ${known.length === 0 ? "(none)" : known.join(", ")}`);
  }
  return page;
}

const PAGE_SETTING_FLAGS = ["auth-user", "auth-redirect", "expect-element", "expect-text", "act", "size"];

function flagIsSet(value: unknown): boolean {
  let result = value === true;
  if (typeof value === "string") {
    result = value !== "";
  } else if (Array.isArray(value)) {
    result = value.length > 0;
  }
  return result;
}

function rejectUnsupportedFlags(values: CaptureFlags, allowed: readonly string[], message: string): void {
  for (const [name, value] of Object.entries(values)) {
    if (!allowed.includes(name) && flagIsSet(value)) {
      throw new UsageError(message);
    }
  }
}

function rejectCaptureOptions(values: CaptureFlags, message: string): void {
  if (
    captureFlagPresent(values)
    || values.plugin !== undefined
    || values.ready !== undefined
    || values.scope !== undefined
  ) {
    throw new UsageError(message);
  }
}

function rejectSetupFlag(values: CaptureFlags): void {
  if (values.setup !== undefined) {
    throw new UsageError("--setup is only valid when capturing a page");
  }
}

function pageSettingsFromFlags(values: CaptureFlags): PageSetup {
  const settings: PageSetup = {};
  if (values["auth-user"] !== undefined) {
    settings.authUser = values["auth-user"];
  }
  if (values["auth-redirect"] !== undefined) {
    settings.authRedirect = values["auth-redirect"];
  }
  if (values["expect-element"] !== undefined) {
    settings.expectElement = values["expect-element"];
  }
  if (values["expect-text"] !== undefined) {
    settings.expectText = values["expect-text"];
  }
  if (values.act !== undefined) {
    settings.act = values.act;
  }
  if (values.size !== undefined) {
    settings.size = values.size;
  }
  return settings;
}

function pageSetupFromFlags(values: CaptureFlags, route?: string): PageSetup {
  const setup = pageSettingsFromFlags(values);
  if (route !== undefined) {
    setup.route = route;
  }
  if (Object.keys(setup).length === 0) {
    throw new UsageError("page setup needs a route or at least one setting");
  }
  return setup;
}
function runPageDefinitionCommand(values: CaptureFlags, args: string[]): void {
  const root = process.cwd();
  const command = args[0];
  try {
    if (command === "add") {
      if (args.length !== 3) {
        throw new UsageError("page add needs a name and a route or URL");
      }
      rejectSetupFlag(values);
      rejectUnsupportedFlags(
        values,
        PAGE_SETTING_FLAGS,
        "page add accepts only --auth-user, --auth-redirect, --expect-element, --expect-text, --act, and --size",
      );
      const page: SavedPage = { ...pageSettingsFromFlags(values), route: args[2]! };
      writeStdout(`${JSON.stringify(savePage(root, args[1]!, page))}\n`);
    } else if (command === "element") {
      if (args.length !== 4) {
        throw new UsageError("page element needs a page, a name, and a selector");
      }
      rejectUnsupportedFlags(values, [], "page element takes no options");
      writeStdout(`${JSON.stringify(savePageElement(root, args[1]!, args[2]!, args[3]!))}\n`);
    } else if (command === "setup") {
      if (args.length < 3 || args.length > 4) {
        throw new UsageError("page setup needs a page and a name");
      }
      rejectSetupFlag(values);
      rejectUnsupportedFlags(
        values,
        PAGE_SETTING_FLAGS,
        "page setup accepts only --auth-user, --auth-redirect, --expect-element, --expect-text, --act, and --size",
      );
      const setup = pageSetupFromFlags(values, args[3]);
      writeStdout(`${JSON.stringify(savePageSetup(root, args[1]!, args[2]!, setup))}\n`);
    } else if (command === "list") {
      rejectCaptureOptions(values, "page list accepts no options");
      if (args.length !== 1) {
        throw new UsageError("page list takes no arguments");
      }
      writeStdout(`${JSON.stringify(readPages(root), null, 2)}\n`);
    } else if (command === "show") {
      rejectCaptureOptions(values, "page show accepts no options");
      if (args.length !== 2) {
        throw new UsageError("page show needs a page");
      }
      writeStdout(`${JSON.stringify(readPageDefinition(root, args[1]!), null, 2)}\n`);
    } else {
      rejectCaptureOptions(values, "page remove accepts no options");
      if (args.length < 2 || args.length > 3) {
        throw new UsageError("page remove needs a page");
      }
      let pages: PagesFile;
      if (args.length === 3) {
        pages = removePagePart(root, args[1]!, args[2]!);
      } else {
        pages = removePage(root, args[1]!);
      }
      writeStdout(`${JSON.stringify(pages)}\n`);
    }
  } catch (error) {
    throw toUsageError(error);
  }
}

async function runPageCaptureCommand(values: CaptureFlags, args: string[]): Promise<void> {
  rejectLibraryFlags(values);
  if (args.length > 2) {
    throw new UsageError(`unexpected extra arguments: ${args.slice(2).join(" ")}`);
  }
  if (values.setup !== undefined && values.setup.trim() === "") {
    throw new UsageError("--setup needs a non-empty value");
  }
  const cwd = process.cwd();
  const profile = readProfile(cwd);
  const paths = profilePaths(cwd);
  const target = resolvePageTarget({ root: cwd, page: args[0]!, element: args[1], setup: values.setup, profile });
  const input = { target, flags: values, profile, paths, cwd };
  const resolved = resolveRunOptions(input);
  const io = { stdout: writeStdout, stderr: writeStderr };
  await runCapture(resolved, io);
}

async function runPageCommand(values: CaptureFlags, args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new UsageError("page needs a command or a page name");
  }
  if (PAGE_DEFINITION_COMMANDS.includes(args[0]!)) {
    runPageDefinitionCommand(values, args);
  } else {
    await runPageCaptureCommand(values, args);
  }
}

async function runCaptureCommand(values: CaptureFlags, positionals: string[]): Promise<void> {
  rejectSetupFlag(values);
  rejectLibraryFlags(values);
  if (positionals.length === 0) {
    throw new UsageError("missing <url> or <quick-path> (try: browsershot --help)");
  }
  if (positionals.length > 1) {
    throw new UsageError(`unexpected extra arguments: ${positionals.slice(1).join(" ")}`);
  }
  const cwd = process.cwd();
  const profile = readProfile(cwd);
  const paths = profilePaths(cwd);
  const input = { positional: positionals[0]!, flags: values, profile, paths, cwd };
  const resolved = resolveRunOptions(input);
  const io = { stdout: writeStdout, stderr: writeStderr };
  await runCapture(resolved, io);
}

function rejectLibraryFlags(values: CaptureFlags): void {
  if (values.plugin !== undefined) {
    throw new UsageError("--plugin is only valid with library add");
  }
  if (values.ready !== undefined) {
    throw new UsageError("--ready is only valid with library add");
  }
  if (values.scope !== undefined) {
    throw new UsageError("--scope is only valid with library add");
  }
}

function captureFlagPresent(values: CaptureFlags): boolean {
  const text = (
    values.output !== undefined || values.group !== undefined || values.label !== undefined
    || values.size !== undefined || values.element !== undefined || values.delay !== undefined
    || values.setup !== undefined || values.act !== undefined || values.inspect !== undefined
    || values.publish !== undefined || values["auth-user"] !== undefined
    || values["auth-credentials"] !== undefined || values["auth-redirect"] !== undefined
    || values["auth-purpose"] !== undefined || values["expect-text"] !== undefined
    || values["expect-element"] !== undefined || values["inspect-attr"] !== undefined
    || values["inspect-json"] !== undefined || values["inspect-note"] !== undefined
    || values["publish-size"] !== undefined || values["publish-label"] !== undefined
  );
  const toggles = (
    values.auth === true || values.json === true || values.verbose === true
    || values["full-page"] === true || values["allow-blank"] === true || values["allow-status"] === true
    || values["auto-open"] === true || values["no-element"] === true || values["no-expect"] === true
    || values["no-auth"] === true || values["no-auth-redirect"] === true || values["no-json"] === true
    || values["no-auto-open"] === true
  );
  const repeats = (values.box?.length ?? 0) > 0 || (values.marker?.length ?? 0) > 0;
  return text || toggles || repeats;
}

function isAbsoluteUrl(value: string): boolean {
  let absolute = true;
  try {
    new URL(value);
  } catch {
    absolute = false;
  }
  return absolute;
}

function knownNames(names: string[]): string {
  const sorted = [...names].sort();
  if (sorted.length === 0) {
    return "(none)";
  }
  return sorted.join(", ");
}

async function runLibraryCommand(values: CaptureFlags, args: string[]): Promise<void> {
  const command = args[0];
  if (command === undefined) {
    throw new UsageError("library needs a command or a library name");
  }
  if (command === "add") {
    runLibraryAddCommand(values, args.slice(1));
  } else {
    rejectLibraryFlags(values);
    if (command === "list") {
      rejectLibraryManagementOptions(values, command);
      await runLibraryListCommand(args.slice(1));
    } else if (command === "show") {
      rejectLibraryManagementOptions(values, command);
      runLibraryShowCommand(args.slice(1));
    } else if (command === "refresh") {
      rejectLibraryManagementOptions(values, command);
      await runLibraryRefreshCommand(args.slice(1));
    } else if (command === "remove") {
      rejectLibraryManagementOptions(values, command);
      runLibraryRemoveCommand(args.slice(1));
    } else {
      await runLibraryCaptureCommand(values, args);
    }
  }
}

function rejectLibraryManagementOptions(values: CaptureFlags, command: string): void {
  if (captureFlagPresent(values)) {
    throw new UsageError(`library ${command} accepts no options`);
  }
}

function runLibraryAddCommand(values: CaptureFlags, args: string[]): void {
  if (args.length !== 2) {
    throw new UsageError("library add needs a name and a base URL");
  }
  if (values.plugin === undefined) {
    throw new UsageError("library add needs --plugin <name>");
  }
  if (!isAbsoluteUrl(args[1]!)) {
    throw new UsageError(`library add needs an absolute base URL, got "${args[1]!}"`);
  }
  if (captureFlagPresent(values)) {
    throw new UsageError("library add accepts only --plugin, --ready, and --scope");
  }
  const definition = { baseUrl: args[1]!, plugin: values.plugin, ready: values.ready, scope: values.scope };
  const file = saveLibrary(process.cwd(), args[0]!, definition);
  writeStdout(`${JSON.stringify(file)}\n`);
}

async function runLibraryListCommand(args: string[]): Promise<void> {
  if (args.length > 1) {
    throw new UsageError("library list takes one library at most");
  }
  const root = process.cwd();
  if (args.length === 0) {
    writeStdout(`${JSON.stringify(readLibraries(root), null, 2)}\n`);
  } else {
    const name = args[0]!;
    readResolvedLibrary(root, name);
    const cached = readCachedCatalog(root, name);
    const entries = cached ?? await fetchLibraryCatalog({ root, name });
    writeStdout(`${JSON.stringify(entries, null, 2)}\n`);
  }
}

function runLibraryShowCommand(args: string[]): void {
  if (args.length !== 1) {
    throw new UsageError("library show needs a library");
  }
  const name = args[0]!;
  const file = readLibraries(process.cwd());
  const definition = file.libraries[name];
  if (definition === undefined) {
    throw new UsageError(`unknown library "${name}"; known libraries: ${knownNames(Object.keys(file.libraries))}`);
  }
  writeStdout(`${JSON.stringify(definition, null, 2)}\n`);
}

async function runLibraryRefreshCommand(args: string[]): Promise<void> {
  if (args.length !== 1) {
    throw new UsageError("library refresh needs a library");
  }
  const root = process.cwd();
  const entries = await fetchLibraryCatalog({ root, name: args[0]! });
  writeStdout(`${JSON.stringify(entries, null, 2)}\n`);
}

function runLibraryRemoveCommand(args: string[]): void {
  if (args.length !== 1) {
    throw new UsageError("library remove needs a library");
  }
  const file = removeLibrary(process.cwd(), args[0]!);
  writeStdout(`${JSON.stringify(file)}\n`);
}

async function runLibraryCaptureCommand(values: CaptureFlags, args: string[]): Promise<void> {
  if (args.length !== 2) {
    throw new UsageError("library capture needs a library and an entry");
  }
  rejectSetupFlag(values);
  const cwd = process.cwd();
  const target = await resolveLibraryTarget({ library: args[0]!, entry: args[1]!, root: cwd });
  const profile = readProfile(cwd);
  const paths = profilePaths(cwd);
  const input = { target, flags: values, profile, paths, cwd };
  const resolved = resolveRunOptions(input);
  const io = { stdout: writeStdout, stderr: writeStderr };
  await runCapture(resolved, io);
}

async function main(): Promise<void> {
  const { values, positionals } = parse();
  if (values.help) {
    writeStdout(HELP);
  } else if (values.version) {
    writeStdout(`${VERSION}\n`);
  } else if (positionals[0] === "config") {
    runConfigCommand(values, positionals.slice(1));
  } else if (positionals[0] === "page") {
    await runPageCommand(values, positionals.slice(1));
  } else if (positionals[0] === "library") {
    await runLibraryCommand(values, positionals.slice(1));
  } else {
    await runCaptureCommand(values, positionals);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    fail(error);
  }
}
