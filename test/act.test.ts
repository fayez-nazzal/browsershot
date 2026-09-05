import { describe, expect, it } from "bun:test";
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
});
