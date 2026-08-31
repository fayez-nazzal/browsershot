import { EXIT_ENVIRONMENT, EXIT_FAILED, type ExitCode } from "./exit-codes.ts";
import { discoverCredentialsFile } from "./credentials-discovery.ts";

export interface AuthStateRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AuthStateDeps {
  isInstalled: () => boolean;
  run: (args: string[], onStderr?: (chunk: string) => void) => AuthStateRun | Promise<AuthStateRun>;
}

export interface AuthJarRequest {
  credentialsPath: string | null;
  user?: string;
}

export class AuthStateFailure extends Error {
  readonly code: ExitCode;

  constructor(message: string, code: ExitCode) {
    super(message);
    this.name = "AuthStateFailure";
    this.code = code;
  }
}

async function readOutput(stream: ReadableStream<Uint8Array>, onChunk?: (chunk: string) => void): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    if (result.value != null) {
      const chunk = decoder.decode(result.value, { stream: !done });
      output += chunk;
      if (onChunk != null && chunk !== "") {
        onChunk(chunk);
      }
    }
  }
  const finalChunk = decoder.decode();
  output += finalChunk;
  if (onChunk != null && finalChunk !== "") {
    onChunk(finalChunk);
  }
  return output;
}

export async function runAuthState(args: string[], onStderr?: (chunk: string) => void): Promise<AuthStateRun> {
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readOutput(proc.stdout),
    readOutput(proc.stderr, onStderr),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

const defaultAuthStateDeps: AuthStateDeps = {
  isInstalled: () => Bun.spawnSync(["which", "authstate"]).success,
  run: runAuthState,
};

export function discoverAuthCredentials(cwd: string): string {
  const discovery = discoverCredentialsFile(cwd);
  if (!discovery.ok) {
    throw new AuthStateFailure(discovery.reason, EXIT_ENVIRONMENT);
  }
  return discovery.path;
}

function buildArgs(request: AuthJarRequest): string[] {
  const args = ["authstate", "ensure"];
  if (request.credentialsPath != null) {
    args.push("--credentials");
    args.push(request.credentialsPath);
  }
  if (request.user != null) {
    args.push("--user");
    args.push(request.user);
  }
  return args;
}

function parseEnvelope(stdout: string): Record<string, unknown> {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    parsed = null;
  }
  if (parsed == null || typeof parsed !== "object") {
    throw new AuthStateFailure(`authstate did not print JSON on stdout: ${stdout.trim()}`, EXIT_FAILED);
  }
  return parsed as Record<string, unknown>;
}

function failedRunMessage(run: AuthStateRun): string {
  let reason = run.stderr.trim();
  try {
    const envelope = parseEnvelope(run.stdout);
    if (typeof envelope.reason === "string") {
      reason = envelope.reason;
    }
  } catch {
    reason = run.stderr.trim();
  }
  if (reason === "") {
    reason = "no reason reported";
  }
  return `authstate ensure failed with exit ${run.exitCode}: ${reason}`;
}

export async function resolveAuthJar(
  request: AuthJarRequest,
  deps: AuthStateDeps = defaultAuthStateDeps,
  onStderr?: (chunk: string) => void,
): Promise<string> {
  if (!deps.isInstalled()) {
    throw new AuthStateFailure(`authstate is not installed. Install it first, then re-run: see https://github.com/fayez-nazzal/authstate`, EXIT_ENVIRONMENT);
  }
  const run = await deps.run(buildArgs(request), onStderr);
  if (run.exitCode !== 0) {
    throw new AuthStateFailure(failedRunMessage(run), EXIT_FAILED);
  }
  const envelope = parseEnvelope(run.stdout);
  const path = envelope.path;
  if (typeof path !== "string" || path.trim() === "") {
    throw new AuthStateFailure(`authstate printed no "path" field: ${run.stdout.trim()}`, EXIT_FAILED);
  }
  return path;
}
