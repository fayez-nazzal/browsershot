import { expect, test } from "bun:test";
import { UsageError } from "../src/exit-codes.ts";
import { resolveOutputPath } from "../src/output-path.ts";
import { resolveRunOptions, type CaptureFlags } from "../src/run-options.ts";
import type { CaptureTarget } from "../src/capture-target.ts";

const now = new Date(2026, 8, 5, 14, 30, 12);
const paths = {
  directory: "/repo/.browsershot",
  config: "/repo/.browsershot/config.json",
  captures: "/repo/.browsershot/captures",
};

function resolveWithTarget(target: CaptureTarget, flags: CaptureFlags = {}) {
  return resolveRunOptions({ flags, profile: {}, paths, cwd: "/repo", now, target });
}

function pageTarget(overrides: Partial<CaptureTarget> = {}): CaptureTarget {
  const target: CaptureTarget = {
    url: "https://example.com/checkout",
    element: "#order-summary",
    expectElement: "#checkout-ready",
    expectText: "Checkout",
    actions: [{ kind: "click", value: "#promo" }],
    authUser: "member",
    authRedirect: "/login",
    viewport: { width: 1440, height: 900 },
    identity: { kind: "page", page: "checkout", element: "summary", setup: null },
  };
  return { ...target, ...overrides };
}

test("target defaults become capture fields", () => {
  const resolved = resolveWithTarget(pageTarget());
  expect(resolved.captured).toEqual({ kind: "page", page: "checkout", element: "summary", setup: null });
  expect(resolved.capture).toMatchObject({
    url: "https://example.com/checkout",
    element: "#order-summary",
    expectElement: "#checkout-ready",
    expectText: "Checkout",
    authRedirect: "/login",
    actions: [{ kind: "click", value: "#promo" }],
    viewport: { width: 1440, height: 900 },
  });
  expect(resolved.auth).toEqual({ requested: true, credentialsPath: undefined, user: "member" });
});

test("explicit flags replace target defaults", () => {
  const resolved = resolveWithTarget(pageTarget(), {
    element: "#total",
    "expect-element": "#ready",
    "auth-user": "admin",
    "auth-redirect": "/signin",
    size: "800x600",
  });
  expect(resolved.capture).toMatchObject({
    element: "#total",
    expectElement: "#ready",
    expectText: undefined,
    authRedirect: "/signin",
    viewport: { width: 800, height: 600 },
  });
  expect(resolved.auth.user).toBe("admin");
});

test("negative flags clear target values", () => {
  const resolved = resolveWithTarget(pageTarget(), { "no-element": true, "no-expect": true, "no-auth": true });
  expect(resolved.capture.element).toBeUndefined();
  expect(resolved.capture.expectElement).toBeUndefined();
  expect(resolved.capture.expectText).toBeUndefined();
  expect(resolved.auth).toEqual({ requested: false });
});

test("per-run act steps run after target steps in order", () => {
  const resolved = resolveWithTarget(pageTarget({ actions: [
    { kind: "focus", value: "#promo" },
    { kind: "click", value: "#promo" },
  ] }), { act: "wait:250;press:Enter" });
  expect(resolved.capture.actions).toEqual([
    { kind: "focus", value: "#promo" },
    { kind: "click", value: "#promo" },
    { kind: "wait", value: "250" },
    { kind: "press", value: "Enter" },
  ]);
});

test("a target element combined with --full-page is a usage error", () => {
  expect(() => resolveWithTarget(pageTarget(), { "full-page": true })).toThrow(UsageError);
  expect(() => resolveWithTarget(pageTarget(), { "full-page": true })).toThrow(/--element.*--full-page/);
});

test("output naming groups page captures by page and element names", () => {
  const resolved = resolveWithTarget(pageTarget({ identity: { kind: "page", page: "checkout", element: "summary", setup: "empty" } }), { label: "menu-open" });
  expect(resolved.outputPath).toBe("/repo/.browsershot/captures/checkout/summary_empty_menu-open_2026-09-05_14-30-12.png");
});

test("a page capture without a named element names the file page", () => {
  const target = pageTarget({ element: undefined, identity: { kind: "page", page: "checkout" } });
  const resolved = resolveWithTarget(target);
  expect(resolved.outputPath).toBe("/repo/.browsershot/captures/checkout/page_2026-09-05_14-30-12.png");
});

test("library captures name the file after the resolved entry with safe separators", () => {
  const target: CaptureTarget = {
    url: "https://storybook.example/iframe.html?id=button--primary&viewMode=story",
    identity: { kind: "library", library: "ui", entry: "button--primary" },
  };
  const resolved = resolveWithTarget(target, { label: "hover" });
  expect(resolved.outputPath).toBe("/repo/.browsershot/captures/ui/button-primary_hover_2026-09-05_14-30-12.png");
});

test("named captures omit the query suffix", () => {
  const withQuery = resolveOutputPath({
    capturesDirectory: paths.captures,
    url: "https://example.com/checkout?cart=empty",
    identity: { kind: "page", page: "checkout" },
    now,
  });
  expect(withQuery).toBe("/repo/.browsershot/captures/checkout/page_2026-09-05_14-30-12.png");
});

test("an absent or url identity keeps today's naming byte for byte", () => {
  const options = {
    capturesDirectory: paths.captures,
    url: "https://example.com/pricing?plan=pro",
    now,
  };
  const withoutIdentity = resolveOutputPath(options);
  const withUrlIdentity = resolveOutputPath({ ...options, identity: { kind: "url" } });
  expect(withoutIdentity).toBe(withUrlIdentity);
  expect(withUrlIdentity).toMatch(/^\/repo\/\.browsershot\/captures\/example\.com\/pricing_q-plan-[0-9a-f]{12}_2026-09-05_14-30-12\.png$/);
});

test("an oversized element name is truncated inside the 255-byte file name limit", () => {
  const oversized = "e".repeat(400);
  const path = resolveOutputPath({
    capturesDirectory: paths.captures,
    url: "https://example.com/checkout",
    identity: { kind: "page", page: "checkout", element: oversized },
    now,
  });
  const fileName = path.split("/").pop()!;
  expect(Buffer.byteLength(fileName, "utf8")).toBeLessThanOrEqual(255);
  expect(fileName.endsWith("_2026-09-05_14-30-12.png")).toBe(true);
});

test("group and output keep their precedence for named captures", () => {
  const grouped = resolveWithTarget(pageTarget({ identity: { kind: "page", page: "checkout" } }), { group: "PR-123" });
  expect(grouped.outputPath).toBe("/repo/.browsershot/captures/PR-123/checkout/page_2026-09-05_14-30-12.png");
  const explicit = resolveWithTarget(pageTarget(), { output: "/tmp/exact.png" });
  expect(explicit.outputPath).toBe("/tmp/exact.png");
});
