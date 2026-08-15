import { expect, test } from "bun:test";
import { VERSION } from "../src/cli.ts";
import packageJson from "../package.json";

test("VERSION comes from package.json", () => {
  expect(VERSION).toBe(packageJson.version);
});
