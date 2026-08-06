import { describe, expect, it } from "bun:test";
import { parseActions } from "../src/act.ts";

describe("parseActions", () => {
  it("reads a list of steps in order", () => {
    const actions = parseActions("focus:button.menu; press:Enter; wait:800");
    expect(actions).toEqual([
      { kind: "focus", value: "button.menu" },
      { kind: "press", value: "Enter" },
      { kind: "wait", value: "800" },
    ]);
  });

  it("keeps colons that belong to the value", () => {
    const actions = parseActions('click:button[aria-label="a: b"]');
    expect(actions[0]).toEqual({ kind: "click", value: 'button[aria-label="a: b"]' });
  });

  it("rejects an empty spec", () => {
    expect(() => parseActions("   ")).toThrow("at least one step");
  });

  it("rejects a step with no kind", () => {
    expect(() => parseActions("Enter")).toThrow("needs a kind and a value");
  });

  it("rejects an unknown kind", () => {
    expect(() => parseActions("hover:button")).toThrow("unknown kind");
  });

  it("rejects a step with no value", () => {
    expect(() => parseActions("press:")).toThrow("needs a value");
  });

  it("rejects a wait that is not a whole number", () => {
    expect(() => parseActions("wait:soon")).toThrow("whole number");
  });
});
