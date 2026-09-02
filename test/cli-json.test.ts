import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptySuccess } from "../src/cli.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src", "cli.ts");

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-json-test-"));
}

function writeSamplePage(dir: string): string {
  const html = join(dir, "sample.html");
  writeFileSync(
    html,
    `<!doctype html>
<html>
  <body style="margin: 0; font-family: sans-serif;">
    <main style="padding: 32px;">
      <h1>JSON Mode Sample</h1>
      <p>This page proves the CLI captured rendered HTML for the json contract.</p>
    </main>
  </body>
</html>`,
  );
  return html;
}

test("emptySuccess carries every success key, all null", () => {
  expect(Object.keys(emptySuccess())).toEqual([
    "outputPath",
    "bytes",
    "sha256",
    "inspectJsonPath",
    "inspected",
    "publishedUrl",
  ]);
  expect(Object.values(emptySuccess()).every((value) => value === null)).toBe(true);
});

test("--json prints exactly one JSON object on stdout and keeps human lines on stderr", () => {
  const dir = scratch();
  const html = writeSamplePage(dir);
  const out = join(dir, "shot.png");

  const proc = Bun.spawnSync(["bun", CLI, `file://${html}`, "--size", "640x480", "--output", out, "--json"], { cwd: dir });

  expect(proc.exitCode).toBe(0);
  const stdout = proc.stdout.toString();
  expect(stdout.trimEnd().split("\n").length).toBe(1);
  const parsed = JSON.parse(stdout);
  expect(parsed.outputPath).toBe(out);
  expect(parsed.bytes).toBeGreaterThan(0);
  expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(parsed.inspectJsonPath).toBeNull();
  expect(parsed.inspected).toBeNull();
  expect(parsed.publishedUrl).toBeNull();
  expect(proc.stderr.toString()).toContain("browsershot: wrote ");
}, 120000);

test("without --json the first stdout line is the absolute output path", () => {
  const dir = scratch();
  const html = writeSamplePage(dir);

  const proc = Bun.spawnSync(["bun", CLI, `file://${html}`, "--size", "640x480", "--output", "shot.png"], { cwd: dir });

  expect(proc.exitCode).toBe(0);
  const first = proc.stdout.toString().split("\n")[0]!;
  expect(first.startsWith("/")).toBe(true);
  expect(first.endsWith("/shot.png")).toBe(true);
  expect(existsSync(first)).toBe(true);
}, 120000);

