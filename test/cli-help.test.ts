import { expect, test } from "bun:test";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

test("help explains both capture entry paths and exposes every capture flag", () => {
  const result = Bun.spawnSync(["bun", CLI, "--help"]);
  expect(result.exitCode).toBe(0);
  const help = result.stdout.toString();
  for (const phrase of [
    "https://example.com/pricing",
    "config set baseUrl",
    "browsershot /pricing",
    "--expect-element",
    "--group",
    "--label",
    "{timestamp}",
    "--no-expect",
    "--no-auth",
    "--auth-redirect",
    "--no-auth-redirect",
    "--no-json",
    "--no-auto-open",
    "--act",
    "hover",
    "--inspect",
    "--inspect-attr",
    "--inspect-json",
    "--box",
    "--marker",
    "--publish",
    "--allow-status",
    "--allow-blank",
    "outputPath, bytes, sha256, inspectJsonPath",
  ]) {
    expect(help).toContain(phrase);
  }
});
