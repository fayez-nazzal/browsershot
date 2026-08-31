import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src", "cli.ts");
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-e2e-test-"));
}

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

test("captures a sample HTML page and validates viewport and full page screenshots", () => {
  const dir = scratch();
  const html = join(dir, "sample.html");
  const viewportOutput = join(dir, "viewport.png");
  const fullPageOutput = join(dir, "full-page.png");
  const inspectOutput = join(dir, "viewport.json");
  writeFileSync(
    html,
    `<!doctype html>
<html>
  <body style="margin: 0; font-family: sans-serif; background: #e8f0ff;">
    <main style="width: 640px; min-height: 900px; padding: 32px; box-sizing: border-box;">
      <h1>Quick Capture Sample</h1>
      <p>This page proves that the CLI captured rendered HTML.</p>
    </main>
  </body>
</html>`,
  );

  const viewport = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--width", "640", "--height", "480", "--scale", "1", "--expect-text", "Quick Capture Sample", "--inspect", "h1", "--inspect-json", inspectOutput, "--output", viewportOutput, "--json"],
    { cwd: REPO_ROOT },
  );
  const fullPage = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--width", "640", "--height", "480", "--scale", "1", "--full-page", "--expect-text", "Quick Capture Sample", "--output", fullPageOutput, "--json"],
    { cwd: REPO_ROOT },
  );

  expect(viewport.exitCode).toBe(0);
  expect(fullPage.exitCode).toBe(0);
  expect(existsSync(viewportOutput)).toBe(true);
  expect(existsSync(fullPageOutput)).toBe(true);
  expect(existsSync(inspectOutput)).toBe(true);

  const viewportResult = JSON.parse(viewport.stdout.toString());
  const fullPageResult = JSON.parse(fullPage.stdout.toString());
  expect(viewportResult.outputPath).toBe(viewportOutput);
  expect(viewportResult.bytes).toBe(readFileSync(viewportOutput).length);
  expect(viewportResult.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(viewportResult.inspected.name).toBe("Quick Capture Sample");
  expect(JSON.parse(readFileSync(inspectOutput, "utf8")).name).toBe("Quick Capture Sample");
  expect(pngSize(viewportOutput)).toEqual({ width: 640, height: 480 });
  expect(pngSize(fullPageOutput).width).toBe(640);
  expect(pngSize(fullPageOutput).height).toBeGreaterThan(480);
  expect(fullPageResult.sha256).not.toBe(viewportResult.sha256);
});
