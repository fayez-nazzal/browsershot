import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  profilePaths,
  readProfile,
  resolveQuickUrl,
  writeProfile,
  type ProfileConfig,
} from "../src/profile.ts";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-profile-test-"));
}

test("profile write and read preserve saved settings", () => {
  const root = scratch();
  const config: ProfileConfig = {
    baseUrl: "http://localhost:8990/app#/workspaces/8",
    authUser: "test-user",
    authRedirect: "/users/sign_in",
    expectText: "DocClever",
    output: "/tmp/docclever.png",
    json: true,
    autoOpen: true,
    publish: "gdrive:PR-Shots/myrepo/mybranch/",
  };

  writeProfile(root, config);

  expect(readProfile(root)).toEqual(config);
  expect(existsSync(profilePaths(root).config)).toBe(true);
  expect(readFileSync(profilePaths(root).config, "utf8")).toContain('"authUser"');
  expect(readFileSync(profilePaths(root).config, "utf8")).toContain('"authRedirect"');
});

test("profile preserves structured output group and label settings", () => {
  const root = scratch();
  const config: ProfileConfig = { baseUrl: "https://example.com", group: "PR-123", label: "approved" };
  writeProfile(root, config);
  expect(readProfile(root)).toEqual(config);
});

test("profile rejects a full output override combined with structured naming", () => {
  const root = scratch();
  expect(() => writeProfile(root, { output: "shot.png", group: "PR-123" })).toThrow("output cannot be combined");
  expect(() => writeProfile(root, { output: "shot.png", label: "approved" })).toThrow("output cannot be combined");
});

test("profile rejects unknown output placeholders when saved", () => {
  const root = scratch();
  expect(() => writeProfile(root, { label: "{timstamp}" })).toThrow("unknown output placeholder");
});

test("profile rejects structured names that cannot produce safe paths", () => {
  const root = scratch();
  expect(() => writeProfile(root, { group: "/absolute" })).toThrow("relative path");
  expect(() => writeProfile(root, { group: "../escape" })).toThrow("stay inside");
  expect(() => writeProfile(root, { label: "menu/open" })).toThrow("path separators");
  expect(() => writeProfile(root, { label: "..." })).toThrow("filename-safe text");
});

test("quick paths append inside hash routes and preserve the query", () => {
  expect(resolveQuickUrl("http://localhost:8990/app?organizationId=8#/workspaces/8", "/clients-needing-attention")).toBe(
    "http://localhost:8990/app?organizationId=8#/workspaces/8/clients-needing-attention",
  );
});

test("quick paths append to the pathname without a hash route", () => {
  expect(resolveQuickUrl("http://localhost:8990/app?organizationId=8", "clients")).toBe(
    "http://localhost:8990/app/clients?organizationId=8",
  );
});

test("invalid quick paths are rejected", () => {
  expect(() => resolveQuickUrl("http://localhost:8990/app", "?query")).toThrow();
});

test("legacy url is normalized in memory without rewriting the file", () => {
  const root = scratch();
  mkdirSync(profilePaths(root).directory, { recursive: true });
  const raw = { url: "https://legacy.example/app", authUser: "member", expectText: "Example" };
  writeFileSync(profilePaths(root).config, JSON.stringify(raw));
  const before = readFileSync(profilePaths(root).config, "utf8");
  expect(readProfile(root)).toEqual({ baseUrl: raw.url, authUser: "member", expectText: "Example" });
  expect(readFileSync(profilePaths(root).config, "utf8")).toBe(before);
});

test("canonical baseUrl wins over legacy url", () => {
  const root = scratch();
  mkdirSync(profilePaths(root).directory, { recursive: true });
  writeFileSync(profilePaths(root).config, JSON.stringify({ url: "https://legacy.example", baseUrl: "https://canonical.example" }));
  expect(readProfile(root).baseUrl).toBe("https://canonical.example");
});
