import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addProfileExclude,
  profilePaths,
  readProfile,
  resolveQuickUrl,
  writeProfile,
  type ProfileConfig,
} from "../src/profile.ts";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-profile-test-"));
}

function gitProject(): string {
  const root = scratch();
  mkdirSync(join(root, ".git"));
  return root;
}

test("profile write and read preserve saved settings", () => {
  const root = gitProject();
  const config: ProfileConfig = {
    url: "http://localhost:8990/app#/workspaces/8",
    authUser: "test-user",
    expectText: "DocClever",
    output: "/tmp/docclever.png",
    json: true,
    autoOpen: true,
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

test("git exclude update is idempotent", () => {
  const root = gitProject();

  addProfileExclude(root);
  addProfileExclude(root);

  const exclude = readFileSync(join(root, ".git", "info", "exclude"), "utf8");
  expect(exclude.match(/^\.browsershot\/$/gm)).toHaveLength(1);
});

test("invalid quick paths are rejected", () => {
  expect(() => resolveQuickUrl("http://localhost:8990/app", "?query")).toThrow();
});
