import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { drawAnnotations } from "./annotate.ts";
import { capture, isAuthenticationCaptureFailure, type CaptureOptions, type CaptureResult } from "./capture.ts";
import { ExitError, EXIT_FAILED, EXIT_WRITE_ERROR, publishFailure } from "./exit-codes.ts";
import { AuthStateFailure, discoverAuthCredentials, resolveAuthJar } from "./authstate.ts";
import type { ElementRecord } from "./inspect.ts";
import { openFile } from "./open.ts";
import { labelFromPath, publish, type PublishResult } from "./publish.ts";
import type { ResolvedRunOptions } from "./run-options.ts";
import { createRunTmpDir, ensureWorkspace, removeRunTmpDir } from "./workspace.ts";

export interface SuccessSummary {
  outputPath: string | null;
  bytes: number | null;
  sha256: string | null;
  inspectJsonPath: string | null;
  inspected: unknown;
  publishedUrl: string | null;
}

export interface RunCaptureIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface RunCaptureDependencies {
  capture: typeof capture;
  resolveAuthJar: typeof resolveAuthJar;
  discoverAuthCredentials: typeof discoverAuthCredentials;
  drawAnnotations: typeof drawAnnotations;
  publish: typeof publish;
  openFile: typeof openFile;
}

const DEFAULT_DEPENDENCIES: RunCaptureDependencies = {
  capture,
  resolveAuthJar,
  discoverAuthCredentials,
  drawAnnotations,
  publish,
  openFile,
};

interface PreparedAuth {
  jarPath: string | undefined;
  retryCredentials: { credentialsPath: string; user?: string } | null;
}

