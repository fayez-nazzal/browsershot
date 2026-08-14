import { expect, test } from "bun:test";
import { renderLooksBlank, parseHtmlClassFlag } from "../src/capture.ts";

test("renderLooksBlank flags an empty SPA shell", () => {
  expect(renderLooksBlank({ textLength: 0, elementCount: 1 })).toBe(true);
  expect(renderLooksBlank({ textLength: 5, elementCount: 3 })).toBe(true);
});

test("renderLooksBlank passes a rendered page", () => {
  expect(renderLooksBlank({ textLength: 500, elementCount: 300 })).toBe(false);
});

test("renderLooksBlank passes a text-light but element-rich page", () => {
  expect(renderLooksBlank({ textLength: 3, elementCount: 80 })).toBe(false);
});

test("renderLooksBlank passes a text-heavy minimal-markup page", () => {
  expect(renderLooksBlank({ textLength: 2000, elementCount: 4 })).toBe(false);
});

test("parseHtmlClassFlag splits added classes on commas and spaces", () => {
  expect(parseHtmlClassFlag("dark")).toEqual({ add: ["dark"], remove: [] });
  expect(parseHtmlClassFlag("dark colorblind")).toEqual({ add: ["dark", "colorblind"], remove: [] });
  expect(parseHtmlClassFlag("dark,colorblind")).toEqual({ add: ["dark", "colorblind"], remove: [] });
});

test("parseHtmlClassFlag treats a leading dash as removal", () => {
  expect(parseHtmlClassFlag("-light,dark")).toEqual({ add: ["dark"], remove: ["light"] });
  expect(parseHtmlClassFlag("-light -dark colorblind")).toEqual({ add: ["colorblind"], remove: ["light", "dark"] });
});

test("parseHtmlClassFlag rejects an empty value", () => {
  expect(() => parseHtmlClassFlag("")).toThrow("--html-class needs at least one class name");
  expect(() => parseHtmlClassFlag("  ,  ")).toThrow("--html-class needs at least one class name");
});
