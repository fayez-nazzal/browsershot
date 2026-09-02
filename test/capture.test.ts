import { expect, test } from "bun:test";
import { renderLooksBlank } from "../src/capture.ts";

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

