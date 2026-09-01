import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-profile-cli-test-"));
}

function run(root: string, ...args: string[]) {
  return Bun.spawnSync(["bun", CLI, ...args], { cwd: root });
}

test("config commands set show path and unset saved values", () => {
  const root = scratch();

  expect(run(root, "config", "set", "url", "http://localhost:8990/app").exitCode).toBe(0);
  expect(run(root, "config", "set", "json").exitCode).toBe(0);
  expect(run(root, "config", "show").stdout.toString()).toContain('"json": true');
  expect(run(root, "config", "path").stdout.toString()).toBe(`${join(realpathSync(root), ".browsershot", "config.json")}\n`);
  expect(run(root, "config", "unset", "json").exitCode).toBe(0);
  expect(run(root, "config", "show").stdout.toString()).not.toContain('"json"');
});

test("quick capture errors before browser launch when the saved URL is missing", () => {
  const root = scratch();

  const result = run(root, "/clients-needing-attention");

  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("quick capture needs a saved url");
});

test("invalid configuration is a usage error", () => {
  const root = scratch();
  expect(run(root, "config", "set", "unknown", "value").exitCode).toBe(2);
  expect(run(root, "config", "set", "url", "not a url").exitCode).toBe(2);
});
