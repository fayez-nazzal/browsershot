import { expect, test } from "bun:test";
import { sha256Hex, normalizeArgv } from "../src/cli.ts";

test("sha256Hex hashes bytes to lowercase hex", () => {
  const empty = sha256Hex(new Uint8Array());
  expect(empty).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const abc = sha256Hex(new TextEncoder().encode("abc"));
  expect(abc).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("sha256Hex distinguishes different byte payloads", () => {
  const a = sha256Hex(new TextEncoder().encode("page-a"));
  const b = sha256Hex(new TextEncoder().encode("page-b"));
  expect(a).not.toBe(b);
});

test("normalizeArgv merges a bare --publish value into = form", () => {
  expect(normalizeArgv(["--publish", "gdrive:dir/"])).toEqual(["--publish=gdrive:dir/"]);
  expect(normalizeArgv(["url", "--publish", "gdrive:dir/", "--json"])).toEqual(["url", "--publish=gdrive:dir/", "--json"]);
});

test("normalizeArgv keeps a bare --publish as an empty = form", () => {
  expect(normalizeArgv(["--publish"])).toEqual(["--publish="]);
  expect(normalizeArgv(["--publish", "--json"])).toEqual(["--publish=", "--json"]);
  expect(normalizeArgv(["--publish=one"])).toEqual(["--publish=one"]);
});
