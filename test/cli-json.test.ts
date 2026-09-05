import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("group and label compose the default output path", () => {
  const dir = scratch();
  const html = writeSamplePage(dir);

  const proc = Bun.spawnSync([
    "bun", CLI, `file://${html}`, "--size", "640x480",
    "--group", "review/{date}", "--label", "menu open", "--json",
  ], { cwd: dir });

  expect(proc.exitCode).toBe(0);
  const outputPath = JSON.parse(proc.stdout.toString()).outputPath as string;
  expect(outputPath).toMatch(/\/\.browsershot\/captures\/review\/\d{4}-\d{2}-\d{2}\/file\/.*_menu-open_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
  expect(existsSync(outputPath)).toBe(true);
}, 120000);

test("output templates expand in an exact destination", () => {
  const dir = scratch();
  const html = writeSamplePage(dir);

  const proc = Bun.spawnSync([
    "bun", CLI, `file://${html}`, "--size", "640x480",
    "--output", "custom/{host}/{route}_{date}.png", "--json",
  ], { cwd: dir });

  expect(proc.exitCode).toBe(0);
  const outputPath = JSON.parse(proc.stdout.toString()).outputPath as string;
  expect(outputPath).toMatch(/\/custom\/file\/.*_\d{4}-\d{2}-\d{2}\.png$/);
  expect(existsSync(outputPath)).toBe(true);
}, 120000);

test("explicit output conflicts with explicit group or label before capture", () => {
  const dir = scratch();
  const result = Bun.spawnSync(["bun", CLI, "https://example.com", "--output", "shot.png", "--label", "menu"], { cwd: dir });
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("--output cannot be combined");
});

test("unknown output placeholders fail before capture", () => {
  const dir = scratch();
  const result = Bun.spawnSync(["bun", CLI, "https://example.com", "--output", "{timstamp}.png"], { cwd: dir });
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("unknown output placeholder: {timstamp}");
});

test("invalid saved naming fails for complete URLs instead of being ignored", () => {
  const dir = scratch();
  mkdirSync(join(dir, ".browsershot"));
  writeFileSync(join(dir, ".browsershot", "config.json"), '{"output":"{timstamp}.png"}\n');
  const result = Bun.spawnSync(["bun", CLI, "https://example.com"], { cwd: dir });
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("unknown output placeholder");
});
