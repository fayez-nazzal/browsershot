import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pagesFilePath,
  readPages,
  resolvePageTarget,
  savePage,
  savePageElement,
  savePageSetup,
  type SavedPage,
} from "../src/pages.ts";
import { UsageError } from "../src/exit-codes.ts";
import { resolveRunOptions, type CaptureFlags } from "../src/run-options.ts";

const now = new Date(2026, 8, 5, 14, 30, 12);
const profile = { baseUrl: "https://example.com/app" };
const paths = {
  directory: "/repo/.browsershot",
  config: "/repo/.browsershot/config.json",
  captures: "/repo/.browsershot/captures",
};

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-pages-test-"));
}

function checkoutPage(overrides: Partial<SavedPage> = {}): SavedPage {
  const page: SavedPage = {
    route: "/checkout",
    authUser: "member",
    expectElement: "#checkout-ready",
    act: "click:#promo;wait:250",
    size: "1440x900",
    elements: { summary: "#order-summary" },
    setups: {
      empty: { route: "/checkout/empty" },
      admin: { authUser: "admin", act: "click:#impersonate" },
    },
  };
  return { ...page, ...overrides };
}

function resolveOutput(root: string, names: { page: string; element?: string; setup?: string }, flags: CaptureFlags = {}): string {
  const target = resolvePageTarget({ root, ...names, profile });
  return resolveRunOptions({ flags, profile: {}, paths, cwd: "/repo", now, target }).outputPath;
}

test("saved pages round trip through the workspace file", () => {
  const root = scratch();
  const page = checkoutPage();
  expect(readPages(root)).toEqual({ version: 1, pages: {} });
  expect(savePage(root, "checkout", page)).toEqual({ version: 1, pages: { checkout: page } });
  expect(readPages(root)).toEqual({ version: 1, pages: { checkout: page } });
  expect(pagesFilePath(root)).toBe(join(root, ".browsershot", "pages.json"));
  expect(existsSync(pagesFilePath(root))).toBe(true);
  expect(JSON.parse(readFileSync(pagesFilePath(root), "utf8"))).toEqual({ version: 1, pages: { checkout: page } });
});

test("atomic page writes leave a parseable file and no temporary leftovers", () => {
  const root = scratch();
  savePage(root, "checkout", checkoutPage());
  expect(Object.keys(JSON.parse(readFileSync(pagesFilePath(root), "utf8")).pages)).toEqual(["checkout"]);
  savePage(root, "billing", { route: "/billing" });
  expect(Object.keys(JSON.parse(readFileSync(pagesFilePath(root), "utf8")).pages).sort()).toEqual(["billing", "checkout"]);
  expect(readdirSync(join(root, ".browsershot")).some((name) => name.endsWith(".tmp"))).toBe(false);
});

test("a malformed or invalid pages file is a usage error", () => {
  const root = scratch();
  mkdirSync(join(root, ".browsershot"), { recursive: true });
  writeFileSync(pagesFilePath(root), "{not-json");
  expect(() => readPages(root)).toThrow(UsageError);
  expect(() => readPages(root)).toThrow(/malformed pages file:/);
  writeFileSync(pagesFilePath(root), JSON.stringify({ version: 2, pages: {} }));
  expect(() => readPages(root)).toThrow(`invalid pages file: ${pagesFilePath(root)}`);
});

test("duplicate reserved and malformed page names are rejected", () => {
  const root = scratch();
  savePage(root, "checkout", checkoutPage());
  expect(() => savePage(root, "checkout", { route: "/checkout-again" })).toThrow(UsageError);
  expect(() => savePage(root, "checkout", { route: "/checkout-again" })).toThrow('page "checkout" already exists; remove it first');
  for (const word of ["add", "element", "setup", "list", "show", "remove"]) {
    expect(() => savePage(root, word, { route: "/reserved" })).toThrow(`page name "${word}" is reserved; reserved words: add, element, setup, list, show, remove`);
  }
  expect(() => savePage(root, "Checkout", { route: "/checkout" })).toThrow('invalid page name "Checkout"; names match [a-z0-9][a-z0-9_-]*');
  expect(() => savePage(root, "-checkout", { route: "/checkout" })).toThrow('invalid page name "-checkout"; names match [a-z0-9][a-z0-9_-]*');
  expect(() => savePage(root, "", { route: "/checkout" })).toThrow('invalid page name ""; names match [a-z0-9][a-z0-9_-]*');
  expect(Object.keys(readPages(root).pages)).toEqual(["checkout"]);
});

test("page and setup writes validate routes selectors actions and sizes", () => {
  const root = scratch();
  expect(() => savePage(root, "checkout", { route: "" })).toThrow('page "checkout" needs a non-empty route');
  expect(() => savePage(root, "checkout", { route: "   " })).toThrow('page "checkout" needs a non-empty route');
  expect(() => savePage(root, "checkout", { route: "/checkout", act: "x:y" })).toThrow('invalid act on page "checkout": --act step "x:y" has an unknown kind; use one of focus, click, hover, press, type, wait');
  expect(() => savePage(root, "checkout", { route: "/checkout", size: "wide" })).toThrow('invalid size on page "checkout": "wide"');
  savePage(root, "checkout", { route: "/checkout" });
  expect(() => savePageElement(root, "checkout", "summary", "")).toThrow('element "summary" on page "checkout" needs a non-empty selector');
  expect(() => savePageSetup(root, "checkout", "empty", {})).toThrow('setup "empty" on page "checkout" needs at least one setting');
  expect(() => savePageSetup(root, "checkout", "empty", { size: "wide" })).toThrow('invalid size on setup "empty" of page "checkout": "wide"');
  expect(readPages(root).pages.checkout).toEqual({ route: "/checkout" });
});