export function emptySuccess(): SuccessSummary {
  return {
    outputPath: null,
    bytes: null,
    sha256: null,
    inspectJsonPath: null,
    inspected: null,
    publishedUrl: null,
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function inspectJsonPath(pngPath: string): string {
  let result = `${pngPath}.json`;
  if (pngPath.toLowerCase().endsWith(".png")) {
    result = `${pngPath.slice(0, -4)}.json`;
  }
  return result;
}

export function inspectSummary(record: ElementRecord, attr?: string): string {
  let name = record.name;
  if (name === "") {
    name = "(empty)";
  }
  let summary = `role=${record.role} name="${name}"`;
  if (attr != null) {
    let value = record.attributes[attr];
    if (value === undefined) {
      value = "(not present)";
    }
    summary = `${summary} ${attr}=${value}`;
  }
  return summary;
}

function withDefaults(overrides: Partial<RunCaptureDependencies>): RunCaptureDependencies {
  const deps = { ...DEFAULT_DEPENDENCIES };
  if (overrides.capture != null) {
    deps.capture = overrides.capture;
  }
  if (overrides.resolveAuthJar != null) {
    deps.resolveAuthJar = overrides.resolveAuthJar;
  }
  if (overrides.discoverAuthCredentials != null) {
    deps.discoverAuthCredentials = overrides.discoverAuthCredentials;
  }
  if (overrides.drawAnnotations != null) {
    deps.drawAnnotations = overrides.drawAnnotations;
  }
  if (overrides.publish != null) {
    deps.publish = overrides.publish;
  }
  if (overrides.openFile != null) {
    deps.openFile = overrides.openFile;
  }
  return deps;
}

export async function captureWithAuthRetry(
  options: CaptureOptions,
  auth: { credentialsPath: string; user?: string } | null,
  overrides?: Pick<RunCaptureDependencies, "capture" | "resolveAuthJar">,
  onAuthStateStderr?: (chunk: string) => void,
): Promise<CaptureResult> {
  const retryDeps: Pick<RunCaptureDependencies, "capture" | "resolveAuthJar"> = { ...DEFAULT_DEPENDENCIES };
  if (overrides?.capture != null) {
    retryDeps.capture = overrides.capture;
  }
  if (overrides?.resolveAuthJar != null) {
    retryDeps.resolveAuthJar = overrides.resolveAuthJar;
  }
  try {
    return await retryDeps.capture(options);
  } catch (initialError) {
    if ((auth == null) || !isAuthenticationCaptureFailure(initialError)) {
      throw initialError;
    }
    const initialMessage = (initialError as Error).message;
    if (onAuthStateStderr != null) {
      onAuthStateStderr("browsershot: authentication appears invalid; verifying session and retrying once\n");
    }
    let verifiedJar: string;
    try {
      verifiedJar = await retryDeps.resolveAuthJar({ ...auth, verify: true }, undefined, onAuthStateStderr);
    } catch (verificationError) {
      if (verificationError instanceof AuthStateFailure) {
        throw new AuthStateFailure(
          `authentication retry failed after ${initialMessage}: ${verificationError.message}`,
          verificationError.code,
        );
      }
      throw new Error(`authentication retry failed after ${initialMessage}: ${(verificationError as Error).message}`);
    }
    try {
      return await retryDeps.capture({ ...options, cookiesPath: verifiedJar });
    } catch (retryError) {
      throw new Error(`authentication retry failed after ${initialMessage}: ${(retryError as Error).message}`);
    }
  }
}

async function prepareAuthentication(options: ResolvedRunOptions, deps: RunCaptureDependencies, onStderr: (chunk: string) => void): Promise<PreparedAuth> {
  let jarPath: string | undefined;
  let retryCredentials: PreparedAuth["retryCredentials"] = null;
  if (options.auth.requested) {
    let credentialsPath = options.auth.credentialsPath;
    if (credentialsPath == null) {
      credentialsPath = deps.discoverAuthCredentials(options.cwd);
      onStderr(`browsershot: using ${credentialsPath}\n`);
    }
    jarPath = await deps.resolveAuthJar({ credentialsPath, user: options.auth.user }, undefined, onStderr);
    retryCredentials = { credentialsPath, user: options.auth.user };
  }
  return { jarPath, retryCredentials };
}

function writeAndReport(options: ResolvedRunOptions, inspected: ElementRecord | null, png: Uint8Array, deps: RunCaptureDependencies, io: RunCaptureIO): SuccessSummary {
  const out = options.outputPath;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  const success = emptySuccess();
  success.outputPath = out;
  success.bytes = png.length;
  success.sha256 = sha256Hex(png);
  io.stderr(`browsershot: wrote ${out} (${png.length} bytes)\n`);
  io.stderr(`browsershot: sha256 ${success.sha256}\n`);
  if (options.report.json === false) {
    io.stdout(`${out}\n`);
  }
  if (inspected != null) {
    let sidecarPath = inspectJsonPath(out);
    if (options.inspectJsonPath != null) {
      sidecarPath = options.inspectJsonPath;
    }
    try {
      mkdirSync(dirname(sidecarPath), { recursive: true });
      writeFileSync(sidecarPath, `${JSON.stringify(inspected, null, 2)}\n`);
    } catch (e) {
      throw new ExitError(`wrote ${out}, but could not write ${sidecarPath}: ${(e as Error).message}`, EXIT_WRITE_ERROR);
    }
    success.inspectJsonPath = sidecarPath;
    success.inspected = inspected;
    io.stderr(`browsershot: inspected ${inspectSummary(inspected, options.capture.inspect?.attr)}\n`);
    io.stderr(`browsershot: element json ${sidecarPath}\n`);
  }
  if (options.publish != null) {
    let pngLabel = labelFromPath(out);
    if (options.publish.label != null) {
      pngLabel = options.publish.label;
    }
    let published: PublishResult;
    try {
      published = deps.publish({
        filePath: out,
        dest: options.publish.destination,
        size: options.publish.size,
        label: pngLabel,
      });
    } catch (e) {
      const failure = publishFailure(out, e as Error);
      throw new ExitError(failure.message, failure.code);
    }
    success.publishedUrl = published.url;
    if (options.report.json === false) {
      io.stdout(`${published.markdown}\n`);
    }
  }
  if (options.report.json === true) {
    io.stdout(`${JSON.stringify(success)}\n`);
  }
  if (options.report.autoOpen === true) {
    deps.openFile(out, (message) => io.stderr(`browsershot: warning: ${message}\n`));
  }
  return success;
}

export async function runCapture(options: ResolvedRunOptions, io: RunCaptureIO, overrides: Partial<RunCaptureDependencies> = {}): Promise<SuccessSummary> {
  const deps = withDefaults(overrides);
  ensureWorkspace(options.cwd);
  const runTmp = createRunTmpDir(options.cwd);
  try {
    const auth = await prepareAuthentication(options, deps, io.stderr);
    const captured = await captureWithAuthRetry(
      { ...options.capture, cookiesPath: auth.jarPath, log: (message) => io.stderr(`browsershot: ${message}\n`) },
      auth.retryCredentials,
      deps,
      io.stderr,
    );
    const png = deps.drawAnnotations(captured.png, options.annotations.boxes, options.annotations.markers, runTmp);
    return writeAndReport(options, captured.inspected, png, deps, io);
  } catch (error) {
    if (error instanceof ExitError) throw error;
    throw new ExitError((error as Error).message, EXIT_FAILED);
  } finally {
    removeRunTmpDir(runTmp);
  }
}
