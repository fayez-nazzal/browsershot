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
