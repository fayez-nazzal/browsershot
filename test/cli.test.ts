import { expect, test } from "bun:test";
import { normalizeArgv, parseCliArgs } from "../src/cli.ts";

test("normalizeArgv merges a bare --publish value into = form", () => {
  expect(normalizeArgv(["--publish", "gdrive:dir/"])).toEqual(["--publish=gdrive:dir/"]);
  expect(normalizeArgv(["url", "--publish", "gdrive:dir/", "--json"])).toEqual(["url", "--publish=gdrive:dir/", "--json"]);
});

test("normalizeArgv keeps a bare --publish as an empty = form", () => {
  expect(normalizeArgv(["--publish"])).toEqual(["--publish="]);
  expect(normalizeArgv(["--publish", "--json"])).toEqual(["--publish=", "--json"]);
  expect(normalizeArgv(["--publish=one"])).toEqual(["--publish=one"]);
});
test("with-errors is a boolean CLI flag", () => {
  expect(parseCliArgs(["https://example.test", "--with-errors"]).values["with-errors"]).toBe(true);
  expect(() => parseCliArgs(["https://example.test", "--with-errors=value"])).toThrow();
});
