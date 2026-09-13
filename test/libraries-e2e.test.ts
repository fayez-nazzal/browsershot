import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src", "cli.ts");
const FIXTURES_DIR = join(import.meta.dir, "fixtures", "libraries");
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-libraries-e2e-test-"));
}

test("captures a component library story using Storybook HTTP discovery and iframe address", () => {
  const dir = scratch();

  const addProc = Bun.spawnSync(
    ["bun", CLI, "library", "add", "ui", `file://${FIXTURES_DIR}`, "--plugin", "storybook"],
    { cwd: dir },
  );
  expect(addProc.exitCode).toBe(0);

  const captureProc = Bun.spawnSync(
    ["bun", CLI, "library", "ui", "components-button--primary", "--json"],
    { cwd: dir },
  );

  expect(captureProc.exitCode).toBe(0);

  const stdout = captureProc.stdout.toString().trim();
  const stdoutLines = stdout.split("\n");
  expect(stdoutLines.length).toBe(1);

  const result = JSON.parse(stdoutLines[0]!);
  expect(result.captured).toEqual({
    kind: "library",
    library: "ui",
    entry: "components-button--primary",
  });
  expect(result.outputPath).toMatch(
    /\.browsershot\/captures\/ui\/components-button-primary_[0-9_-]+\.png$/,
  );
  expect(existsSync(result.outputPath)).toBe(true);

  const bytes = readFileSync(result.outputPath);
  expect(bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
}, 120000);
