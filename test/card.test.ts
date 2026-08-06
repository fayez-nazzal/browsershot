import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCardHtml, parsePair, sidecarPath, readRecord, dataUri, buildSide, DEFAULT_LABELS } from "../src/card.ts";
import type { StateRow } from "../src/inspect.ts";

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
  "hex",
);

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-card-test-"));
}

function rows(): StateRow[] {
  return [{ label: "Role", value: "button", tone: "plain" }];
}

test("parsePair splits and trims a before,after pair", () => {
  expect(parsePair(" a.png , b.png ", "compare")).toEqual({ before: "a.png", after: "b.png" });
});

test("parsePair rejects the wrong arity or empty sides", () => {
  expect(() => parsePair("a.png", "compare")).toThrow(/--compare must look like/);
  expect(() => parsePair("a.png,b.png,c.png", "compare")).toThrow(/--compare must look like/);
  expect(() => parsePair("a.png,", "compare")).toThrow(/--compare must look like/);
});

test("parsePair names the flag it was called for", () => {
  expect(() => parsePair("only", "compare-labels")).toThrow(/--compare-labels must look like/);
});

test("sidecarPath swaps a png extension and appends otherwise", () => {
  expect(sidecarPath("/tmp/shot.png")).toBe("/tmp/shot.json");
  expect(sidecarPath("/tmp/shot.PNG")).toBe("/tmp/shot.json");
  expect(sidecarPath("/tmp/shot")).toBe("/tmp/shot.json");
});

test("readRecord returns null when no sidecar exists", () => {
  const dir = scratch();
  expect(readRecord(join(dir, "missing.png"))).toBeNull();
});

test("readRecord parses a sidecar next to the image", () => {
  const dir = scratch();
  const png = join(dir, "shot.png");
  writeFileSync(join(dir, "shot.json"), JSON.stringify({ selector: "button", role: "button" }));
  const parsed = readRecord(png);
  expect(parsed?.selector).toBe("button");
});

test("dataUri fails loudly on a missing image", () => {
  expect(() => dataUri(join(scratch(), "nope.png"))).toThrow(/could not read/);
});

test("dataUri base64 inlines a real png", () => {
  const dir = scratch();
  const png = join(dir, "shot.png");
  writeFileSync(png, PNG_BYTES);
  expect(dataUri(png)).toStartWith("data:image/png;base64,iVBOR");
});

test("buildSide falls back to the file name when there is no sidecar", () => {
  const dir = scratch();
  const png = join(dir, "shot.png");
  writeFileSync(png, PNG_BYTES);
  const side = buildSide(png, "staging");
  expect(side.caption).toBe("shot.png");
  expect(side.rows).toEqual([]);
});

test("buildSide uses the sidecar selector and state rows when present", () => {
  const dir = scratch();
  const png = join(dir, "shot.png");
  writeFileSync(png, PNG_BYTES);
  writeFileSync(
    join(dir, "shot.json"),
    JSON.stringify({ selector: "header button", role: "button", name: "Menu", description: "", attributes: { "aria-expanded": "false" } }),
  );
  const side = buildSide(png, "staging", "aria-expanded");
  expect(side.caption).toBe("header button");
  const target = side.rows.find((row) => row.label === "aria-expanded");
  expect(target?.value).toBe("false");
});

test("buildCardHtml renders both columns with their labels", () => {
  const html = buildCardHtml({
    title: "hamburger expand state",
    chips: ["2699219", "Serious"],
    before: { label: "staging", imageUri: "data:image/png;base64,AAA", rows: rows(), caption: "header button" },
    after: { label: "tasks/10917", imageUri: "data:image/png;base64,BBB", rows: rows(), caption: "header button" },
  });
  expect(html).toContain("hamburger expand state");
  expect(html).toContain("staging");
  expect(html).toContain("tasks/10917");
  expect(html).toContain("data:image/png;base64,AAA");
  expect(html).toContain("data:image/png;base64,BBB");
});

test("buildCardHtml escapes titles and captions", () => {
  const html = buildCardHtml({
    title: "<script>alert(1)</script>",
    chips: [],
    before: { label: "a", imageUri: "x", rows: [], caption: "<b>" },
    after: { label: "b", imageUri: "y", rows: [], caption: "<i>" },
  });
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;");
});

test("buildCardHtml omits the chip row when there are no chips", () => {
  const html = buildCardHtml({
    title: "t",
    chips: [],
    before: { label: "a", imageUri: "x", rows: [], caption: "c" },
    after: { label: "b", imageUri: "y", rows: [], caption: "c" },
  });
  expect(html).not.toContain('class="meta"');
});

test("default labels are before and after", () => {
  expect(DEFAULT_LABELS).toEqual({ before: "before", after: "after" });
});
