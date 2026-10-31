import { describe, expect, it, vi } from "bun:test";
import { parseActions, runActions } from "../src/act.ts";

describe("parseActions", () => {
  it("reads a list of steps in order", () => {
    const actions = parseActions("focus:button.menu; hover:button.menu; press:Enter; wait:800");
    expect(actions).toEqual([
      { kind: "focus", value: "button.menu" },
      { kind: "hover", value: "button.menu" },
      { kind: "press", value: "Enter" },
      { kind: "wait", value: "800" },
    ]);
  });

  it("keeps colons that belong to the value", () => {
    const actions = parseActions('click:button[aria-label="a: b"]');
    expect(actions[0]).toEqual({ kind: "click", value: 'button[aria-label="a: b"]' });
  });

  it("parses hover selectors containing colons", () => {
    expect(parseActions("hover:button:hover")).toEqual([{ kind: "hover", value: "button:hover" }]);
  });

  it("rejects an empty spec", () => {
    expect(() => parseActions("   ")).toThrow("at least one step");
  });

  it("rejects a step with no kind", () => {
    expect(() => parseActions("Enter")).toThrow("needs a kind and a value");
  });

  it("rejects an unknown kind", () => {
    expect(() => parseActions("drag:button")).toThrow("unknown kind");
  });

  it("rejects a step with no value", () => {
    expect(() => parseActions("press:")).toThrow("needs a value");
  });

  it("rejects a wait that is not a whole number", () => {
    expect(() => parseActions("wait:soon")).toThrow("whole number");
  });
 
  it("parses scroll selectors and preserves selector colons", () => {
    expect(parseActions("scroll:main :is(#target, .target);click:#next")).toEqual([
      { kind: "scroll", value: "main :is(#target, .target)" },
      { kind: "click", value: "#next" },
    ]);
    expect(() => parseActions("scroll:")).toThrow("needs a value");
    expect(() => parseActions("scrol:#target")).toThrow("unknown kind");
    expect(parseActions("scroll:down(500px);scroll:up(25%);scroll:left(10px);scroll:right(50%)"))
      .toEqual([
        { kind: "scroll", value: "down(500px)" },
        { kind: "scroll", value: "up(25%)" },
        { kind: "scroll", value: "left(10px)" },
        { kind: "scroll", value: "right(50%)" },
      ]);
    expect(() => parseActions("scroll:down(5vw)")).toThrow("positive pixel or percentage distance");
    expect(() => parseActions("scroll:sideways(5px)")).toThrow("unknown scroll direction");
  });
 
});

describe("runActions", () => {
  it("hovers before clicking when actions are ordered that way", async () => {
    const events: string[] = [];
    const page = {
      locator: (selector: string) => {
        events.push(`locator:${selector}`);
        return {
          first: () => ({
            waitFor: async () => { events.push("attached"); },
            hover: async () => { events.push("hover"); },
            click: async () => { events.push("click"); },
          }),
        };
      },
      waitForTimeout: async () => { events.push("settle"); },
    };

    await runActions(page as never, parseActions("hover:button;click:button"), 1000);

    expect(events).toEqual([
      "locator:button", "attached", "hover", "settle",
      "locator:button", "attached", "click", "settle",
    ]);
  });

  it("surfaces a locator failure for an unresolvable hover target", async () => {
    const page = {
      locator: () => ({ first: () => ({ waitFor: async () => { throw new Error("locator did not resolve"); } }) }),
    };

    await expect(runActions(page as never, parseActions("hover:#missing"), 1000)).rejects.toThrow("locator did not resolve");
  });

  it("retains the target only when hover is the final action", async () => {
    const handle = { id: "hovered-element" };
    const page = {
      locator: () => ({
        first: () => ({
          waitFor: async () => {},
          elementHandle: async () => handle,
          hover: async () => {},
          click: async () => {},
        }),
      }),
      waitForTimeout: async () => {},
    };

    expect(await runActions(page as never, parseActions("click:#menu;hover:#trigger"), 1000)).toBe(handle as never);
    expect(await runActions(page as never, parseActions("hover:#trigger;click:#trigger"), 1000)).toBeNull();
  });
 
  it("scrolls the first attached target with the action timeout and settling delay", async () => {
    const events: string[] = [];
    const page = {
      locator: (selector: string) => {
        events.push(`locator:${selector}`);
        return {
          first: () => ({
            waitFor: async (options: { state: string; timeout: number }) => {
              events.push(`attached:${options.state}:${options.timeout}`);
            },
            scrollIntoViewIfNeeded: async (options: { timeout: number }) => {
              events.push(`scroll:${options.timeout}`);
            },
            click: async () => { events.push("click"); },
          }),
        };
      },
      waitForTimeout: async (ms: number) => { events.push(`settle:${ms}`); },
    };

    await runActions(page as never, parseActions("scroll:#target;click:#next"), 1234);

    expect(events).toEqual([
      "locator:#target", "attached:attached:1234", "scroll:1234", "settle:400",
      "locator:#next", "attached:attached:1234", "click", "settle:400",
    ]);
  });

  it("scrolls in ordered wheel increments at the configured pixel speed", async () => {
    const moves: string[] = [];
    const wheels: { x: number; y: number }[] = [];
    const page = {
      viewportSize: () => ({ width: 800, height: 600 }),
      mouse: {
        move: async (x: number, y: number) => { moves.push(`${x}:${y}`); },
        wheel: async (x: number, y: number) => { wheels.push({ x, y }); },
      },
      waitForTimeout: async () => {},
    };

    await runActions(page as never, parseActions("scroll:down(500px);scroll:up(25%);scroll:left(10px);scroll:right(50%)"), 1000);

    expect(moves).toEqual(["400:300", "400:300", "400:300", "400:300"]);
    expect(wheels).toHaveLength(22);
    expect(wheels.reduce((sum, wheel) => sum + wheel.x, 0)).toBe(390);
    expect(wheels.reduce((sum, wheel) => sum + wheel.y, 0)).toBe(350);
  });

  it("keeps the scroll action duration proportional to distance and configured speed", async () => {
    const waits: number[] = [];
    const wheels: number[] = [];
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const page = {
      viewportSize: () => ({ width: 800, height: 600 }),
      mouse: { move: async () => {}, wheel: async (_x: number, y: number) => { wheels.push(y); } },
      waitForTimeout: async (ms: number) => { waits.push(ms); now += ms; },
    };

    try {
      await runActions(page as never, parseActions("scroll:down(2000px)"), 1000, undefined, 2000);

      expect(wheels).toHaveLength(20);
      expect(wheels.reduce((sum, y) => sum + y, 0)).toBe(2000);
      expect(waits.reduce((sum, ms) => sum + ms, 0)).toBe(1400);
    } finally {
      clock.mockRestore();
    }
  });
  it("does not add wheel dispatch latency to the configured scroll duration", async () => {
    const waits: number[] = [];
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const page = {
      viewportSize: () => ({ width: 800, height: 600 }),
      mouse: {
        move: async () => {},
        wheel: async () => { now += 30; },
      },
      waitForTimeout: async (ms: number) => { waits.push(ms); now += ms; },
    };

    try {
      await runActions(page as never, parseActions("scroll:down(200px)"), 1000);

      expect(waits).toEqual([20, 20, 20, 20, 400]);
      expect(now).toBe(600);
    } finally {
      clock.mockRestore();
    }
  });

 
});
