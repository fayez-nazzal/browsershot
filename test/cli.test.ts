import { expect, test } from "bun:test";
import { captureWithAuthRetry, sha256Hex, normalizeArgv } from "../src/cli.ts";
import { AuthStateFailure } from "../src/authstate.ts";
import { AuthenticationCaptureFailure } from "../src/capture.ts";

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

function captureResult() {
  return { png: new Uint8Array([1, 2, 3]), inspected: null };
}

test("auth capture retries once with a verified jar after an auth failure", async () => {
  const calls: string[] = [];
  const jars: string[] = [];
  const result = await captureWithAuthRetry(
    { url: "https://example.test", fullPage: false, delayMs: 0, allowBlank: true, cookiesPath: "/jars/old.json" },
    { credentialsPath: "creds.yaml", user: "member" },
    {
      capture: async (options) => {
        calls.push("capture");
        jars.push(options.cookiesPath ?? "none");
        if (calls.length === 1) throw new AuthenticationCaptureFailure("HTTP 401");
        return captureResult();
      },
      resolveAuthJar: async (request) => {
        calls.push(request.verify === true ? "verify" : "ensure");
        return "/jars/refreshed.json";
      },
    },
  );
  expect(result.png).toEqual(new Uint8Array([1, 2, 3]));
  expect(calls).toEqual(["capture", "verify", "capture"]);
  expect(jars).toEqual(["/jars/old.json", "/jars/refreshed.json"]);
});

test("generic capture failures do not verify or retry", async () => {
  const calls: string[] = [];
  await expect(captureWithAuthRetry(
    { url: "https://example.test", fullPage: false, delayMs: 0, allowBlank: true },
    { credentialsPath: "creds.yaml" },
    {
      capture: async () => { calls.push("capture"); throw new Error("render failed"); },
      resolveAuthJar: async () => { calls.push("verify"); return "/jars/refreshed.json"; },
    },
  )).rejects.toThrow("render failed");
  expect(calls).toEqual(["capture"]);
});

test("authentication retry stops after one retry", async () => {
  const calls: string[] = [];
  await expect(captureWithAuthRetry(
    { url: "https://example.test", fullPage: false, delayMs: 0, allowBlank: true },
    { credentialsPath: "creds.yaml" },
    {
      capture: async () => { calls.push("capture"); throw new AuthenticationCaptureFailure("HTTP 403"); },
      resolveAuthJar: async () => { calls.push("verify"); return "/jars/refreshed.json"; },
    },
  )).rejects.toThrow(/authentication retry failed/);
  expect(calls).toEqual(["capture", "verify", "capture"]);
});

test("failed verification preserves authstate failure code and original context", async () => {
  await expect(captureWithAuthRetry(
    { url: "https://example.test", fullPage: false, delayMs: 0, allowBlank: true },
    { credentialsPath: "creds.yaml" },
    {
      capture: async () => { throw new AuthenticationCaptureFailure("HTTP 401"); },
      resolveAuthJar: async () => { throw new AuthStateFailure("login failed", 1); },
    },
  )).rejects.toMatchObject({ message: expect.stringMatching(/HTTP 401.*login failed/), code: 1 });
});
