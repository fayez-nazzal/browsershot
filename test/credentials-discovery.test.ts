import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverCredentialsFile } from "../src/credentials-discovery.ts";

test("finds .testing-credentials.yaml by walking up from a nested cwd", () => {
  const dir = mkdtempSync(join(tmpdir(), "bshot-disc-"));
  mkdirSync(join(dir, "a", "b"), { recursive: true });
  writeFileSync(join(dir, ".testing-credentials.yaml"), "app: x\ncredentials: {}\n");

  const result = discoverCredentialsFile(join(dir, "a", "b"));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.path).toBe(join(dir, ".testing-credentials.yaml"));
  }

  rmSync(dir, { recursive: true, force: true });
});

test("stops at the first .git without finding a file", () => {
  const dir = mkdtempSync(join(tmpdir(), "bshot-disc-"));
  mkdirSync(join(dir, "a", "b"), { recursive: true });
  mkdirSync(join(dir, "a", ".git"), { recursive: true });
  writeFileSync(join(dir, ".testing-credentials.yaml"), "app: x\ncredentials: {}\n");

  const result = discoverCredentialsFile(join(dir, "a", "b"));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toContain(".testing-credentials.yaml");
    expect(result.reason).toContain("--credentials");
  }

  rmSync(dir, { recursive: true, force: true });
});
