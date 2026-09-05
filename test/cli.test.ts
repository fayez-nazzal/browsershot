import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeArgv } from "../src/cli.ts";

test("normalizeArgv merges a bare --publish value into = form", () => {
  expect(normalizeArgv(["--publish", "gdrive:dir/"])).toEqual(["--publish=gdrive:dir/"]);
  expect(normalizeArgv(["url", "--publish", "gdrive:dir/", "--json"])).toEqual(["url", "--publish=gdrive:dir/", "--json"]);
});

test("normalizeArgv keeps a bare --publish as an empty = form", () => {
  expect(normalizeArgv(["--publish"])).toEqual(["--publish="]);
  expect(normalizeArgv(["--publish", "--json"])).toEqual(["--publish=", "--json"]);
  expect(normalizeArgv(["--publish=one"])).toEqual(["--publish=one"]);
});

test("cli delegates option resolution and capture execution", () => {
  const source = readFileSync(join(import.meta.dir, "../src/cli.ts"), "utf8");
  expect(source).toContain("resolveRunOptions(");
  expect(source).toContain("runCapture(");
  expect(source).not.toContain("resolveAuthJar(");
  expect(source).not.toContain("drawAnnotations(");
  expect(source).not.toContain("writeFileSync(");
});
