import { expect, test } from "bun:test";
import {
  escapeHtml,
  highlightMarkup,
  shortenAttributeValues,
  stateRows,
  truncate,
  overlayPayload,
  type ElementRecord,
} from "../src/inspect.ts";

function record(overrides: Partial<ElementRecord> = {}): ElementRecord {
  const base: ElementRecord = {
    selector: "button",
    tagName: "button",
    role: "button (implicit)",
    name: "Menu",
    description: "",
    attributes: { type: "button", "aria-label": "Menu" },
    outerHTML: '<button type="button" aria-label="Menu"></button>',
    displayHTML: '<button type="button" aria-label="Menu"></button>',
    box: { x: 10, y: 20, width: 32, height: 32 },
  };
  return { ...base, ...overrides };
}

test("escapeHtml neutralises angle brackets and ampersands", () => {
  expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href="x"&gt;&amp;&lt;/a&gt;');
});

test("shortenAttributeValues collapses a long class list and counts it", () => {
  const long = Array.from({ length: 25 }, (_, i) => `class-${i}`).join(" ");
  const out = shortenAttributeValues(`<button class="${long}"></button>`);
  expect(out).toContain("25 classes");
  expect(out.length).toBeLessThan(long.length);
});

test("shortenAttributeValues leaves short values alone", () => {
  const html = '<button class="a b c"></button>';
  expect(shortenAttributeValues(html)).toBe(html);
});

test("shortenAttributeValues collapses a long inline style", () => {
  const style = "color:red;".repeat(20);
  expect(shortenAttributeValues(`<div style="${style}"></div>`)).toBe('<div style="…"></div>');
});

test("truncate adds an ellipsis only past the limit", () => {
  expect(truncate("abcdef", 3)).toBe("abc …");
  expect(truncate("ab", 5)).toBe("ab");
});

test("highlightMarkup colours tags, attribute names and values", () => {
  const out = highlightMarkup('<button type="button"></button>');
  expect(out).toContain("#5db0d7");
  expect(out).toContain("#9bbbdc");
  expect(out).toContain("#f29766");
});

test("highlightMarkup never re-processes its own span markup", () => {
  const out = highlightMarkup('<button type="button" class="x"></button>');
  expect(out).not.toContain("&lt;span");
  const strayColourAttribute = /<span style="color:#[0-9a-f]{6}">style<\/span>/.test(out);
  expect(strayColourAttribute).toBe(false);
});

test("highlightMarkup marks the requested attribute only", () => {
  const out = highlightMarkup('<button aria-expanded="false" type="button"></button>', "aria-expanded");
  expect(out).toContain("<mark");
  expect(out.match(/<mark/g)?.length).toBe(1);
});

test("highlightMarkup with no attribute adds no mark", () => {
  expect(highlightMarkup('<button type="button"></button>')).not.toContain("<mark");
});

test("stateRows always leads with role and name", () => {
  const rows = stateRows(record());
  expect(rows[0]!.label).toBe("Role");
  expect(rows[1]!.label).toBe("Name");
});

test("stateRows shows an empty name placeholder", () => {
  const rows = stateRows(record({ name: "" }));
  expect(rows[1]!.value).toBe("(empty)");
});

test("stateRows flags a requested attribute that is absent", () => {
  const rows = stateRows(record(), "aria-expanded");
  const target = rows.find((row) => row.label === "aria-expanded");
  expect(target?.value).toBe("(not present)");
  expect(target?.tone).toBe("bad");
});

test("stateRows marks a present requested attribute as good", () => {
  const rows = stateRows(record({ attributes: { "aria-expanded": "true" } }), "aria-expanded");
  const target = rows.find((row) => row.label === "aria-expanded");
  expect(target?.value).toBe("true");
  expect(target?.tone).toBe("good");
});

test("stateRows reports when no state is exposed at all", () => {
  const rows = stateRows(record({ attributes: { type: "button" } }));
  const target = rows.find((row) => row.label === "state");
  expect(target?.value).toBe("(none exposed)");
});

test("stateRows lists other aria state attributes it finds", () => {
  const rows = stateRows(record({ attributes: { "aria-checked": "mixed" } }));
  const target = rows.find((row) => row.label === "aria-checked");
  expect(target?.value).toBe("mixed");
});

test("overlayPayload carries the box and appends an optional note", () => {
  const payload = overlayPayload(record(), "aria-expanded", "captured on staging");
  expect(payload.box).toEqual({ x: 10, y: 20, width: 32, height: 32 });
  expect(payload.metaMarkup).toContain("captured on staging");
});

test("overlayPayload omits the note block when none is given", () => {
  const payload = overlayPayload(record(), "aria-expanded");
  expect(payload.metaMarkup).not.toContain("border-top:1px solid #3c4043");
});
