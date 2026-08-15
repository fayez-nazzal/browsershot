import { expect, test } from "bun:test";
import { join } from "node:path";
import { resolveAuthJar, type AuthStateDeps, type AuthStateRun } from "../src/authstate.ts";
import { EXIT_ENVIRONMENT, EXIT_FAILED } from "../src/exit-codes.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function deps(installed: boolean, run: AuthStateRun, calls: string[][] = []): AuthStateDeps {
  return {
    isInstalled: () => installed,
    run: (args) => {
      calls.push(args);
      return run;
    },
  };
}

function okRun(stdout: string): AuthStateRun {
  return { exitCode: 0, stdout, stderr: "" };
}

test("resolves the jar path out of the authstate envelope", () => {
  const calls: string[][] = [];
  const envelope = JSON.stringify({ tool: "authstate", ok: true, path: "/jars/app--basic.json" });
  const jar = resolveAuthJar({ credentialsPath: "creds.yaml", purpose: "basic-user" }, deps(true, okRun(envelope), calls));
  expect(jar).toBe("/jars/app--basic.json");
  expect(calls[0]).toEqual(["authstate", "ensure", "--credentials", "creds.yaml", "--purpose", "basic-user"]);
});

test("omits --purpose when no purpose is given", () => {
  const calls: string[][] = [];
  const envelope = JSON.stringify({ path: "/jars/a.json" });
  resolveAuthJar({ credentialsPath: "creds.yaml" }, deps(true, okRun(envelope), calls));
  expect(calls[0]).toEqual(["authstate", "ensure", "--credentials", "creds.yaml"]);
});

test("a missing authstate binary fails with an install hint and the environment exit code", () => {
  let caught: any = null;
  try {
    resolveAuthJar({ credentialsPath: "creds.yaml" }, deps(false, okRun("")));
  } catch (e) {
    caught = e;
  }
  expect(caught.code).toBe(EXIT_ENVIRONMENT);
  expect(caught.message).toContain("authstate is not installed");
});

test("a non zero authstate exit surfaces its exit code and its reason", () => {
  const envelope = JSON.stringify({ ok: false, reason: "login form never accepted the password", exit_code: 4 });
  let caught: any = null;
  try {
    resolveAuthJar({ credentialsPath: "creds.yaml" }, deps(true, { exitCode: 4, stdout: envelope, stderr: "" }));
  } catch (e) {
    caught = e;
  }
  expect(caught.code).toBe(EXIT_FAILED);
  expect(caught.message).toContain("exit 4");
  expect(caught.message).toContain("login form never accepted the password");
});

test("output that is not JSON fails clearly", () => {
  let caught: any = null;
  try {
    resolveAuthJar({ credentialsPath: "creds.yaml" }, deps(true, okRun("not json at all")));
  } catch (e) {
    caught = e;
  }
  expect(caught.code).toBe(EXIT_FAILED);
  expect(caught.message).toContain("did not print JSON");
});

test("an envelope without a path field fails clearly", () => {
  let caught: any = null;
  try {
    resolveAuthJar({ credentialsPath: "creds.yaml" }, deps(true, okRun(JSON.stringify({ ok: true }))));
  } catch (e) {
    caught = e;
  }
  expect(caught.code).toBe(EXIT_FAILED);
  expect(caught.message).toContain("no \"path\" field");
});

test("--auth-credentials together with --cookies exits 2", () => {
  const proc = Bun.spawnSync(["bun", "src/cli.ts", "https://example.com", "--cookies", "jar.json", "--auth-credentials", "creds.yaml"], { cwd: REPO_ROOT });
  const stderr = new TextDecoder().decode(proc.stderr);
  expect(proc.exitCode).toBe(2);
  expect(stderr).toContain("--auth-credentials and --cookies");
});

test("--auth-purpose without --auth-credentials exits 2", () => {
  const proc = Bun.spawnSync(["bun", "src/cli.ts", "https://example.com", "--auth-purpose", "basic-user"], { cwd: REPO_ROOT });
  const stderr = new TextDecoder().decode(proc.stderr);
  expect(proc.exitCode).toBe(2);
  expect(stderr).toContain("--auth-purpose needs --auth-credentials");
});
