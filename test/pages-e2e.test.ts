import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src", "cli.ts");
const FIXTURE_PATH = join(REPO_ROOT, "test", "fixtures", "pages", "sample.html");
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-pages-e2e-test-"));
}

test(
  "captures a saved page and element through the cli with distinct outputs",
  () => {
    const cwd = scratch();
    const route = `file://${FIXTURE_PATH}`;

    const addProc = Bun.spawnSync(["bun", CLI, "page", "add", "sample", route], { cwd });
    expect(addProc.exitCode).toBe(0);

    const elementProc = Bun.spawnSync(["bun", CLI, "page", "element", "sample", "summary", "#order-summary"], { cwd });
    expect(elementProc.exitCode).toBe(0);

    const elementCapture = Bun.spawnSync(["bun", CLI, "page", "sample", "summary", "--json"], { cwd });
    expect(elementCapture.exitCode).toBe(0);

    const elementResult = JSON.parse(elementCapture.stdout.toString());
    expect(elementResult.captured).toEqual({
      kind: "page",
      page: "sample",
      element: "summary",
      setup: null,
    });
    expect(elementResult.outputPath).toMatch(/\.browsershot\/captures\/sample\/summary_[0-9_-]+\.png$/);
    expect(existsSync(elementResult.outputPath)).toBe(true);

    const elementBytes = readFileSync(elementResult.outputPath);
    expect(elementBytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);

    const pageCapture = Bun.spawnSync(["bun", CLI, "page", "sample", "--json"], { cwd });
    expect(pageCapture.exitCode).toBe(0);

    const pageResult = JSON.parse(pageCapture.stdout.toString());
    expect(pageResult.captured).toEqual({
      kind: "page",
      page: "sample",
      element: null,
      setup: null,
    });
    expect(pageResult.outputPath).toMatch(/\.browsershot\/captures\/sample\/page_[0-9_-]+\.png$/);
    expect(existsSync(pageResult.outputPath)).toBe(true);

    const pageBytes = readFileSync(pageResult.outputPath);
    expect(pageBytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);

    expect(pageResult.outputPath).not.toBe(elementResult.outputPath);
    expect(pageResult.sha256).not.toBe(elementResult.sha256);
  },
  120000,
);

test("captures a saved page element as HTML", () => {
  const cwd = scratch();
  expect(Bun.spawnSync(["bun", CLI, "page", "add", "sample", `file://${FIXTURE_PATH}`], { cwd }).exitCode).toBe(0);
  expect(Bun.spawnSync(["bun", CLI, "page", "element", "sample", "summary", "#order-summary"], { cwd }).exitCode).toBe(0);

  const proc = Bun.spawnSync(["bun", CLI, "page", "sample", "summary", "--html", "--json"], { cwd });
  expect(proc.exitCode).toBe(0);
  const result = JSON.parse(proc.stdout.toString());
  expect(result.outputPath).toMatch(/\/captures\/sample\/summary_[0-9_-]+\.html$/);
  expect(result.html).toContain("<h2>Order Summary</h2>");
  expect(result.html).not.toContain("<h1>Saved Page Sample</h1>");
}, 120000);
