import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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
    url: "http://localhost:8990/app#/workspaces/8",
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
