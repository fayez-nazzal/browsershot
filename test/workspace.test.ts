import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createRunTmpDir, ensureWorkspace, removeRunTmpDir } from "../src/workspace.ts";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-workspace-test-"));
}

test("ensureWorkspace creates .browsershot with a self-ignoring gitignore", () => {
  const root = scratch();
  const directory = ensureWorkspace(root);
  expect(directory).toBe(join(root, ".browsershot"));
  expect(existsSync(directory)).toBe(true);
  expect(readFileSync(join(directory, ".gitignore"), "utf8")).toBe("*\n");
});

test("ensureWorkspace is idempotent and never overwrites an existing gitignore", () => {
  const root = scratch();
  ensureWorkspace(root);
  writeFileSync(join(root, ".browsershot", ".gitignore"), "custom\n");
  ensureWorkspace(root);
  expect(readFileSync(join(root, ".browsershot", ".gitignore"), "utf8")).toBe("custom\n");
});

test("createRunTmpDir makes a unique directory under .browsershot/tmp", () => {
  const root = scratch();
  const first = createRunTmpDir(root);
  const second = createRunTmpDir(root);
  expect(first).toContain(join(".browsershot", "tmp"));
  expect(second).toContain(join(".browsershot", "tmp"));
  expect(first).not.toBe(second);
  expect(existsSync(first)).toBe(true);
  expect(existsSync(second)).toBe(true);
});

test("removeRunTmpDir deletes the run directory", () => {
  const root = scratch();
  const run = createRunTmpDir(root);
  removeRunTmpDir(run);
  expect(existsSync(run)).toBe(false);
});

test("ensureWorkspace sweeps run dirs older than a day and keeps fresh ones", () => {
  const root = scratch();
  ensureWorkspace(root);
  const stale = createRunTmpDir(root);
  const fresh = createRunTmpDir(root);
  const past = new Date(Date.now() - 25 * 60 * 60 * 1000);
  utimesSync(stale, past, past);
  ensureWorkspace(root);
  expect(existsSync(stale)).toBe(false);
  expect(existsSync(fresh)).toBe(true);
});

const SRC_DIR = resolve(import.meta.dir, "../src");

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

test("src never references state outside .browsershot", () => {
  const banned = ["tmpdir", "info/exclude", "findProjectRoot", "addProfileExclude", "homedir(), \"browsershot\""];
  const offenders: string[] = [];
  for (const file of listSourceFiles(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    for (const token of banned) {
      if (source.includes(token)) {
        offenders.push(`${basename(file)}: ${token}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

test("homedir is only allowed for the Playwright cache lookup", () => {
  const offenders: string[] = [];
  for (const file of listSourceFiles(SRC_DIR)) {
    const mentionsHome = readFileSync(file, "utf8").includes("homedir");
    const isCacheLookup = basename(file) === "capture.ts";
    if (mentionsHome && !isCacheLookup) {
      offenders.push(basename(file));
    }
  }
  expect(offenders).toEqual([]);
});
