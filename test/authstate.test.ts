import { expect, test } from "bun:test";
import { join } from "node:path";
import { resolveAuthJar, discoverAuthCredentials, runAuthState, type AuthStateDeps, type AuthStateRun } from "../src/authstate.ts";
import { EXIT_ENVIRONMENT, EXIT_FAILED } from "../src/exit-codes.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function deps(installed: boolean, run: AuthStateRun, calls: string[][] = []): AuthStateDeps {
  return {
    isInstalled: () => installed,
    run: async (args, onStderr) => {
      calls.push(args);
      if (onStderr != null && run.stderr !== "") {
        onStderr(run.stderr);
      }
      return run;
    },
  };
}

function okRun(stdout: string): AuthStateRun {
  return { exitCode: 0, stdout, stderr: "" };
}

test("consumes subprocess streams and awaits completion", async () => {
  const seen: string[] = [];
  const run = await runAuthState(
    ["sh", "-c", "printf '{\"path\":\"/jars/a.json\"}'; printf progress >&2; exit 4"],
    (chunk) => seen.push(chunk),
  );
  expect(run.stdout).toBe('{"path":"/jars/a.json"}');
  expect(run.stderr).toBe("progress");
  expect(seen.join("")).toBe("progress");
  expect(run.exitCode).toBe(4);
});

test("resolves the jar path out of the authstate envelope", async () => {
  const calls: string[][] = [];
  const envelope = JSON.stringify({ tool: "authstate", ok: true, path: "/jars/app--basic.json" });
  const jar = await resolveAuthJar({ credentialsPath: "creds.yaml", user: "basic-user" }, deps(true, okRun(envelope), calls));
  expect(jar).toBe("/jars/app--basic.json");
  expect(calls[0]).toEqual(["authstate", "ensure", "--credentials", "creds.yaml", "--user", "basic-user"]);
});

test("omits --user when no user is given", async () => {
  const calls: string[][] = [];
  const envelope = JSON.stringify({ path: "/jars/a.json" });
  await resolveAuthJar({ credentialsPath: "creds.yaml" }, deps(true, okRun(envelope), calls));
  expect(calls[0]).toEqual(["authstate", "ensure", "--credentials", "creds.yaml"]);
});

test("omits --credentials entirely when discovery is used", async () => {
  const calls: string[][] = [];
  const envelope = JSON.stringify({ path: "/jars/a.json" });
  await resolveAuthJar({ credentialsPath: null, user: "basic-user" }, deps(true, okRun(envelope), calls));
  expect(calls[0]).toEqual(["authstate", "ensure", "--user", "basic-user"]);
});

test("streams authstate stderr through the callback", async () => {
  const seen: string[] = [];
  const envelope = JSON.stringify({ path: "/jars/a.json" });
  const run: AuthStateRun = { exitCode: 0, stdout: envelope, stderr: "authstate: no fresh jar — logging in headless\n" };
  const jar = await resolveAuthJar({ credentialsPath: "creds.yaml" }, deps(true, run), (chunk) => seen.push(chunk));
  expect(jar).toBe("/jars/a.json");
  expect(seen.join("")).toContain("logging in headless");
});

test("a missing authstate binary fails with an install hint and the environment exit code", async () => {
  let caught: any = null;
  try {
    await resolveAuthJar({ credentialsPath: "creds.yaml" }, deps(false, okRun("")));
  } catch (e) {
    caught = e;
  }
  expect(caught.code).toBe(EXIT_ENVIRONMENT);
  expect(caught.message).toContain("authstate is not installed");
});

test("a non zero authstate exit surfaces its exit code and its reason", async () => {
  const envelope = JSON.stringify({ ok: false, reason: "login form never accepted the password", exit_code: 4 });
  let caught: any = null;
  try {
    await resolveAuthJar({ credentialsPath: "creds.yaml" }, deps(true, { exitCode: 4, stdout: envelope, stderr: "" }));
  } catch (e) {
    caught = e;
  }
  expect(caught.code).toBe(EXIT_FAILED);
  expect(caught.message).toContain("exit 4");
  expect(caught.message).toContain("login form never accepted the password");
});

test("output that is not JSON fails clearly", async () => {
  let caught: any = null;
  try {
    await resolveAuthJar({ credentialsPath: "creds.yaml" }, deps(true, okRun("not json at all")));
  } catch (e) {
    caught = e;
  }
  expect(caught.code).toBe(EXIT_FAILED);
  expect(caught.message).toContain("did not print JSON");
});

test("an envelope without a path field fails clearly", async () => {
  let caught: any = null;
  try {
    await resolveAuthJar({ credentialsPath: "creds.yaml" }, deps(true, okRun(JSON.stringify({ ok: true }))));
  } catch (e) {
    caught = e;
  }
  expect(caught.code).toBe(EXIT_FAILED);
  expect(caught.message).toContain("no \"path\" field");
});

test("discoverAuthCredentials finds .testing-credentials.yaml by walking up", () => {
  const dir = join(REPO_ROOT, "test", "fixtures", "creds");
  const found = discoverAuthCredentials(dir);
  expect(found.endsWith(".testing-credentials.yaml")).toBe(true);
});

test("discoverAuthCredentials fails with a named error when nothing is found", () => {
  let caught: any = null;
  try {
    discoverAuthCredentials(join(REPO_ROOT, "test", "fixtures", "no-creds"));
  } catch (e) {
    caught = e;
  }
  expect(caught.code).toBe(EXIT_ENVIRONMENT);
  expect(caught.message).toContain(".testing-credentials.yaml");
});

test("--cookies together with --auth exits 2", () => {
  const proc = Bun.spawnSync(["bun", "src/cli.ts", "https://example.com", "--cookies", "jar.json", "--auth"], { cwd: REPO_ROOT });
  const stderr = new TextDecoder().decode(proc.stderr);
  expect(proc.exitCode).toBe(2);
  expect(stderr).toContain("--cookies");
});

test("--auth-purpose is a tombstone naming --auth-user", () => {
  const proc = Bun.spawnSync(["bun", "src/cli.ts", "https://example.com", "--auth-purpose", "basic-user"], { cwd: REPO_ROOT });
  const stderr = new TextDecoder().decode(proc.stderr);
  expect(proc.exitCode).toBe(2);
  expect(stderr).toContain("--auth-purpose");
  expect(stderr).toContain("--auth-user");
});
