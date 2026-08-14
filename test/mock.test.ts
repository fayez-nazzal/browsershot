import { describe, expect, it } from "bun:test";
import { deepMerge, parseMocks } from "../src/mock.ts";

describe("deepMerge", () => {
  it("keeps every field the patch does not mention", () => {
    const base = { id: 7, feature_flags: { a: false, b: true } };
    const patch = { feature_flags: { a: true } };
    expect(deepMerge(base, patch)).toEqual({ id: 7, feature_flags: { a: true, b: true } });
  });

  it("adds a key the base does not have", () => {
    expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("replaces arrays instead of joining them", () => {
    expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
  });

  it("replaces a value when the base is not an object", () => {
    expect(deepMerge(5, { a: 1 })).toEqual({ a: 1 });
  });
});

describe("parseMocks", () => {
  it("reads a redirect entry and defaults to 302", () => {
    const mocks = parseMocks('{"mocks":[{"url":"**/subscriptions/new*","redirect":"https://x.test/go"}]}');
    expect(mocks).toEqual([
      { url: "**/subscriptions/new*", kind: "redirect", redirect: "https://x.test/go", status: 302 },
    ]);
  });

  it("reads a merge entry", () => {
    const mocks = parseMocks('{"mocks":[{"url":"**/user_info*","merge":{"feature_flags":{"paddle_checkout":true}}}]}');
    expect(mocks[0].kind).toBe("merge");
    expect(mocks[0].merge).toEqual({ feature_flags: { paddle_checkout: true } });
  });

  it("reads a json entry and honours an explicit status", () => {
    const mocks = parseMocks('{"mocks":[{"url":"**/thing","json":{"a":1},"status":404}]}');
    expect(mocks[0].kind).toBe("json");
    expect(mocks[0].status).toBe(404);
  });

  it("accepts a bare array", () => {
    const mocks = parseMocks('[{"url":"**/a","redirect":"https://x.test/b"}]');
    expect(mocks).toHaveLength(1);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseMocks("{nope")).toThrow("not valid JSON");
  });

  it("rejects an entry with no url", () => {
    expect(() => parseMocks('{"mocks":[{"redirect":"https://x.test/b"}]}')).toThrow('needs a "url" glob');
  });

  it("rejects an entry with no action", () => {
    expect(() => parseMocks('{"mocks":[{"url":"**/a"}]}')).toThrow("needs one of");
  });

  it("rejects an empty list", () => {
    expect(() => parseMocks('{"mocks":[]}')).toThrow("no entries");
  });
});
