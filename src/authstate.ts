import { EXIT_ENVIRONMENT, EXIT_FAILED, type ExitCode } from "./exit-codes.ts";

export interface AuthStateRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AuthStateDeps {
  isInstalled: () => boolean;
  run: (args: string[]) => AuthStateRun;
}

export interface AuthJarRequest {
  credentialsPath: string;
  purpose?: string;
}

export class AuthStateFailure extends Error {
  readonly code: ExitCode;

  constructor(message: string, code: ExitCode) {
    super(message);
    this.name = "AuthStateFailure";
    this.code = code;
  }
}

const defaultAuthStateDeps: AuthStateDeps = {
  isInstalled: () => Bun.spawnSync(["which", "authstate"]).success,
  run: (args) => {
    const proc = Bun.spawnSync(args);
    const stdout = new TextDecoder().decode(proc.stdout);
    const stderr = new TextDecoder().decode(proc.stderr);
    let exitCode = 0;
    if (proc.exitCode != null) {
      exitCode = proc.exitCode;
    }
    return { exitCode, stdout, stderr };
  },
};

function buildArgs(request: AuthJarRequest): string[] {
  const args = ["authstate", "ensure", "--credentials", request.credentialsPath];
  if (request.purpose != null) {
    args.push("--purpose");
    args.push(request.purpose);
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

export function resolveAuthJar(request: AuthJarRequest, deps: AuthStateDeps = defaultAuthStateDeps): string {
  if (!deps.isInstalled()) {
    throw new AuthStateFailure(`authstate is not installed. Install it first, then re-run: see https://github.com/fayez-nazzal/authstate`, EXIT_ENVIRONMENT);
  }
  const run = deps.run(buildArgs(request));
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
