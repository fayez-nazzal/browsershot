import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
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

test("canonical and legacy config aliases write canonical settings", () => {
  const root = scratch();
  expect(run(root, "config", "set", "url", "https://legacy.example").exitCode).toBe(0);
  expect(run(root, "config", "set", "expect-element", "#header").exitCode).toBe(0);
  const shown = run(root, "config", "show").stdout.toString();
  expect(shown).toContain('"baseUrl": "https://legacy.example"');
  expect(shown).toContain('"expectElement": "#header"');
  expect(run(root, "config", "unset", "url").exitCode).toBe(0);
  expect(run(root, "config", "show").stdout.toString()).not.toContain("baseUrl");
});

test("publish key round-trips through config set show and unset", () => {
  const root = scratch();

  expect(run(root, "config", "set", "publish", "gdrive:PR-Shots/myrepo/mybranch/").exitCode).toBe(0);
  expect(run(root, "config", "show").stdout.toString()).toContain('"publish": "gdrive:PR-Shots/myrepo/mybranch/"');
  expect(run(root, "config", "unset", "publish").exitCode).toBe(0);
  expect(run(root, "config", "show").stdout.toString()).not.toContain('"publish"');
});

test("group and label round-trip through config commands", () => {
  const root = scratch();
  expect(run(root, "config", "set", "group", "PR-123").exitCode).toBe(0);
  expect(run(root, "config", "set", "label", "menu-open").exitCode).toBe(0);
  const shown = run(root, "config", "show").stdout.toString();
  expect(shown).toContain('"group": "PR-123"');
  expect(shown).toContain('"label": "menu-open"');
});

test("saved output cannot be mixed with group or label", () => {
  const root = scratch();
  expect(run(root, "config", "set", "output", "shot.png").exitCode).toBe(0);
  const result = run(root, "config", "set", "group", "PR-123");
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("output cannot be combined");
});

test("config commands do not save unsafe structured names", () => {
  const root = scratch();
  expect(run(root, "config", "set", "group", "/absolute").exitCode).toBe(2);
  expect(run(root, "config", "set", "group", "../escape").exitCode).toBe(2);
  expect(run(root, "config", "set", "label", "menu/open").exitCode).toBe(2);
});

test("quick capture errors before browser launch when the saved URL is missing", () => {
  const root = scratch();

  const result = run(root, "/clients-needing-attention");

  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("quick capture needs a saved baseUrl");
});

test("invalid configuration is a usage error", () => {
  const root = scratch();
  expect(run(root, "config", "set", "unknown", "value").exitCode).toBe(2);
  expect(run(root, "config", "set", "url", "not a url").exitCode).toBe(2);
});

test("malformed project config blocks quick routes and complete URLs before workspace mutation", () => {
  for (const positional of ["/pricing", "https://example.com/pricing"]) {
    const root = scratch();
    const directory = join(root, ".browsershot");
    mkdirSync(directory);
    writeFileSync(join(directory, "config.json"), "{broken");
    const result = run(root, positional);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("malformed profile config");
    expect(existsSync(join(directory, ".gitignore"))).toBe(false);
    expect(existsSync(join(directory, "tmp"))).toBe(false);
    expect(existsSync(join(directory, "captures"))).toBe(false);
  }
});

test("unknown saved settings block quick routes and complete URLs before workspace mutation", () => {
  for (const positional of ["/pricing", "https://example.com/pricing"]) {
    const root = scratch();
    const directory = join(root, ".browsershot");
    mkdirSync(directory);
    writeFileSync(join(directory, "config.json"), JSON.stringify({ mystery: true }));
    const result = run(root, positional);
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("unknown profile setting: mystery");
    expect(existsSync(join(directory, ".gitignore"))).toBe(false);
    expect(existsSync(join(directory, "tmp"))).toBe(false);
    expect(existsSync(join(directory, "captures"))).toBe(false);
  }
});
