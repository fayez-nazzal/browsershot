import { expect, test } from "bun:test";
import { UsageError } from "../src/exit-codes.ts";
import {
  normalizeUrl,
  parseSize,
  resolveCaptureUrl,
  resolvePublishDestination,
  resolveRunOptions,
  type CaptureFlags,
} from "../src/run-options.ts";

const now = new Date(2026, 8, 5, 14, 30, 12);
const paths = {
  directory: "/repo/.browsershot",
  config: "/repo/.browsershot/config.json",
  captures: "/repo/.browsershot/captures",
};

function resolve(positional: string, flags: CaptureFlags = {}, profile = {}) {
  return resolveRunOptions({ positional, flags, profile, paths, cwd: "/repo", now });
}

test("built-in defaults produce a complete execution model", () => {
  expect(resolve("https://example.com/pricing")).toMatchObject({
    cwd: "/repo",
    outputPath: "/repo/.browsershot/captures/example.com/pricing_2026-09-05_14-30-12.png",
    capture: {
      url: "https://example.com/pricing",
      viewport: { width: 1440, height: 900 },
      fullPage: false,
      delayMs: 0,
      allowBlank: false,
      allowStatus: false,
      verbose: false,
    },
    auth: { requested: false },
    publish: null,
    report: { json: false, autoOpen: false },
    annotations: { boxes: [], markers: [] },
  });
});

test("saved defaults and explicit replacements resolve once", () => {
  const profile = {
    baseUrl: "https://example.com/app", authUser: "member", authRedirect: "/login",
    expectText: "Header", expectElement: "#header", json: true, autoOpen: true,
    output: "saved.png", publish: "gdrive:saved/",
  };
  const result = resolve("/pricing", {
    "expect-element": "#ready", "auth-credentials": "/tmp/creds.yaml",
    output: "explicit.png", publish: "gdrive:explicit/", "publish-size": "1200",
  }, profile);
  expect(result.capture).toMatchObject({
    url: "https://example.com/app/pricing", expectElement: "#ready", expectText: undefined,
  });
  expect(result.auth).toEqual({ requested: true, credentialsPath: "/tmp/creds.yaml", user: "member" });
  expect(result.outputPath).toBe("/repo/explicit.png");
  expect(result.publish).toEqual({ destination: "gdrive:explicit/", size: 1200, label: undefined });
  expect(result.report).toEqual({ json: true, autoOpen: true });
});

test("negative flags disable saved state and conflict with explicit positives", () => {
  const profile = { authUser: "member", authRedirect: "/login", expectText: "Header", json: true, autoOpen: true };
  expect(resolve("https://example.com", {
    "no-auth": true, "no-auth-redirect": true, "no-expect": true,
    "no-json": true, "no-auto-open": true,
  }, profile)).toMatchObject({
    auth: { requested: false },
    capture: { authRedirect: undefined, expectText: undefined, expectElement: undefined },
    report: { json: false, autoOpen: false },
  });
  const conflicts: CaptureFlags[] = [
    { "no-auth": true, auth: true },
    { "no-auth": true, "auth-user": "admin" },
    { "no-auth": true, "auth-credentials": "creds.yaml" },
    { "no-auth-redirect": true, "auth-redirect": "/login" },
    { "no-expect": true, "expect-text": "Ready" },
    { "no-expect": true, "expect-element": "#ready" },
    { "no-json": true, json: true },
    { "no-auto-open": true, "auto-open": true },
    { output: "shot.png", label: "menu" },
    { output: "shot.png", group: "review" },
  ];
  for (const flags of conflicts) expect(() => resolve("https://example.com", flags)).toThrow(UsageError);
});

test("equivalent quick and complete URLs produce the same normalized model", () => {
  const profile = { baseUrl: "https://example.com/app", group: "review", label: "menu", authUser: "member" };
  const cases: CaptureFlags[] = [
    {},
    {
      size: "800x600", delay: "25", "full-page": true, verbose: true,
      auth: true, "auth-user": "admin", "auth-credentials": "/tmp/creds.yaml",
      "auth-redirect": "/login", "expect-text": "Ready", "expect-element": "#ready",
      "allow-status": true, "allow-blank": true, act: "click:#menu", inspect: "#menu",
      "inspect-attr": "aria-expanded", "inspect-json": "/tmp/element.json",
      "inspect-note": "state", box: ["1,2,3,4"], marker: ["5,6"], json: true,
      "auto-open": true, publish: "gdrive:shots/", "publish-size": "1200",
      "publish-label": "Menu",
    },
    { group: "explicit-group", label: "explicit-label" },
    {
      "no-auth": true, "no-auth-redirect": true, "no-expect": true,
      "no-json": true, "no-auto-open": true,
    },
    { "no-auth": true, output: "same.png" },
  ];
  for (const flags of cases) {
    expect(resolve("/pricing", flags, profile))
      .toEqual(resolve("https://example.com/app/pricing", flags, profile));
  }
});

test("resolution does not mutate flags or profile", () => {
  const flags: CaptureFlags = { "expect-element": "#ready", box: ["1,2,3,4"] };
  const profile = { baseUrl: "https://example.com", expectText: "Saved" };
  const before = structuredClone({ flags, profile });
  resolve("/pricing", flags, profile);
  expect({ flags, profile }).toEqual(before);
});

