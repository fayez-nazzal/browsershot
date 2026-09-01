import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptySuccess } from "../src/cli.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src", "cli.ts");

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-json-test-"));
}

function writePair(dir: string): { before: string; after: string } {
  const before = join(dir, "before.png");
  const after = join(dir, "after.png");
  writeFileSync(before, PNG_BYTES);
  writeFileSync(after, PNG_BYTES);
  return { before, after };
}

test("emptySuccess carries every success key, all null", () => {
  expect(Object.keys(emptySuccess())).toEqual([
    "outputPath",
    "bytes",
    "sha256",
    "gifPath",
    "inspectJsonPath",
    "inspected",
    "publishedUrl",
  ]);
  expect(Object.values(emptySuccess()).every((value) => value === null)).toBe(true);
});

test("--json prints exactly one JSON object on stdout and keeps human lines on stderr", () => {
  const dir = scratch();
  const pair = writePair(dir);
  const out = join(dir, "shot.png");

  const proc = Bun.spawnSync(["bun", CLI, "--compare", `${pair.before},${pair.after}`, "--output", out, "--json"], { cwd: dir });

  expect(proc.exitCode).toBe(0);
  const stdout = proc.stdout.toString();
  expect(stdout.trimEnd().split("\n").length).toBe(1);
  const parsed = JSON.parse(stdout);
  expect(parsed.outputPath).toBe(out);
  expect(parsed.bytes).toBeGreaterThan(0);
  expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(parsed.gifPath).toBeNull();
  expect(parsed.inspectJsonPath).toBeNull();
  expect(parsed.inspected).toBeNull();
  expect(parsed.publishedUrl).toBeNull();
  expect(proc.stderr.toString()).toContain("browsershot: wrote ");
});

test("without --json the first stdout line is the absolute output path", () => {
  const dir = scratch();
  const pair = writePair(dir);

  const proc = Bun.spawnSync(["bun", CLI, "--compare", `${pair.before},${pair.after}`, "--output", "shot.png"], { cwd: dir });

  expect(proc.exitCode).toBe(0);
  const first = proc.stdout.toString().split("\n")[0]!;
  expect(first.startsWith("/")).toBe(true);
  expect(first.endsWith("/shot.png")).toBe(true);
  expect(existsSync(first)).toBe(true);
});

test("--json cannot be combined with --stdout", () => {
  const dir = scratch();
  const pair = writePair(dir);

  const proc = Bun.spawnSync(["bun", CLI, "--compare", `${pair.before},${pair.after}`, "--json", "--stdout"], { cwd: dir });

  expect(proc.exitCode).toBe(2);
});
