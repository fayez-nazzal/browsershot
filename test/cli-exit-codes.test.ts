import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src", "cli.ts");

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-exit-code-test-"));
}

test("a usage error exits with code 2", () => {
  const dir = scratch();
  const proc = Bun.spawnSync(["bun", CLI], { cwd: dir });
  expect(proc.exitCode).toBe(2);
});

test("a publish failure after a successful write exits 5 and keeps the artifact on disk", () => {
  const dir = scratch();
  const html = join(dir, "sample.html");
  writeFileSync(
    html,
    `<!doctype html>
<html>
  <body style="margin: 0; font-family: sans-serif;">
    <main style="padding: 32px;">
      <h1>Publish Failure Sample</h1>
      <p>This page proves the CLI wrote a capture before the publish step ran.</p>
    </main>
  </body>
</html>`,
  );
  const out = join(dir, "shot.png");

  const proc = Bun.spawnSync(
    [
      "bun",
      CLI,
      `file://${html}`,
      "--size",
      "640x480",
      "--output",
      out,
      "--publish",
      "browsershot-nonexistent-remote-xyz:some/path/",
    ],
    { cwd: dir },
  );

  expect(proc.exitCode).toBe(5);
  expect(existsSync(out)).toBe(true);
}, 120000);
