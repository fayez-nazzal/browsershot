import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-pages-cli-test-"));
}

function run(root: string, ...args: string[]) {
  return Bun.spawnSync(["bun", CLI, ...args], { cwd: root });
}

function readPagesJson(root: string) {
  const path = join(root, ".browsershot", "pages.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

test("page list prints valid empty json on a fresh workspace", () => {
  const root = scratch();
  const proc = run(root, "page", "list");
  expect(proc.exitCode).toBe(0);
  expect(JSON.parse(proc.stdout.toString())).toEqual({ version: 1, pages: {} });
});

test("page add stores accepted flags and rejects capture-only flags", () => {
  const root = scratch();
  const valid = run(
    root,
    "page",
    "add",
    "checkout",
    "/checkout",
    "--auth-user",
    "member",
    "--expect-element",
    "#ready",
    "--act",
    "click:#promo",
    "--size",
    "1280x800",
  );
  expect(valid.exitCode).toBe(0);
  expect(JSON.parse(valid.stdout.toString())).toEqual(readPagesJson(root));
  expect(readPagesJson(root).pages.checkout).toEqual({
    route: "/checkout",
    authUser: "member",
    expectElement: "#ready",
    act: "click:#promo",
    size: "1280x800",
  });

  const invalid = run(root, "page", "add", "billing", "/billing", "--delay", "5");
  expect(invalid.exitCode).toBe(2);
  expect(invalid.stderr.toString()).toContain(
    "page add accepts only --auth-user, --auth-redirect, --expect-element, --expect-text, --act, and --size",
  );
});

test("page add rejects duplicate page names", () => {
  const root = scratch();
  expect(run(root, "page", "add", "checkout", "/checkout").exitCode).toBe(0);
  const duplicate = run(root, "page", "add", "checkout", "/checkout-again");
  expect(duplicate.exitCode).toBe(2);
  expect(duplicate.stderr.toString()).toContain('page "checkout" already exists; remove it first');
  expect(readPagesJson(root).pages.checkout.route).toBe("/checkout");
});

test("capturing an unknown page fails with exit 2 and names the known pages", () => {
  const root = scratch();
  run(root, "page", "add", "billing", "/billing");
  const proc = run(root, "page", "checkout");
  expect(proc.exitCode).toBe(2);
  expect(proc.stderr.toString()).toMatch(/unknown page "checkout"; known pages: billing/);
});

test("the --setup flag is rejected on a plain url capture", () => {
  const root = scratch();
  const out = join(root, "out.png");
  const proc = run(root, "https://example.com", "--setup", "empty", "--output", out);
  expect(proc.exitCode).toBe(2);
  expect(proc.stderr.toString()).toContain("--setup is only valid when capturing a page");
  expect(existsSync(out)).toBe(false);
});

test("page element setup and remove mutate the saved definitions", () => {
  const root = scratch();
  run(root, "page", "add", "checkout", "/checkout");

  const elementProc = run(root, "page", "element", "checkout", "summary", "#order-summary");
  expect(elementProc.exitCode).toBe(0);
  expect(readPagesJson(root).pages.checkout.elements).toEqual({ summary: "#order-summary" });

  const setupProc = run(root, "page", "setup", "checkout", "empty", "/checkout?cart=empty");
  expect(setupProc.exitCode).toBe(0);
  expect(readPagesJson(root).pages.checkout.setups.empty).toEqual({ route: "/checkout?cart=empty" });

  const removeSetup = run(root, "page", "remove", "checkout", "empty");
  expect(removeSetup.exitCode).toBe(0);
  expect(readPagesJson(root).pages.checkout.setups.empty).toBeUndefined();

  const removeElement = run(root, "page", "remove", "checkout", "summary");
  expect(removeElement.exitCode).toBe(0);
  expect(readPagesJson(root).pages.checkout.elements.summary).toBeUndefined();

  const removePage = run(root, "page", "remove", "checkout");
  expect(removePage.exitCode).toBe(0);
  expect(readPagesJson(root).pages.checkout).toBeUndefined();
});

test("combining a named element with full page capture is a usage error", () => {
  const root = scratch();
  run(root, "page", "add", "checkout", "https://example.com/checkout");
  run(root, "page", "element", "checkout", "summary", "#order-summary");

  const proc = run(root, "page", "checkout", "summary", "--full-page");
  expect(proc.exitCode).toBe(2);
  expect(proc.stderr.toString()).toMatch(/--element.*--full-page/);
});
