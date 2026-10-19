import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { UsageError } from "../src/exit-codes.ts";
import { runOpenWindow, type LaunchPersistentContext, type OpenWindowOptions } from "../src/open-window.ts";

const root = mkdtempSync(join(tmpdir(), "browsershot-open-window-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

class FakePage {
  constructor(private readonly context: FakeContext) {}

  async goto(url: string): Promise<null> {
    this.context.events.push("goto");
    this.context.visited.resolve(url);
    if (this.context.gotoFailure !== undefined) {
      throw this.context.gotoFailure;
    }
    return null;
  }
}

class FakeContext {
  readonly visited = Promise.withResolvers<string>();
  readonly gotoFailure: Error | undefined;
  readonly events: string[] = [];
  readonly addedCookies: unknown[] = [];
  readonly initScripts: { script: (value: unknown) => void; arg: unknown }[] = [];
  closeCount = 0;
  state: unknown = { cookies: [], origins: [] };
  stateFailure: Error | undefined;
  private windowOpen = true;
  private readonly page = new FakePage(this);

  constructor(gotoFailure?: Error) {
    this.gotoFailure = gotoFailure;
  }

  pages(): FakePage[] {
    return this.windowOpen ? [this.page] : [];
  }

  async newPage(): Promise<FakePage> {
    return this.page;
  }

  async addCookies(cookies: unknown[]): Promise<void> {
    this.events.push("cookies");
    this.addedCookies.push(...cookies);
  }

  async addInitScript(script: (value: never) => void, arg: unknown): Promise<void> {
    this.events.push("init");
    this.initScripts.push({ script: script as (value: unknown) => void, arg });
  }

  async storageState(): Promise<unknown> {
    this.events.push("state");
    if (this.stateFailure !== undefined) throw this.stateFailure;
    return this.state;
  }

  closeWindow(): void {
    this.windowOpen = false;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    this.windowOpen = false;
  }
}

function options(directory: string): OpenWindowOptions {
  return {
    url: "https://app.example.test/dashboard",
    directory,
    viewport: { width: 1280, height: 800 },
    authJarPath: null,
    statePath: join(directory, "..", `${basename(directory)}-state.json`),
    log: () => {},
  };
}

function launchInto(context: FakeContext, launches: string[]): LaunchPersistentContext {
  const launch = async (directory: string): Promise<FakeContext> => {
    launches.push(directory);
    return context;
  };
  return launch as unknown as LaunchPersistentContext;
}

describe("browsershot open window", () => {
  test("closing the window ends the command and closes the context", async () => {
    const context = new FakeContext();
    const launches: string[] = [];
    const run = runOpenWindow(options(join(root, "window")), launchInto(context, launches));
    await context.visited.promise;
    context.closeWindow();
    await run;
    expect(context.closeCount).toBe(1);
    expect(launches).toEqual([join(root, "window")]);
  });

  test("Ctrl-C closes the context and does not reach the launcher's own SIGINT handler", async () => {
    const context = new FakeContext();
    let launcherSigintCalls = 0;
    const launcherSigint = () => {
      launcherSigintCalls += 1;
    };
    const launch = (async (): Promise<FakeContext> => {
      process.on("SIGINT", launcherSigint);
      return context;
    }) as unknown as LaunchPersistentContext;
    const run = runOpenWindow(options(join(root, "sigint")), launch);
    try {
      await context.visited.promise;
      process.emit("SIGINT");
      await run;
      expect(context.closeCount).toBe(1);
      expect(launcherSigintCalls).toBe(0);
    } finally {
      process.off("SIGINT", launcherSigint);
    }
  });

  test("a profile held by a live browser is refused before launch", async () => {
    const directory = join(root, "in-use");
    mkdirSync(directory);
    symlinkSync(`host-${process.pid}`, join(directory, "SingletonLock"));
    const launches: string[] = [];
    const context = new FakeContext();
    await expect(runOpenWindow(options(directory), launchInto(context, launches))).rejects.toBeInstanceOf(UsageError);
    expect(launches).toEqual([]);
  });

  test("a lock left by a browser that is no longer running does not block the launch", async () => {
    const directory = join(root, "stale");
    mkdirSync(directory);
    symlinkSync("host-2147483646", join(directory, "SingletonLock"));
    const context = new FakeContext();
    const launches: string[] = [];
    const run = runOpenWindow(options(directory), launchInto(context, launches));
    await context.visited.promise;
    context.closeWindow();
    await run;
    expect(launches).toEqual([directory]);
  });

  test("a failed navigation closes the context and reports the error", async () => {
    const context = new FakeContext(new Error("net::ERR_NAME_NOT_RESOLVED"));
    const launches: string[] = [];
    await expect(runOpenWindow(options(join(root, "nav")), launchInto(context, launches))).rejects.toThrow(
      "net::ERR_NAME_NOT_RESOLVED",
    );
    expect(context.closeCount).toBe(1);
  });

  test("a missing Chromium build is reported with the install command", async () => {
    const launch = (async (): Promise<never> => {
      throw new Error("Executable doesn't exist at /ms-playwright/chromium");
    }) as unknown as LaunchPersistentContext;
    await expect(runOpenWindow(options(join(root, "missing")), launch)).rejects.toThrow(
      "bun playwright install chromium",
    );
  });

  test("auth jar cookies are in the context before the first navigation", async () => {
    const jar = join(root, "jar-cookies.json");
    const cookie = { name: "session", value: "abc", domain: "app.example.test", path: "/" };
    writeFileSync(jar, JSON.stringify({ cookies: [cookie], origins: [] }));
    const context = new FakeContext();
    const launches: string[] = [];
    const run = runOpenWindow(
      { ...options(join(root, "auth-cookies")), authJarPath: jar },
      launchInto(context, launches),
    );
    await context.visited.promise;
    context.closeWindow();
    await run;
    expect(context.addedCookies).toEqual([cookie]);
    expect(context.events).toEqual(["cookies", "goto", "state"]);
  });

  test("auth jar localStorage is seeded only for its own origin", async () => {
    const jar = join(root, "jar-origins.json");
    writeFileSync(
      jar,
      JSON.stringify({
        origins: [
          { origin: "https://app.example.test", localStorage: [{ name: "token", value: "t1" }] },
          { origin: "https://other.example.test", localStorage: [{ name: "token", value: "other" }] },
        ],
      }),
    );
    const context = new FakeContext();
    const launches: string[] = [];
    const run = runOpenWindow(
      { ...options(join(root, "auth-origins")), authJarPath: jar },
      launchInto(context, launches),
    );
    await context.visited.promise;
    context.closeWindow();
    await run;
    expect(context.events).toEqual(["init", "goto", "state"]);
    const [{ script, arg }] = context.initScripts;
    const store = new Map<string, string>();
    Reflect.set(globalThis, "location", { origin: "https://app.example.test" });
    Reflect.set(globalThis, "localStorage", { setItem: (key: string, value: string) => store.set(key, value) });
    try {
      script(arg);
    } finally {
      Reflect.deleteProperty(globalThis, "location");
      Reflect.deleteProperty(globalThis, "localStorage");
    }
    expect([...store]).toEqual([["token", "t1"]]);
  });
  test("the profile state is saved for captures before the context closes", async () => {
    const directory = join(root, "snapshot");
    const context = new FakeContext();
    context.state = { cookies: [], origins: [{ origin: "https://app.example.test", localStorage: [{ name: "theme", value: "dark" }] }] };
    const run = runOpenWindow(options(directory), launchInto(context, []));
    await context.visited.promise;
    context.closeWindow();
    await run;
    expect(JSON.parse(readFileSync(options(directory).statePath, "utf8"))).toEqual(context.state);
    expect(context.events.at(-1)).toBe("state");
  });

  test("a failed snapshot is reported and the context still closes", async () => {
    const directory = join(root, "snapshot-fail");
    const context = new FakeContext();
    context.stateFailure = new Error("browser has been closed");
    const logs: string[] = [];
    const run = runOpenWindow({ ...options(directory), log: (message) => logs.push(message) }, launchInto(context, []));
    await context.visited.promise;
    context.closeWindow();
    await run;
    expect(context.closeCount).toBe(1);
    expect(existsSync(options(directory).statePath)).toBe(false);
    expect(logs.some((message) => message.includes("browser has been closed"))).toBe(true);
  });
});
