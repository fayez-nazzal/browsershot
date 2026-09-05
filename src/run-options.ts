import { resolve } from "node:path";
import { parseActions } from "./act.ts";
import { parseBoxFlag, parseMarkerFlag, type BoxAnnotation, type MarkerAnnotation } from "./annotate.ts";
import {
  NAVIGATION_TIMEOUT_MS,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  type CaptureOptions,
} from "./capture.ts";
import { UsageError } from "./exit-codes.ts";
import { resolveOutputPath } from "./output-path.ts";
import type { ProfileConfig } from "./profile-settings.ts";
import { resolveQuickUrl, type ProfilePaths } from "./profile.ts";
import { DEFAULT_EMBED_WIDTH } from "./publish.ts";

export interface CaptureFlags {
  output?: string; group?: string; label?: string; size?: string;
  "full-page"?: boolean; delay?: string; verbose?: boolean;
  auth?: boolean; "auth-user"?: string; "auth-credentials"?: string;
  "auth-redirect"?: string; "auth-purpose"?: string;
  "no-auth"?: boolean; "no-auth-redirect"?: boolean;
  "expect-text"?: string; "expect-element"?: string; "no-expect"?: boolean;
  "allow-blank"?: boolean; "allow-status"?: boolean;
  act?: string; inspect?: string; "inspect-attr"?: string;
  "inspect-json"?: string; "inspect-note"?: string;
  box?: string[]; marker?: string[];
  json?: boolean; "no-json"?: boolean;
  "auto-open"?: boolean; "no-auto-open"?: boolean;
  publish?: string; "publish-size"?: string; "publish-label"?: string;
}

type CaptureRunOptions = Omit<CaptureOptions, "cookiesPath" | "log">;

export interface ResolvedRunOptions {
  cwd: string;
  capture: CaptureRunOptions;
  auth: { requested: boolean; credentialsPath?: string; user?: string };
  outputPath: string;
  inspectJsonPath?: string;
  annotations: { boxes: BoxAnnotation[]; markers: MarkerAnnotation[] };
  publish: { destination: string; size: number; label?: string } | null;
  report: { json: boolean; autoOpen: boolean };
}

export interface ResolveRunOptionsInput {
  positional: string;
  flags: Readonly<CaptureFlags>;
  profile: Readonly<ProfileConfig>;
  paths: ProfilePaths;
  cwd: string;
  now?: Date;
}

interface Expectations {
  text?: string;
  element?: string;
}

type ResolvedAuth = ResolvedRunOptions["auth"];
type ResolvedPublish = ResolvedRunOptions["publish"];

function usageError(error: unknown): UsageError {
  if (error instanceof UsageError) return error;
  if (error instanceof Error) return new UsageError(error.message);
  return new UsageError(String(error));
}

function nonEmptyFlag(name: string, value: string | undefined): string | undefined {
  if (value !== undefined && value.trim() === "") {
    throw new UsageError(`--${name} needs a non-empty value`);
  }
  return value;
}

function validateConflicts(flags: Readonly<CaptureFlags>): void {
  if (flags["no-auth"] === true && (
    flags.auth === true || flags["auth-user"] !== undefined || flags["auth-credentials"] !== undefined
  )) {
    throw new UsageError("conflict between --no-auth and positive auth options");
  }
  if (flags["no-auth-redirect"] === true && flags["auth-redirect"] !== undefined) {
    throw new UsageError("conflict between --no-auth-redirect and --auth-redirect");
  }
  if (flags["no-expect"] === true && (
    flags["expect-text"] !== undefined || flags["expect-element"] !== undefined
  )) {
    throw new UsageError("conflict between --no-expect and positive expectation options");
  }
  if (flags["no-json"] === true && flags.json === true) {
    throw new UsageError("conflict between --no-json and --json");
  }
  if (flags["no-auto-open"] === true && flags["auto-open"] === true) {
    throw new UsageError("conflict between --no-auto-open and --auto-open");
  }
  if (flags.output !== undefined && (flags.group !== undefined || flags.label !== undefined)) {
    throw new UsageError("--output cannot be combined with --group or --label");
  }
}

function validateRemovedFlags(flags: Readonly<CaptureFlags>): void {
  if (flags["auth-purpose"] !== undefined) {
    throw new UsageError("--auth-purpose was removed — use --auth-user");
  }
}

function validateRequiredTextFlags(flags: Readonly<CaptureFlags>): void {
  nonEmptyFlag("auth-user", flags["auth-user"]);
  nonEmptyFlag("auth-credentials", flags["auth-credentials"]);
  nonEmptyFlag("auth-redirect", flags["auth-redirect"]);
  nonEmptyFlag("expect-text", flags["expect-text"]);
  nonEmptyFlag("expect-element", flags["expect-element"]);
  nonEmptyFlag("output", flags.output);
  nonEmptyFlag("group", flags.group);
  nonEmptyFlag("label", flags.label);
  if (flags.inspect !== undefined && flags.inspect.trim() === "") {
    throw new UsageError("--inspect needs a CSS selector");
  }
}

function positiveInteger(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new UsageError(`--${name} must be a positive integer`);
  }
  return value;
}

function requiredSize(value: string): { width: number; height: number } {
  const size = parseSize(value);
  if (size === null) {
    throw new UsageError(`--size must look like WxH (e.g. 1920x1080), got "${value}"`);
  }
  return size;
}

