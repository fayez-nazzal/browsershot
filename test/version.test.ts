import { expect, test } from "bun:test";
import { VERSION } from "../src/cli.ts";
import packageJson from "../package.json";

test("VERSION is the package version with an alpha suffix", () => {
  expect(VERSION).toBe(`${packageJson.version}-alpha`);
});
