import { expect, test } from "bun:test";
import { judgeLanding } from "../src/landing.ts";

const STATUS_TABLE: [number, boolean][] = [
  [200, true],
  [204, true],
  [302, true],
  [404, false],
  [500, false],
];

for (const [status, expectedOk] of STATUS_TABLE) {
  test(`judgeLanding on HTTP ${status} is ${expectedOk ? "ok" : "rejected"} by default`, () => {
    const verdict = judgeLanding(
      { httpStatus: status, finalUrl: "https://example.com", bodyText: "" },
      { allowStatus: false },
    );
    expect(verdict.ok).toBe(expectedOk);
  });
}

test("judgeLanding allows any status when --allow-status is set", () => {
  const verdict = judgeLanding(
    { httpStatus: 500, finalUrl: "https://example.com", bodyText: "" },
    { allowStatus: true },
  );
  expect(verdict.ok).toBe(true);
});

test("judgeLanding rejects a 404 with a reason naming the flag that overrides it", () => {
  const verdict = judgeLanding(
    { httpStatus: 404, finalUrl: "https://example.com", bodyText: "" },
    { allowStatus: false },
  );
  expect(verdict.ok).toBe(false);
  expect(verdict.reason).toContain("404");
  expect(verdict.reason).toContain("--allow-status");
});

test("judgeLanding rejects a 200 whose body is missing the expected text", () => {
  const verdict = judgeLanding(
    { httpStatus: 200, finalUrl: "https://example.com", bodyText: "nothing relevant here" },
    { allowStatus: false, expectText: "Welcome back" },
  );
  expect(verdict.ok).toBe(false);
  expect(verdict.reason).toContain("Welcome back");
});

test("judgeLanding accepts a 200 whose body contains the expected text", () => {
  const verdict = judgeLanding(
    { httpStatus: 200, finalUrl: "https://example.com", bodyText: "say Welcome back to the user" },
    { allowStatus: false, expectText: "Welcome back" },
  );
  expect(verdict.ok).toBe(true);
});
