import { describe, expect, it } from "bun:test";
import { cursorPosition, cursorSvg, resolveCursorKind, urlPreviewPosition } from "../src/hover-cursor.ts";

describe("resolveCursorKind", () => {
  it("uses the computed CSS cursor keyword", () => {
    expect(resolveCursorKind("pointer", { tagName: "button", inputType: null, editable: false, hasHref: false })).toBe("pointer");
    expect(resolveCursorKind("ew-resize", { tagName: "div", inputType: null, editable: false, hasHref: false })).toBe("ew-resize");
  });

  it("uses a custom cursor's declared fallback", () => {
    expect(resolveCursorKind('url("cursor.svg") 4 2, grab', { tagName: "div", inputType: null, editable: false, hasHref: false })).toBe("grab");
  });

  it("renders no overlay for cursor none", () => {
    expect(resolveCursorKind("none", { tagName: "div", inputType: null, editable: false, hasHref: false })).toBeNull();
  });

  it("resolves auto from native element semantics", () => {
    expect(resolveCursorKind("auto", { tagName: "input", inputType: "text", editable: false, hasHref: false })).toBe("text");
    expect(resolveCursorKind("auto", { tagName: "a", inputType: null, editable: false, hasHref: true })).toBe("pointer");
    expect(resolveCursorKind("auto", { tagName: "button", inputType: null, editable: false, hasHref: false })).toBe("default");
  });

  it("falls back safely for unsupported cursor values", () => {
    expect(resolveCursorKind("paintbrush", { tagName: "div", inputType: null, editable: false, hasHref: false })).toBe("default");
  });
});

describe("cursorPosition", () => {
  it("centers the cursor horizontally and anchors it four pixels from the bottom", () => {
    expect(cursorPosition(
      { left: 20, top: 30, right: 100, bottom: 80 },
      { left: 0, top: 0, right: 320, bottom: 200 },
    )).toEqual({ left: 46, top: 76 });
  });

  it("keeps the complete cursor inside the captured area", () => {
    expect(cursorPosition(
      { left: 280, top: 160, right: 320, bottom: 200 },
      { left: 0, top: 0, right: 320, bottom: 200 },
    )).toEqual({ left: 286, top: 164 });
  });
});

describe("urlPreviewPosition", () => {
  it("centers a URL pill fully below the cursor", () => {
    expect(urlPreviewPosition(
      { left: 100, top: 100, right: 300, bottom: 180 },
      { width: 160, height: 28 },
      { left: 0, top: 0, right: 400, bottom: 400 },
    )).toEqual({ left: 120, top: 216 });
  });

  it("clamps the URL pill when the bottom edge is crowded", () => {
    expect(urlPreviewPosition(
      { left: 100, top: 5, right: 300, bottom: 30 },
      { width: 160, height: 28 },
      { left: 0, top: 0, right: 400, bottom: 400 },
    )).toEqual({ left: 120, top: 66 });
  });
});

describe("cursorSvg", () => {
  it("renders polished and distinct pointer, text, and resize SVGs", () => {
    const pointer = cursorSvg("pointer");
    expect(pointer).toContain("<svg");
    expect(pointer).toContain("filter");
    expect(pointer).toContain("browsershot-cursor-pointer");
    expect(cursorSvg("text")).toContain("browsershot-cursor-text");
    expect(cursorSvg("ew-resize")).toContain("browsershot-cursor-resize-horizontal");
  });
});
