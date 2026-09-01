import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src", "cli.ts");

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-exit-code-test-"));
}

test("a usage error exits with code 2", () => {
  const dir = scratch();
  const proc = Bun.spawnSync(["bun", CLI], { cwd: dir });
  expect(proc.exitCode).toBe(2);
});

test("a publish failure after a successful write exits 6 and keeps the artifact on disk", () => {
  const dir = scratch();
  const before = join(dir, "before.png");
  const after = join(dir, "after.png");
  writeFileSync(before, PNG_BYTES);
  writeFileSync(after, PNG_BYTES);
  const out = join(dir, "shot.png");

  const proc = Bun.spawnSync(
    [
      "bun",
      CLI,
      "--compare",
      `${before},${after}`,
      "--output",
      out,
      "--publish",
      "browsershot-nonexistent-remote-xyz:some/path/",
    ],
    { cwd: dir },
  );

  expect(proc.exitCode).toBe(6);
  expect(existsSync(out)).toBe(true);
}, 120000);
