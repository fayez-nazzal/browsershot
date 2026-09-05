import { expect, test } from "bun:test";
import { timestamp, normalizeUrl, parseSize, resolvePublishDest, sha256Hex, normalizeArgv, resolveCaptureUrl, resolveRunDefaults } from "../src/cli.ts";

test("timestamp matches YYYYMMDD-HHMMSS", () => {
  expect(timestamp()).toMatch(/^\d{8}-\d{6}$/);
});

test("normalizeUrl prepends https:// when no scheme", () => {
  expect(normalizeUrl("example.com")).toBe("https://example.com");
  expect(normalizeUrl("example.com/path?q=1")).toBe("https://example.com/path?q=1");
});

test("normalizeUrl leaves explicit schemes untouched", () => {
  expect(normalizeUrl("https://example.com")).toBe("https://example.com");
  expect(normalizeUrl("http://localhost:3000")).toBe("http://localhost:3000");
  expect(normalizeUrl("file:///tmp/x.html")).toBe("file:///tmp/x.html");
});

test("parseSize parses WxH", () => {
  expect(parseSize("1920x1080")).toEqual({ width: 1920, height: 1080 });
  expect(parseSize(" 800x600 ")).toEqual({ width: 800, height: 600 });
  expect(parseSize("1024X768")).toEqual({ width: 1024, height: 768 });
});

test("parseSize rejects malformed input", () => {
  expect(parseSize("1920")).toBeNull();
  expect(parseSize("1920*1080")).toBeNull();
  expect(parseSize("axb")).toBeNull();
  expect(parseSize("")).toBeNull();
});

test("sha256Hex hashes bytes to lowercase hex", () => {
  const empty = sha256Hex(new Uint8Array());
  expect(empty).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const abc = sha256Hex(new TextEncoder().encode("abc"));
  expect(abc).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("sha256Hex distinguishes different byte payloads", () => {
  const a = sha256Hex(new TextEncoder().encode("page-a"));
  const b = sha256Hex(new TextEncoder().encode("page-b"));
  expect(a).not.toBe(b);
});

test("normalizeUrl leaves single-colon browser schemes untouched", () => {
  expect(normalizeUrl("about:blank")).toBe("about:blank");
  expect(normalizeUrl("data:text/html,<p>hi</p>")).toBe("data:text/html,<p>hi</p>");
});

test("normalizeUrl still prefixes host:port shorthand", () => {
  expect(normalizeUrl("localhost:3000")).toBe("https://localhost:3000");
});

test("normalizeArgv merges a bare --publish value into = form", () => {
  expect(normalizeArgv(["--publish", "gdrive:dir/"])).toEqual(["--publish=gdrive:dir/"]);
  expect(normalizeArgv(["url", "--publish", "gdrive:dir/", "--json"])).toEqual(["url", "--publish=gdrive:dir/", "--json"]);
});

test("normalizeArgv keeps a bare --publish as an empty = form", () => {
  expect(normalizeArgv(["--publish"])).toEqual(["--publish="]);
  expect(normalizeArgv(["--publish", "--json"])).toEqual(["--publish=", "--json"]);
  expect(normalizeArgv(["--publish=one"])).toEqual(["--publish=one"]);
});

test("resolvePublishDest prefers the explicit destination", () => {
  expect(resolvePublishDest("gdrive:explicit/dir/", "gdrive:saved/dir/")).toBe("gdrive:explicit/dir/");
});

test("resolvePublishDest falls back to the saved publish key", () => {
  expect(resolvePublishDest("", "gdrive:saved/dir/")).toBe("gdrive:saved/dir/");
});

test("resolvePublishDest rejects a bare --publish with no saved key", () => {
  expect(() => resolvePublishDest("", undefined)).toThrow("config set publish");
  expect(() => resolvePublishDest("", " ")).toThrow("config set publish");
});

test("resolvePublishDest returns null when publish is not requested", () => {
  expect(resolvePublishDest(null, "gdrive:saved/dir/")).toBeNull();
  expect(resolvePublishDest(null, undefined)).toBeNull();
});

test("resolveCaptureUrl keeps complete URLs independent of the saved base", () => {
  const profile = { baseUrl: "https://example.com/app" };
  expect(resolveCaptureUrl("https://other.example/pricing", {})).toBe("https://other.example/pricing");
  expect(resolveCaptureUrl("https://other.example/pricing", profile)).toBe("https://other.example/pricing");
  expect(resolveCaptureUrl("/pricing", profile)).toBe("https://example.com/app/pricing");
  expect(() => resolveCaptureUrl("/pricing", {})).toThrow(/baseUrl/);
});

test("resolveRunDefaults applies saved settings and per-run replacements", () => {
  const profile = { baseUrl: "https://example.com/app", authUser: "member", expectText: "Header", expectElement: "#header", json: true, autoOpen: true };
  expect(resolveRunDefaults({ "expect-element": "#standalone" }, profile)).toMatchObject({ expectElement: "#standalone", expectText: undefined });
  expect(resolveRunDefaults({}, profile)).toMatchObject({ expectText: "Header", expectElement: "#header", authRequested: true, json: true, autoOpen: true });
  expect(resolveRunDefaults({ "no-auth": true, "no-expect": true, "no-json": true, "no-auto-open": true }, profile)).toMatchObject({ authRequested: false, expectText: undefined, expectElement: undefined, json: false, autoOpen: false });
  expect(resolveRunDefaults({ "auth-credentials": "/tmp/creds" }, profile)).toMatchObject({ authUser: "member", authRequested: true, authCredentials: "/tmp/creds" });
});

test("resolveRunDefaults rejects contradictory or empty options", () => {
  expect(() => resolveRunDefaults({ "no-auth": true, "auth-user": "admin" }, {})).toThrow(/conflict/);
  expect(() => resolveRunDefaults({ "no-expect": true, "expect-text": "Ready" }, {})).toThrow(/conflict/);
  expect(() => resolveRunDefaults({ json: true, "no-json": true }, {})).toThrow(/conflict/);
  expect(() => resolveRunDefaults({ "auto-open": true, "no-auto-open": true }, {})).toThrow(/conflict/);
  expect(() => resolveRunDefaults({ "expect-text": "  " }, {})).toThrow(/non-empty/);
  expect(() => resolveRunDefaults({ "expect-element": "  " }, {})).toThrow(/non-empty/);
});