function resolveExpectations(
  flags: Readonly<CaptureFlags>,
  profile: Readonly<ProfileConfig>,
): Expectations {
  if (flags["no-expect"] === true) return {};
  if (flags["expect-text"] !== undefined || flags["expect-element"] !== undefined) {
    return { text: flags["expect-text"], element: flags["expect-element"] };
  }
  return { text: profile.expectText, element: profile.expectElement };
}

function resolveAuth(
  flags: Readonly<CaptureFlags>,
  profile: Readonly<ProfileConfig>,
): ResolvedAuth {
  if (flags["no-auth"] === true) return { requested: false };
  const credentialsPath = flags["auth-credentials"];
  const user = flags["auth-user"] ?? profile.authUser;
  const requested = flags.auth === true || credentialsPath !== undefined || user !== undefined;
  if (!requested) return { requested: false };
  return { requested: true, credentialsPath, user };
}

function resolveAuthRedirect(
  flags: Readonly<CaptureFlags>,
  profile: Readonly<ProfileConfig>,
): string | undefined {
  if (flags["no-auth-redirect"] === true) return undefined;
  return flags["auth-redirect"] ?? profile.authRedirect;
}

function resolveRunOutput(
  flags: Readonly<CaptureFlags>,
  profile: Readonly<ProfileConfig>,
  paths: ProfilePaths,
  cwd: string,
  url: string,
  now?: Date,
): string {
  const explicitOutput = flags.output !== undefined;
  const explicitStructuredOutput = flags.group !== undefined || flags.label !== undefined;
  const selectedOutput = explicitOutput
    ? flags.output
    : explicitStructuredOutput ? undefined : profile.output;
  const output = selectedOutput === undefined ? undefined : resolve(cwd, selectedOutput);
  return resolveOutputPath({
    capturesDirectory: paths.captures,
    url,
    output,
    group: explicitOutput ? undefined : flags.group ?? profile.group,
    label: explicitOutput ? undefined : flags.label ?? profile.label,
    now,
  });
}

function resolvePublish(
  flags: Readonly<CaptureFlags>,
  profile: Readonly<ProfileConfig>,
): ResolvedPublish {
  const size = flags["publish-size"] === undefined
    ? DEFAULT_EMBED_WIDTH
    : positiveInteger("publish-size", flags["publish-size"]);
  const destination = resolvePublishDestination(flags.publish ?? null, profile.publish);
  if (destination === null) return null;
  return { destination, size, label: flags["publish-label"] };
}

function resolveInspect(flags: Readonly<CaptureFlags>): CaptureRunOptions["inspect"] {
  if (flags.inspect === undefined) return undefined;
  return {
    selector: flags.inspect,
    attr: flags["inspect-attr"],
    timeoutMs: NAVIGATION_TIMEOUT_MS,
  };
}

export function normalizeUrl(url: string): string {
  let result = `https://${url}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) result = url;
  if (/^(about|data|blob|view-source|chrome|javascript):/i.test(url)) result = url;
  return result;
}

export function parseSize(value: string): { width: number; height: number } | null {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (match === null) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function resolveCaptureUrl(
  positional: string,
  profile: Readonly<ProfileConfig>,
): string {
  try {
    if (positional.startsWith("/")) {
      if (profile.baseUrl == null) {
        throw new UsageError("quick capture needs a saved baseUrl; run: browsershot config set baseUrl <url>");
      }
      return resolveQuickUrl(profile.baseUrl, positional);
    }
    return normalizeUrl(positional);
  } catch (error) {
    throw usageError(error);
  }
}

export function resolvePublishDestination(
  explicit: string | null,
  saved?: string,
): string | null {
  if (explicit === null) return null;
  if (explicit !== "") return explicit;
  if (saved == null || saved.trim() === "") {
    throw new UsageError("bare --publish needs a saved destination; run: browsershot config set publish <dest>");
  }
  return saved;
}

export function resolveRunOptions(input: ResolveRunOptionsInput): ResolvedRunOptions {
  try {
    const { flags, profile } = input;
    validateConflicts(flags);
    validateRemovedFlags(flags);
    validateRequiredTextFlags(flags);
    const url = resolveCaptureUrl(input.positional, profile);
    const expectations = resolveExpectations(flags, profile);
    const auth = resolveAuth(flags, profile);
    const outputPath = resolveRunOutput(flags, profile, input.paths, input.cwd, url, input.now);
    const publish = resolvePublish(flags, profile);
    const viewport = flags.size === undefined
      ? { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }
      : requiredSize(flags.size);
    const inspect = resolveInspect(flags);

    return {
      cwd: input.cwd,
      capture: {
        url,
        viewport,
        fullPage: flags["full-page"] === true,
        delayMs: flags.delay === undefined ? 0 : positiveInteger("delay", flags.delay),
        allowBlank: flags["allow-blank"] === true,
        allowStatus: flags["allow-status"] === true,
        authRedirect: resolveAuthRedirect(flags, profile),
        expectText: expectations.text,
        expectElement: expectations.element,
        actions: flags.act === undefined ? undefined : parseActions(flags.act),
        inspect,
        inspectFooter: flags["inspect-note"],
        verbose: flags.verbose === true,
      },
      auth,
      outputPath,
      inspectJsonPath: flags["inspect-json"],
      annotations: {
        boxes: (flags.box ?? []).map(parseBoxFlag),
        markers: (flags.marker ?? []).map(parseMarkerFlag),
      },
      publish,
      report: {
        json: flags["no-json"] === true ? false : flags.json === true || profile.json === true,
        autoOpen: flags["no-auto-open"] === true
          ? false
          : flags["auto-open"] === true || profile.autoOpen === true,
      },
    };
  } catch (error) {
    throw usageError(error);
  }
}
