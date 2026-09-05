import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCapture, captureWithAuthRetry, emptySuccess, type RunCaptureDependencies } from "../src/run-capture.ts";
import type { ResolvedRunOptions } from "../src/run-options.ts";
import { AuthStateFailure } from "../src/authstate.ts";
import { AuthenticationCaptureFailure } from "../src/capture.ts";

test("the runner executes one shared pipeline and always cleans run temp", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "browsershot-runner-test-"));
  const calls: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const outputPath = join(cwd, "capture.png");
  const options: ResolvedRunOptions = {
    cwd,
    capture: { url: "https://example.test", fullPage: false, delayMs: 0, allowBlank: false },
    auth: { requested: false },
    outputPath,
    annotations: { boxes: [], markers: [] },
    publish: null,
    report: { json: true, autoOpen: false },
  };
  const deps: Partial<RunCaptureDependencies> = {
    capture: async () => { calls.push("capture"); return { png: new Uint8Array([1, 2, 3]), inspected: null }; },
    drawAnnotations: (png) => { calls.push("annotate"); return png; },
  };

  const summary = await runCapture(options, {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  }, deps);

  expect(calls).toEqual(["capture", "annotate"]);
  expect(summary).toMatchObject({ outputPath, bytes: 3, inspected: null, publishedUrl: null });
  expect(JSON.parse(stdout.join(""))).toEqual(summary);
  expect(stderr.join("")).toContain("browsershot: wrote");
  expect(existsSync(outputPath)).toBe(true);
  expect(readdirSync(join(cwd, ".browsershot", "tmp"))).toEqual([]);
});

function optionsFor(cwd: string, patch: Partial<ResolvedRunOptions> = {}): ResolvedRunOptions {
  return {
    cwd,
    capture: { url: "https://example.test", fullPage: false, delayMs: 0, allowBlank: false },
    auth: { requested: false },
    outputPath: join(cwd, "capture.png"),
    annotations: { boxes: [], markers: [] },
    publish: null,
    report: { json: true, autoOpen: false },
    ...patch,
  };
}

function recordingIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    },
  };
}

test("requested auth discovers credentials and supplies the initial jar", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "browsershot-runner-auth-"));
  const calls: string[] = [];
  const { io } = recordingIo();
  await runCapture(optionsFor(cwd, { auth: { requested: true, user: "member" } }), io, {
    discoverAuthCredentials: (root) => { calls.push(`discover:${root}`); return "/tmp/creds.yaml"; },
    resolveAuthJar: async (request) => { calls.push(`auth:${request.credentialsPath}:${request.user}`); return "/tmp/jar.json"; },
    capture: async (captureOptions) => {
      calls.push(`capture:${captureOptions.cookiesPath}`);
      return { png: new Uint8Array([1]), inspected: null };
    },
  });
  expect(calls).toEqual([
    `discover:${cwd}`,
    "auth:/tmp/creds.yaml:member",
    "capture:/tmp/jar.json",
  ]);
});

test("capture failure is exit 1, cleans temp, and performs no later phase", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "browsershot-runner-fail-"));
  const calls: string[] = [];
  const { io } = recordingIo();
  await expect(runCapture(optionsFor(cwd), io, {
    capture: async () => { throw new Error("render failed"); },
    drawAnnotations: (png) => { calls.push("annotate"); return png; },
    publish: () => { calls.push("publish"); throw new Error("unexpected"); },
    openFile: () => { calls.push("open"); },
  })).rejects.toMatchObject({ message: "render failed", code: 1 });
  expect(calls).toEqual([]);
  expect(existsSync(join(cwd, "capture.png"))).toBe(false);
  expect(readdirSync(join(cwd, ".browsershot", "tmp"))).toEqual([]);
});

test("sidecar failure is exit 4 and retains the PNG", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "browsershot-runner-sidecar-"));
  const sidecarDirectory = join(cwd, "sidecar-directory");
  mkdirSync(sidecarDirectory);
  const { io } = recordingIo();
  const options = optionsFor(cwd, {
    inspectJsonPath: sidecarDirectory,
    capture: {
      url: "https://example.test", fullPage: false, delayMs: 0, allowBlank: false,
      inspect: { selector: "#menu", timeoutMs: 30_000 },
    },
  });
  await expect(runCapture(options, io, {
    capture: async () => ({
      png: new Uint8Array([1]),
      inspected: { role: "button", name: "Menu", attributes: {}, outerHTML: "<button>Menu</button>" } as never,
    }),
  })).rejects.toMatchObject({ code: 4 });
  expect(existsSync(options.outputPath)).toBe(true);
});

test("publish failure is exit 5 and retains the PNG", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "browsershot-runner-publish-"));
  const { io } = recordingIo();
  const options = optionsFor(cwd, {
    publish: { destination: "missing:shots/", size: 1200 },
  });
  await expect(runCapture(options, io, {
    capture: async () => ({ png: new Uint8Array([1]), inspected: null }),
    publish: () => { throw new Error("upload failed"); },
  })).rejects.toMatchObject({ code: 5, message: expect.stringContaining("upload failed") });
  expect(existsSync(options.outputPath)).toBe(true);
});

test("human reporting writes path then publish markdown and opens last", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "browsershot-runner-human-"));
  const calls: string[] = [];
  const recorded = recordingIo();
  const options = optionsFor(cwd, {
    publish: { destination: "gdrive:shots/", size: 1200, label: "Menu" },
    report: { json: false, autoOpen: true },
  });
  await runCapture(options, recorded.io, {
    capture: async () => ({ png: new Uint8Array([1]), inspected: null }),
    publish: () => {
      calls.push("publish");
      return { markdown: "![Menu](https://image.test)", url: "https://image.test", fileId: "id" };
    },
    openFile: (path) => { calls.push(`open:${path}`); },
  });
  expect(recorded.stdout).toEqual([
    `${options.outputPath}\n`,
    "![Menu](https://image.test)\n",
  ]);
  expect(calls).toEqual(["publish", `open:${options.outputPath}`]);
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

test("emptySuccess carries every success key, all null", () => {
  expect(Object.keys(emptySuccess())).toEqual([
    "outputPath",
    "bytes",
    "sha256",
    "inspectJsonPath",
    "inspected",
    "publishedUrl",
  ]);
  expect(Object.values(emptySuccess()).every((value) => value === null)).toBe(true);
});
