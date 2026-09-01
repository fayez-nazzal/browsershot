import { expect, test } from "bun:test";
import { timestamp, normalizeUrl, parseSize, PRESETS, gifOutputPath, sha256Hex, normalizeArgv } from "../src/cli.ts";

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

test("PRESETS cover desktop, laptop, and phone with exact sizes", () => {
  expect(PRESETS.desktop).toEqual({ width: 1920, height: 1080 });
  expect(PRESETS.laptop).toEqual({ width: 1440, height: 900 });
  expect(PRESETS.phone).toEqual({ width: 390, height: 844 });
  expect(Object.keys(PRESETS)).toEqual(["desktop", "laptop", "phone"]);
});

test("gifOutputPath swaps a .png extension for .gif", () => {
  expect(gifOutputPath("/a/b/shot.png")).toBe("/a/b/shot.gif");
  expect(gifOutputPath("/a/b/shot.PNG")).toBe("/a/b/shot.gif");
});

test("gifOutputPath appends .gif when there is no .png extension", () => {
  expect(gifOutputPath("/a/b/shot")).toBe("/a/b/shot.gif");
  expect(gifOutputPath("/a/b/shot.jpeg")).toBe("/a/b/shot.jpeg.gif");
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

test("normalizeArgv merges a dash-leading --html-class value into = form", () => {
  expect(normalizeArgv(["--html-class", "-light,dark"])).toEqual(["--html-class=-light,dark"]);
  expect(normalizeArgv(["url", "--html-class", "-light,dark", "-o", "x.png"])).toEqual(["url", "--html-class=-light,dark", "-o", "x.png"]);
});

test("normalizeArgv leaves plain values and other flags alone", () => {
  expect(normalizeArgv(["--html-class", "dark"])).toEqual(["--html-class", "dark"]);
  expect(normalizeArgv(["--html-class=-light,dark"])).toEqual(["--html-class=-light,dark"]);
  expect(normalizeArgv(["--wait", "networkidle"])).toEqual(["--wait", "networkidle"]);
});