test("all capture flag families resolve into their owned model fields", () => {
  const result = resolve("https://example.com/pricing", {
    size: "800x600", delay: "25", "full-page": true, verbose: true,
    auth: true, "auth-user": "admin", "auth-credentials": "/tmp/creds.yaml",
    "auth-redirect": "/login", "expect-text": "Ready", "expect-element": "#ready",
    "allow-status": true, "allow-blank": true, act: "click:#menu", inspect: "#menu",
    "inspect-attr": "aria-expanded", "inspect-json": "/tmp/element.json",
    "inspect-note": "", box: ["1,2,3,4"], marker: ["5,6"], json: true,
    "auto-open": true, publish: "gdrive:shots/", "publish-size": "1200",
    "publish-label": "",
  });
  expect(result).toMatchObject({
    capture: {
      viewport: { width: 800, height: 600 }, delayMs: 25, fullPage: true, verbose: true,
      authRedirect: "/login", expectText: "Ready", expectElement: "#ready",
      allowStatus: true, allowBlank: true, actions: [{ kind: "click", value: "#menu" }],
      inspect: { selector: "#menu", attr: "aria-expanded", timeoutMs: 30000 },
      inspectFooter: "",
    },
    auth: { requested: true, user: "admin", credentialsPath: "/tmp/creds.yaml" },
    inspectJsonPath: "/tmp/element.json",
    annotations: {
      boxes: [{ x: 1, y: 2, w: 3, h: 4 }],
      markers: [{ x: 5, y: 6 }],
    },
    publish: { destination: "gdrive:shots/", size: 1200, label: "" },
    report: { json: true, autoOpen: true },
  });
});

test("invalid flags and special precedence produce usage errors or overrides", () => {
  for (const flags of [
    { "auth-user": " " }, { "auth-credentials": " " }, { "auth-redirect": " " },
    { "expect-text": " " }, { "expect-element": " " }, { inspect: " " },
    { output: " " }, { group: " " }, { label: " " },
  ] satisfies CaptureFlags[]) {
    expect(() => resolve("https://example.com", flags)).toThrow(UsageError);
  }
  for (const flags of [
    { size: "wide" }, { delay: "0" }, { "publish-size": "12.5", publish: "gdrive:x/" },
  ] satisfies CaptureFlags[]) {
    expect(() => resolve("https://example.com", flags)).toThrow(UsageError);
  }
  expect(() => resolve("/pricing")).toThrow("saved baseUrl");
  expect(() => resolve("https://example.com", { output: "{timstamp}.png" })).toThrow("unknown output placeholder");
  expect(() => resolve("https://example.com", { publish: "" })).toThrow("saved destination");
  expect(resolve("https://example.com", { label: "menu" }, { output: "saved.png", label: undefined }).outputPath)
    .toContain("_menu_");
  expect(resolve("https://example.com", { output: "explicit.png" }, { group: "saved", label: "saved" }).outputPath)
    .toBe("/repo/explicit.png");
});

test("domain parser failures become usage errors at the resolver boundary", () => {
  for (const flags of [
    { act: " " },
    { box: ["1,2,3"] },
    { marker: ["5"] },
    { output: "{unknown}.png" },
  ] satisfies CaptureFlags[]) {
    expect(() => resolve("https://example.com", flags)).toThrow(UsageError);
  }
});

test("normalizeUrl preserves schemes and prefixes hostname shorthand", () => {
  expect(normalizeUrl("example.com")).toBe("https://example.com");
  expect(normalizeUrl("example.com/path?q=1")).toBe("https://example.com/path?q=1");
  expect(normalizeUrl("https://example.com")).toBe("https://example.com");
  expect(normalizeUrl("http://localhost:3000")).toBe("http://localhost:3000");
  expect(normalizeUrl("file:///tmp/x.html")).toBe("file:///tmp/x.html");
  expect(normalizeUrl("about:blank")).toBe("about:blank");
  expect(normalizeUrl("data:text/html,<p>hi</p>")).toBe("data:text/html,<p>hi</p>");
  expect(normalizeUrl("localhost:3000")).toBe("https://localhost:3000");
});

test("parseSize parses WxH and rejects malformed input", () => {
  expect(parseSize("1920x1080")).toEqual({ width: 1920, height: 1080 });
  expect(parseSize(" 800x600 ")).toEqual({ width: 800, height: 600 });
  expect(parseSize("1024X768")).toEqual({ width: 1024, height: 768 });
  expect(parseSize("1920")).toBeNull();
  expect(parseSize("1920*1080")).toBeNull();
  expect(parseSize("axb")).toBeNull();
  expect(parseSize("")).toBeNull();
});

test("resolvePublishDestination handles explicit, saved, and disabled publishing", () => {
  expect(resolvePublishDestination("gdrive:explicit/dir/", "gdrive:saved/dir/")).toBe("gdrive:explicit/dir/");
  expect(resolvePublishDestination("", "gdrive:saved/dir/")).toBe("gdrive:saved/dir/");
  expect(() => resolvePublishDestination("", undefined)).toThrow("config set publish");
  expect(() => resolvePublishDestination("", " ")).toThrow("config set publish");
  expect(resolvePublishDestination(null, "gdrive:saved/dir/")).toBeNull();
  expect(resolvePublishDestination(null, undefined)).toBeNull();
});

test("resolveCaptureUrl keeps complete URLs independent of the saved base", () => {
  const profile = { baseUrl: "https://example.com/app" };
  expect(resolveCaptureUrl("https://other.example/pricing", {})).toBe("https://other.example/pricing");
  expect(resolveCaptureUrl("https://other.example/pricing", profile)).toBe("https://other.example/pricing");
  expect(resolveCaptureUrl("/pricing", profile)).toBe("https://example.com/app/pricing");
  expect(() => resolveCaptureUrl("/pricing", {})).toThrow(/baseUrl/);
});
