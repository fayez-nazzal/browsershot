import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const FIXTURES_DIR = join(import.meta.dir, "fixtures", "libraries");

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-libraries-cli-test-"));
}

function run(root: string, ...args: string[]) {
  return Bun.spawnSync(["bun", CLI, ...args], { cwd: root });
}

test("library add writes the definition and prints updated JSON", () => {
  const root = scratch();
  const proc = run(
    root,
    "library",
    "add",
    "ui",
    "https://storybook.example.test",
    "--plugin",
    "storybook",
    "--ready",
    "#root",
    "--scope",
    "#scope",
  );

  expect(proc.exitCode).toBe(0);
  const parsed = JSON.parse(proc.stdout.toString());
  expect(parsed).toEqual({
    version: 1,
    libraries: {
      ui: {
        baseUrl: "https://storybook.example.test",
        plugin: "storybook",
        ready: "#root",
        scope: "#scope",
      },
    },
  });
});

test("library add without --plugin exits 2 with a usage error", () => {
  const root = scratch();
  const proc = run(root, "library", "add", "ui", "https://storybook.example.test");

  expect(proc.exitCode).toBe(2);
  expect(proc.stderr.toString()).toContain("library add needs --plugin <name>");
});

test("library list prints mapped catalog entries from a file-backed library", () => {
  const root = scratch();
  const addProc = run(root, "library", "add", "ui", `file://${FIXTURES_DIR}`, "--plugin", "storybook");
  expect(addProc.exitCode).toBe(0);

  const listProc = run(root, "library", "list", "ui");
  expect(listProc.exitCode).toBe(0);

  const entries = JSON.parse(listProc.stdout.toString());
  expect(entries).toEqual([
    {
      id: "components-button--primary",
      group: "Components/Button",
      label: "Primary",
    },
    {
      id: "components-button--secondary",
      group: "Components/Button",
      label: "Secondary",
    },
  ]);
});

test("querying an unknown library exits 2 and lists known libraries", () => {
  const root = scratch();
  const addProc = run(root, "library", "add", "components", "https://example.test", "--plugin", "storybook");
  expect(addProc.exitCode).toBe(0);

  const listProc = run(root, "library", "list", "nonexistent");
  expect(listProc.exitCode).toBe(2);
  expect(listProc.stderr.toString()).toContain('unknown library "nonexistent"; known libraries: components');

  const emptyRoot = scratch();
  const showProc = run(emptyRoot, "library", "show", "nonexistent");
  expect(showProc.exitCode).toBe(2);
  expect(showProc.stderr.toString()).toContain('unknown library "nonexistent"; known libraries: (none)');
});

test("--plugin on a plain URL capture exits 2", () => {
  const root = scratch();
  const proc = run(root, "https://example.test", "--plugin", "storybook");

  expect(proc.exitCode).toBe(2);
  expect(proc.stderr.toString()).toContain("--plugin is only valid with library add");
});