test("page defaults become capture target fields", () => {
  const root = scratch();
  savePage(root, "checkout", checkoutPage());
  expect(resolvePageTarget({ root, page: "checkout", element: "summary", profile })).toEqual({
    url: "https://example.com/app/checkout",
    element: "#order-summary",
    expectElement: "#checkout-ready",
    authUser: "member",
    actions: [{ kind: "click", value: "#promo" }, { kind: "wait", value: "250" }],
    viewport: { width: 1440, height: 900 },
    identity: { kind: "page", page: "checkout", element: "summary", setup: null },
  });
});

test("a setup replaces the fields it declares and its actions run last", () => {
  const root = scratch();
  savePage(root, "checkout", checkoutPage());
  const admin = resolvePageTarget({ root, page: "checkout", element: "summary", setup: "admin", profile });
  expect(admin.url).toBe("https://example.com/app/checkout");
  expect(admin.authUser).toBe("admin");
  expect(admin.actions).toEqual([
    { kind: "click", value: "#promo" },
    { kind: "wait", value: "250" },
    { kind: "click", value: "#impersonate" },
  ]);
  expect(admin.identity).toEqual({ kind: "page", page: "checkout", element: "summary", setup: "admin" });
  const empty = resolvePageTarget({ root, page: "checkout", setup: "empty", profile });
  expect(empty.url).toBe("https://example.com/app/checkout/empty");
  expect(empty.element).toBeUndefined();
  expect(empty.authUser).toBe("member");
  expect(empty.identity).toEqual({ kind: "page", page: "checkout", element: null, setup: "empty" });
});

test("a saved route resolves like a quick path and needs a saved baseUrl", () => {
  const root = scratch();
  savePage(root, "checkout", { route: "/checkout" });
  savePage(root, "docs", { route: "https://docs.example.com/guide" });
  expect(resolvePageTarget({ root, page: "checkout", profile: { baseUrl: "http://localhost:8990/app#/workspaces/8" } }).url).toBe("http://localhost:8990/app#/workspaces/8/checkout");
  expect(resolvePageTarget({ root, page: "docs", profile: {} }).url).toBe("https://docs.example.com/guide");
  expect(() => resolvePageTarget({ root, page: "checkout", profile: {} })).toThrow(UsageError);
  expect(() => resolvePageTarget({ root, page: "checkout", profile: {} })).toThrow(/quick capture needs a saved baseUrl/);
});

test("unknown page element and setup names list the known names", () => {
  const root = scratch();
  savePage(root, "dashboard", { route: "/dashboard" });
  savePage(root, "billing", { route: "/billing" });
  savePage(root, "checkout", checkoutPage());
  expect(() => resolvePageTarget({ root, page: "invoices", profile })).toThrow(UsageError);
  expect(() => resolvePageTarget({ root, page: "invoices", profile })).toThrow('unknown page "invoices"; known pages: billing, checkout, dashboard');
  expect(() => resolvePageTarget({ root, page: "checkout", element: "total", profile })).toThrow('unknown element "total" on page "checkout"; known elements: summary');
  expect(() => resolvePageTarget({ root, page: "checkout", setup: "guest", profile })).toThrow('unknown setup "guest" on page "checkout"; known setups: admin, empty');
  expect(() => resolvePageTarget({ root, page: "billing", element: "summary", profile })).toThrow('unknown element "summary" on page "billing"; known elements: (none)');
});

test("named page captures derive their output path from the saved names", () => {
  const root = scratch();
  savePage(root, "checkout", checkoutPage());
  expect(resolveOutput(root, { page: "checkout", element: "summary" })).toBe("/repo/.browsershot/captures/checkout/summary_2026-09-05_14-30-12.png");
  expect(resolveOutput(root, { page: "checkout", element: "summary", setup: "empty" })).toBe("/repo/.browsershot/captures/checkout/summary_empty_2026-09-05_14-30-12.png");
  expect(resolveOutput(root, { page: "checkout", element: "summary", setup: "empty" }, { label: "menu-open" })).toBe("/repo/.browsershot/captures/checkout/summary_empty_menu-open_2026-09-05_14-30-12.png");
  expect(resolveOutput(root, { page: "checkout" })).toBe("/repo/.browsershot/captures/checkout/page_2026-09-05_14-30-12.png");
});

test("an oversized element name stays inside the 255-byte file name limit", () => {
  const root = scratch();
  const oversized = "e".repeat(400);
  savePage(root, "checkout", { route: "/checkout", elements: { [oversized]: "#order-summary" } });
  const fileName = resolveOutput(root, { page: "checkout", element: oversized }).split("/").pop()!;
  expect(Buffer.byteLength(fileName, "utf8")).toBeLessThanOrEqual(255);
  expect(fileName.endsWith("_2026-09-05_14-30-12.png")).toBe(true);
});
