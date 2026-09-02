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
    ["bun", CLI, `file://${html}`, "--size", "640x480", "--expect-text", "Quick Capture Sample", "--inspect", "h1", "--inspect-json", inspectOutput, "--output", viewportOutput, "--json"],
    { cwd: dir },
  );
  const fullPage = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--size", "640x480", "--full-page", "--expect-text", "Quick Capture Sample", "--output", fullPageOutput, "--json"],
    { cwd: dir },
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
  expect(pngSize(viewportOutput)).toEqual({ width: 1280, height: 960 });
  expect(pngSize(fullPageOutput).width).toBe(1280);
  expect(pngSize(fullPageOutput).height).toBeGreaterThan(960);
  expect(fullPageResult.sha256).not.toBe(viewportResult.sha256);
});

test("bare --publish without a saved destination exits 2 before capturing", () => {
  const dir = scratch();
  const html = join(dir, "sample.html");
  const out = join(dir, "shot.png");
  writeFileSync(html, "<!doctype html><html><body><h1>Publish Sample</h1></body></html>");

  const proc = Bun.spawnSync(["bun", CLI, `file://${html}`, "--output", out, "--publish"], { cwd: dir });

  expect(proc.exitCode).toBe(2);
  expect(proc.stderr.toString()).toContain("config set publish");
  expect(existsSync(out)).toBe(false);
});

test("bare --publish resolves the saved publish profile key", () => {
  const dir = scratch();
  const html = join(dir, "sample.html");
  writeFileSync(
    html,
    `<!doctype html>
<html>
  <body style="margin: 0; font-family: sans-serif;">
    <main style="padding: 32px;">
      <h1>Publish Sample</h1>
      <p>This page proves the CLI captured rendered HTML before the publish step ran.</p>
    </main>
  </body>
</html>`,
  );
  const out = join(dir, "shot.png");
  Bun.spawnSync(["bun", CLI, "config", "set", "publish", "browsershot-nonexistent-remote-bare:some/path/"], { cwd: dir });

  const proc = Bun.spawnSync(["bun", CLI, `file://${html}`, "--output", out, "--publish"], { cwd: dir });

  expect(proc.exitCode).toBe(5);
  expect(proc.stderr.toString()).toContain("browsershot-nonexistent-remote-bare");
  expect(existsSync(out)).toBe(true);
}, 120000);

test("an explicit --publish destination overrides the saved publish key", () => {
  const dir = scratch();
  const html = join(dir, "sample.html");
  writeFileSync(
    html,
    `<!doctype html>
<html>
  <body style="margin: 0; font-family: sans-serif;">
    <main style="padding: 32px;">
      <h1>Publish Sample</h1>
      <p>This page proves the CLI captured rendered HTML before the publish step ran.</p>
    </main>
  </body>
</html>`,
  );
  const out = join(dir, "shot.png");

  const proc = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--output", out, "--publish", "browsershot-nonexistent-remote-explicit:other/path/"],
    { cwd: dir },
  );

  expect(proc.exitCode).toBe(5);
  expect(proc.stderr.toString()).toContain("browsershot-nonexistent-remote-explicit");
  expect(proc.stderr.toString()).not.toContain("browsershot-nonexistent-remote-bare");
}, 120000);
