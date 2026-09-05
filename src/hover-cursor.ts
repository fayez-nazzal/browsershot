import type { Page } from "playwright";
import type { HoverElementHandle } from "./act.ts";

export type CursorKind =
  | "default" | "context-menu" | "help" | "pointer" | "progress" | "wait"
  | "cell" | "crosshair" | "text" | "vertical-text" | "alias" | "copy"
  | "move" | "no-drop" | "not-allowed" | "grab" | "grabbing" | "all-scroll"
  | "col-resize" | "row-resize" | "n-resize" | "e-resize" | "s-resize" | "w-resize"
  | "ne-resize" | "nw-resize" | "se-resize" | "sw-resize" | "ew-resize"
  | "ns-resize" | "nesw-resize" | "nwse-resize" | "zoom-in" | "zoom-out";

export interface CursorSemantics {
  tagName: string;
  inputType: string | null;
  editable: boolean;
  hasHref: boolean;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const CURSOR_KINDS = new Set<CursorKind>([
  "default", "context-menu", "help", "pointer", "progress", "wait", "cell",
  "crosshair", "text", "vertical-text", "alias", "copy", "move", "no-drop",
  "not-allowed", "grab", "grabbing", "all-scroll", "col-resize", "row-resize",
  "n-resize", "e-resize", "s-resize", "w-resize", "ne-resize", "nw-resize",
  "se-resize", "sw-resize", "ew-resize", "ns-resize", "nesw-resize",
  "nwse-resize", "zoom-in", "zoom-out",
]);

const TEXT_INPUT_TYPES = new Set(["email", "number", "password", "search", "tel", "text", "url"]);
const CURSOR_WIDTH = 28;
const CURSOR_HEIGHT = 32;
const CURSOR_HOTSPOT = 2;
const CURSOR_BOTTOM_OFFSET = 4;
const CAPTURE_MARGIN = 4;
const URL_PREVIEW_GAP = 8;
const OVERLAY_ATTRIBUTE = "data-browsershot-hover-cursor";
const URL_PREVIEW_ATTRIBUTE = "data-browsershot-hover-url";

function automaticCursor(semantics: CursorSemantics): CursorKind {
  const tag = semantics.tagName.toLowerCase();
  if (semantics.editable || tag === "textarea" || (tag === "input" && semantics.inputType != null && TEXT_INPUT_TYPES.has(semantics.inputType))) {
    return "text";
  }
  if ((tag === "a" || tag === "area") && semantics.hasHref) {
    return "pointer";
  }
  return "default";
}

export function resolveCursorKind(rawCursor: string, semantics: CursorSemantics): CursorKind | null {
  const cursor = rawCursor.trim().toLowerCase();
  if (cursor === "none") {
    return null;
  }
  if (cursor === "auto") {
    return automaticCursor(semantics);
  }
  if (CURSOR_KINDS.has(cursor as CursorKind)) {
    return cursor as CursorKind;
  }
  const fallback = cursor.match(/,\s*([a-z-]+)\s*$/)?.[1];
  if (fallback === "none") {
    return null;
  }
  if (fallback === "auto") {
    return automaticCursor(semantics);
  }
  if (fallback != null && CURSOR_KINDS.has(fallback as CursorKind)) {
    return fallback as CursorKind;
  }
  return "default";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function cursorPosition(element: Rect, capture: Rect): { left: number; top: number } {
  const desiredLeft = (element.left + element.right) / 2 - CURSOR_WIDTH / 2;
  const desiredTop = element.bottom - CURSOR_BOTTOM_OFFSET;
  return {
    left: clamp(desiredLeft, capture.left + CAPTURE_MARGIN, capture.right - CURSOR_WIDTH - CAPTURE_MARGIN),
    top: clamp(desiredTop, capture.top + CAPTURE_MARGIN, capture.bottom - CURSOR_HEIGHT - CAPTURE_MARGIN),
  };
}

export function urlPreviewPosition(
  element: Rect,
  label: { width: number; height: number },
  capture: Rect,
): { left: number; top: number } {
  const cursor = cursorPosition(element, capture);
  const cursorCenter = cursor.left + CURSOR_WIDTH / 2;
  const centeredLeft = cursorCenter - label.width / 2;
  const top = cursor.top + CURSOR_HEIGHT + URL_PREVIEW_GAP;
  return {
    left: clamp(centeredLeft, capture.left + CAPTURE_MARGIN, capture.right - label.width - CAPTURE_MARGIN),
    top: clamp(top, capture.top + CAPTURE_MARGIN, capture.bottom - label.height - CAPTURE_MARGIN),
  };
}

function svg(name: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CURSOR_WIDTH}" height="${CURSOR_HEIGHT}" viewBox="0 0 ${CURSOR_WIDTH} ${CURSOR_HEIGHT}" fill="none" data-cursor-art="browsershot-cursor-${name}">
  <defs><filter id="shadow" x="-40%" y="-30%" width="190%" height="190%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.35" flood-color="#000" flood-opacity=".28"/></filter></defs>
  <g filter="url(#shadow)" stroke="#17191d" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${body}</g>
</svg>`;
}

const ARROW = `<path fill="#fff" d="M2.4 2.2 20 18.1l-8.05.25 4.55 9.05-4.1 2.05-4.45-8.95-5.55 5.65V2.2Z"/>`;
const HAND = `<path fill="#fff" d="M8.2 14.3V5.8a2 2 0 0 1 4 0v6.1-1.6a2 2 0 0 1 4 0v2-1.15a2 2 0 0 1 4 0v2.05-.65a2 2 0 0 1 4 0v6.25c0 6.15-3.55 10.2-9.6 10.2-3.7 0-6.15-1.75-7.7-4.75l-3.55-6.8a2.2 2.2 0 0 1 3.8-2.2l1.05 1.55v-2.5Z"/>`;
const GRAB = `<path fill="#fff" d="M5.2 14.2v-3a1.85 1.85 0 0 1 3.7 0V8.4a1.9 1.9 0 0 1 3.8 0v2.05-3.1a1.9 1.9 0 0 1 3.8 0v3.4-2.1a1.9 1.9 0 0 1 3.8 0v8.55c0 6.65-3.35 10.4-8.65 10.4-3.45 0-5.8-1.8-7.25-4.75l-2.2-4.55a2 2 0 0 1 3-2.5v-1.6Z"/>`;

function outlined(path: string): string {
  return `<path d="${path}" stroke="#fff" stroke-width="4.4"/><path d="${path}"/>`;
}

function resizeSvg(kind: CursorKind): string {
  let angle = 0;
  let name = "horizontal";
  if (["n-resize", "s-resize", "ns-resize", "row-resize"].includes(kind)) {
    angle = 90;
    name = "vertical";
  } else if (["ne-resize", "sw-resize", "nesw-resize"].includes(kind)) {
    angle = -45;
    name = "diagonal-up";
  } else if (["nw-resize", "se-resize", "nwse-resize"].includes(kind)) {
    angle = 45;
    name = "diagonal-down";
  }
  return svg(`resize-${name}`, `<g transform="rotate(${angle} 14 16)">${outlined("M4 16h20M4 16l5-5M4 16l5 5M24 16l-5-5M24 16l-5 5")}</g>`);
}

export function cursorSvg(kind: CursorKind): string {
  if (["pointer"].includes(kind)) {
    return svg("pointer", HAND);
  }
  if (kind === "text") {
    return svg("text", outlined("M9 5h10M14 5v22M9 27h10M11 16h6"));
  }
  if (kind === "vertical-text") {
    return svg("vertical-text", outlined("M3 11v10M3 16h22M25 11v10M14 13v6"));
  }
  if (["crosshair", "cell"].includes(kind)) {
    const box = kind === "cell" ? `<rect x="8" y="10" width="12" height="12" rx="1" fill="#fff"/>` : "";
    return svg(kind, `${box}${outlined("M14 4v24M2 16h24")}<circle cx="14" cy="16" r="2.2" fill="#fff"/>`);
  }
  if (["move", "all-scroll"].includes(kind)) {
    return svg("move", outlined("M14 3v26M14 3l-4 5M14 3l4 5M14 29l-4-5M14 29l4-5M1 16h26M1 16l5-4M1 16l5 4M27 16l-5-4M27 16l-5 4"));
  }
  if (["grab", "grabbing"].includes(kind)) {
    return svg(kind, GRAB);
  }
  if (["wait", "progress"].includes(kind)) {
    const arrow = kind === "progress" ? `<g transform="scale(.62) translate(0 16)">${ARROW}</g>` : "";
    return svg(kind, `${arrow}<circle cx="17" cy="14" r="8" fill="#fff"/><path d="M17 8v6l4 2.5"/><path d="M17 4a10 10 0 0 1 9.5 7" stroke="#4e7cf2" stroke-width="2.4"/>`);
  }
  if (["not-allowed", "no-drop"].includes(kind)) {
    return svg(kind, `<circle cx="14" cy="16" r="10" fill="#fff"/><path d="m7 9 14 14" stroke="#d43939" stroke-width="3"/>`);
  }
  if (["zoom-in", "zoom-out"].includes(kind)) {
    const sign = kind === "zoom-in" ? outlined("M13 10v8M9 14h8") : outlined("M9 14h8");
    return svg(kind, `<circle cx="13" cy="14" r="8" fill="#fff"/>${sign}${outlined("m19 20 6 7")}`);
  }
  if (["col-resize", "row-resize", "n-resize", "e-resize", "s-resize", "w-resize", "ne-resize", "nw-resize", "se-resize", "sw-resize", "ew-resize", "ns-resize", "nesw-resize", "nwse-resize"].includes(kind)) {
    return resizeSvg(kind);
  }
  if (["help", "context-menu", "copy", "alias"].includes(kind)) {
    const badge = kind === "help" ? "?" : kind === "copy" ? "+" : kind === "alias" ? "↗" : "≡";
    return svg(kind, `${ARROW}<circle cx="21" cy="23" r="6" fill="#fff"/><text x="21" y="26" text-anchor="middle" stroke="none" fill="#17191d" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="9" font-weight="700">${badge}</text>`);
  }
  return svg("default", ARROW);
}

interface HoverTargetInfo {
  cursor: string;
  href: string | null;
  semantics: CursorSemantics;
  element: Rect;
  capture: Rect;
}

export async function renderHoverCursor(page: Page, target: HoverElementHandle, fullPage: boolean): Promise<void> {
  let info: HoverTargetInfo | null = null;
  try {
    info = await target.evaluate((node, useFullPage): HoverTargetInfo | null => {
      if (!node.isConnected) {
        return null;
      }
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      const root = document.documentElement;
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const capture = useFullPage
        ? { left: 0, top: 0, right: Math.max(root.scrollWidth, root.clientWidth), bottom: Math.max(root.scrollHeight, root.clientHeight) }
        : { left: scrollX, top: scrollY, right: scrollX + window.innerWidth, bottom: scrollY + window.innerHeight };
      return {
        cursor: getComputedStyle(element).cursor,
        href: element instanceof HTMLAnchorElement || element instanceof HTMLAreaElement ? element.href : null,
        semantics: {
          tagName: element.tagName.toLowerCase(),
          inputType: element instanceof HTMLInputElement ? element.type.toLowerCase() : null,
          editable: element.isContentEditable,
          hasHref: (element instanceof HTMLAnchorElement || element instanceof HTMLAreaElement) && element.hasAttribute("href"),
        },
        element: { left: rect.left + scrollX, top: rect.top + scrollY, right: rect.right + scrollX, bottom: rect.bottom + scrollY },
        capture,
      };
    }, fullPage);
  } catch {
    // A hover handler may replace the target or navigate. The visual cursor is
    // best-effort and must not turn an otherwise valid capture into a failure.
    return;
  }
  if (info == null) {
    return;
  }
  const kind = resolveCursorKind(info.cursor, info.semantics);
  const position = kind == null ? null : cursorPosition(info.element, info.capture);
  try {
    await page.evaluate(({ markup, left, top, attribute, urlAttribute, width, height, href, element, capture, captureMargin, urlGap }) => {
    document.querySelector(`[${attribute}]`)?.remove();
    document.querySelector(`[${urlAttribute}]`)?.remove();
    if (markup != null) {
      const host = document.createElement("div");
      host.setAttribute(attribute, "");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText = `all:initial !important;position:absolute !important;left:${left}px !important;top:${top}px !important;width:${width}px !important;height:${height}px !important;display:block !important;visibility:visible !important;opacity:1 !important;z-index:2147483647 !important;pointer-events:none !important;user-select:none !important;overflow:visible !important;transform:none !important;contain:strict !important;isolation:isolate !important;`;
      const shadow = host.attachShadow({ mode: "closed" });
      const parsed = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
      const cursor = document.importNode(parsed, true) as unknown as SVGElement;
      shadow.append(cursor);
      document.documentElement.append(host);
    }
    if (href != null) {
      const labelHost = document.createElement("div");
      labelHost.setAttribute(urlAttribute, "");
      labelHost.setAttribute("aria-hidden", "true");
      labelHost.style.cssText = `all:initial !important;position:absolute !important;left:0 !important;top:0 !important;width:max-content !important;max-width:calc(100vw - 16px) !important;height:max-content !important;display:block !important;visibility:visible !important;opacity:1 !important;z-index:2147483647 !important;pointer-events:none !important;user-select:none !important;box-sizing:border-box !important;`;
      const labelShadow = labelHost.attachShadow({ mode: "closed" });
      const label = document.createElement("div");
      label.textContent = href;
      label.style.cssText = `display:block;max-width:min(520px, calc(100vw - 16px));box-sizing:border-box;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 10px;border-radius:7px;background:#090a0b;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12px;font-weight:500;line-height:16px;letter-spacing:.01em;box-shadow:0 5px 16px rgba(0,0,0,.25),0 0 0 1px rgba(255,255,255,.12);`;
      labelShadow.append(label);
      document.documentElement.append(labelHost);
      const labelRect = labelHost.getBoundingClientRect();
      const cursorCenter = left + width / 2;
      const labelLeft = Math.min(Math.max(cursorCenter - labelRect.width / 2, capture.left + captureMargin), capture.right - labelRect.width - captureMargin);
      const rawTop = top + height + urlGap;
      const labelTop = Math.min(Math.max(rawTop, capture.top + captureMargin), capture.bottom - labelRect.height - captureMargin);
      labelHost.style.setProperty("left", `${labelLeft}px`, "important");
      labelHost.style.setProperty("top", `${labelTop}px`, "important");
    }
    }, { markup: kind == null ? null : cursorSvg(kind), left: position?.left ?? 0, top: position?.top ?? 0, attribute: OVERLAY_ATTRIBUTE, urlAttribute: URL_PREVIEW_ATTRIBUTE, width: CURSOR_WIDTH, height: CURSOR_HEIGHT, href: info.href, element: info.element, capture: info.capture, captureMargin: CAPTURE_MARGIN, urlGap: URL_PREVIEW_GAP });
  } catch {
    // A second navigation race must not invalidate an otherwise valid capture.
  }
}
