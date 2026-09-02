import type { Page } from "playwright";

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementRecord {
  selector: string;
  tagName: string;
  role: string;
  name: string;
  description: string;
  attributes: Record<string, string>;
  outerHTML: string;
  displayHTML: string;
  box: ElementBox;
}

export interface InspectOptions {
  selector: string;
  attr?: string;
  timeoutMs: number;
}

export const STATE_ATTRIBUTES = [
  "aria-expanded",
  "aria-selected",
  "aria-pressed",
  "aria-checked",
  "aria-current",
  "aria-controls",
  "aria-describedby",
  "aria-labelledby",
  "aria-valuenow",
  "aria-valuemin",
  "aria-valuemax",
  "aria-disabled",
  "aria-hidden",
];

export const PANEL_HEIGHT = 300;
export const ATTRIBUTE_VALUE_LIMIT = 56;
export const DISPLAY_HTML_LIMIT = 620;
export const OUTER_HTML_LIMIT = 1200;

const COLOR = {
  panel: "#202124",
  border: "#3c4043",
  text: "#e8eaed",
  muted: "#9aa0a6",
  tag: "#5db0d7",
  attribute: "#9bbbdc",
  value: "#f29766",
  good: "#81c995",
  bad: "#f28b82",
  highlightFill: "rgba(111,168,220,0.32)",
  highlightEdge: "#6fa8dc",
  badge: "#1a73e8",
  mark: "#fdd663",
};

const TOKEN = {
  tag: String.fromCharCode(1),
  attribute: String.fromCharCode(2),
  value: String.fromCharCode(3),
  end: String.fromCharCode(4),
  markOpen: String.fromCharCode(5),
  markClose: String.fromCharCode(6),
};

export function escapeHtml(value: string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function shortenAttributeValues(html: string, limit: number = ATTRIBUTE_VALUE_LIMIT): string {
  const shortenClass = (match: string, value: string) => {
    const count = value.split(/\s+/).filter((token) => token.length > 0).length;
    return `class="${value.slice(0, 44)}… ${count} classes"`;
  };
  const classPattern = new RegExp(`class="([^"]{${limit},})"`, "g");
  let result = html.replace(classPattern, shortenClass);
  const stylePattern = new RegExp(` style="[^"]{${limit},}"`, "g");
  result = result.replace(stylePattern, ' style="…"');
  return result;
}

export function truncate(value: string, limit: number): string {
  let result = value;
  if (value.length > limit) {
    result = `${value.slice(0, limit)} …`;
  }
  return result;
}

export function highlightMarkup(html: string, attr?: string): string {
  let result = escapeHtml(html);
  result = result.replace(/([a-zA-Z-:]+)="([^"]*)"/g, (match, name: string, value: string) => {
    const body = `${TOKEN.attribute}${name}${TOKEN.end}=${TOKEN.value}"${value}"${TOKEN.end}`;
    let piece = body;
    if (attr != null && attr === name) {
      piece = `${TOKEN.markOpen}${body}${TOKEN.markClose}`;
    }
    return piece;
  });
  result = result.replace(/&lt;(\/?)([a-zA-Z0-9-]+)/g, `&lt;$1${TOKEN.tag}$2${TOKEN.end}`);
  result = result.split(TOKEN.tag).join(`<span style="color:${COLOR.tag}">`);
  result = result.split(TOKEN.attribute).join(`<span style="color:${COLOR.attribute}">`);
  result = result.split(TOKEN.value).join(`<span style="color:${COLOR.value}">`);
  result = result.split(TOKEN.end).join("</span>");
  result = result.split(TOKEN.markOpen).join(`<mark style="background:${COLOR.mark};color:${COLOR.panel};padding:1px 3px;border-radius:2px;">`);
  result = result.split(TOKEN.markClose).join("</mark>");
  return result;
}

export interface StateRow {
  label: string;
  value: string;
  tone: "plain" | "good" | "bad" | "muted";
}

export function stateRows(record: ElementRecord, attr?: string): StateRow[] {
  const rows: StateRow[] = [];
  let name = record.name;
  if (name === "") {
    name = "(empty)";
  }
  rows.push({ label: "Role", value: record.role, tone: "plain" });
  rows.push({ label: "Name", value: name, tone: "plain" });
  if (record.description !== "") {
    rows.push({ label: "Description", value: record.description, tone: "plain" });
  }
  for (const key of STATE_ATTRIBUTES) {
    const present = record.attributes[key];
    if (present !== undefined) {
      let tone: StateRow["tone"] = "muted";
      if (attr != null && attr === key) {
        tone = "good";
      }
      rows.push({ label: key, value: present, tone });
    }
  }
  if (attr != null && record.attributes[attr] === undefined) {
    rows.push({ label: attr, value: "(not present)", tone: "bad" });
  }
  const hasState = rows.some((row) => row.label !== "Role" && row.label !== "Name" && row.label !== "Description");
  if (!hasState) {
    rows.push({ label: "state", value: "(none exposed)", tone: "bad" });
  }
  return rows;
}

function toneColor(tone: StateRow["tone"]): string {
  let colour = COLOR.text;
  if (tone === "muted") {
    colour = COLOR.muted;
  }
  if (tone === "good") {
    colour = COLOR.good;
  }
  if (tone === "bad") {
    colour = COLOR.bad;
  }
  return colour;
}

export function rowsMarkup(rows: StateRow[]): string {
  const parts: string[] = [];
  parts.push(`<div style="color:${COLOR.muted};font-size:11px;letter-spacing:0.4px;margin-bottom:8px;">COMPUTED ACCESSIBILITY PROPERTIES</div>`);
  for (const row of rows) {
    const colour = toneColor(row.tone);
    parts.push(
      `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid #2b2c2f;">` +
        `<span style="color:${COLOR.muted};min-width:132px;">${escapeHtml(row.label)}</span>` +
        `<span style="color:${colour};word-break:break-all;">${escapeHtml(row.value)}</span></div>`,
    );
  }
  return parts.join("");
}

export interface OverlayPayload {
  box: ElementBox;
  tagName: string;
  htmlMarkup: string;
  metaMarkup: string;
  panelHeight: number;
  colors: typeof COLOR;
}

export function overlayPayload(record: ElementRecord, attr?: string, footer?: string): OverlayPayload {
  let metaMarkup = rowsMarkup(stateRows(record, attr));
  if (footer != null && footer !== "") {
    metaMarkup =
      metaMarkup +
      `<div style="margin-top:10px;padding-top:8px;border-top:1px solid ${COLOR.border};color:${COLOR.muted};font-size:11px;">${escapeHtml(footer)}</div>`;
  }
  return {
    box: record.box,
    tagName: record.tagName,
    htmlMarkup: highlightMarkup(record.displayHTML, attr),
    metaMarkup,
    panelHeight: PANEL_HEIGHT,
    colors: COLOR,
  };
}

const READ_ELEMENT = () => {
  const node = (window as unknown as { __browsershotTarget: Element }).__browsershotTarget;
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(node.attributes)) {
    attributes[attribute.name] = attribute.value;
  }
  const textOf = (element: Element | null) => {
    let value = "";
    if (element != null) {
      value = (element.textContent || "").replace(/\s+/g, " ").trim();
    }
    return value;
  };
  const joinIds = (raw: string | null) => {
    let value = "";
    if (raw != null && raw !== "") {
      const parts: string[] = [];
      for (const id of raw.split(/\s+/)) {
        parts.push(textOf(document.getElementById(id)));
      }
      value = parts.filter((part) => part !== "").join(" ");
    }
    return value;
  };
  let name = joinIds(node.getAttribute("aria-labelledby"));
  const label = node.getAttribute("aria-label");
  if (name === "" && label != null) {
    name = label.trim();
  }
  if (name === "") {
    name = textOf(node);
  }
  const title = node.getAttribute("title");
  if (name === "" && title != null) {
    name = title.trim();
  }
  const description = joinIds(node.getAttribute("aria-describedby"));
  let role = node.getAttribute("role") || "";
  if (role === "") {
    role = `${node.tagName.toLowerCase()} (implicit)`;
  }
  const rect = node.getBoundingClientRect();
  return {
    tagName: node.tagName.toLowerCase(),
    attributes,
    name,
    description,
    role,
    outerHTML: node.outerHTML,
    box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
};

const INJECT_OVERLAY = (payload: OverlayPayload) => {
  const colors = payload.colors;
  const previous = document.getElementById("browsershot-inspector");
  if (previous != null) {
    previous.remove();
  }
  const root = document.createElement("div");
  root.id = "browsershot-inspector";
  root.setAttribute(
    "style",
    'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font-family: Menlo, Monaco, "SF Mono", monospace;',
  );

  const box = payload.box;
  const left = Math.max(box.x, 0);
  const top = Math.max(box.y, 0);
  const highlight = document.createElement("div");
  highlight.setAttribute(
    "style",
    `position:absolute;left:${left}px;top:${top}px;width:${box.width}px;height:${box.height}px;` +
      `background:${colors.highlightFill};outline:2px solid ${colors.highlightEdge};box-shadow:0 0 0 1px rgba(255,255,255,0.85);`,
  );
  root.appendChild(highlight);

  const badge = document.createElement("div");
  let badgeTop = top - 26;
  if (badgeTop < 2) {
    badgeTop = top + box.height + 4;
  }
  badge.textContent = `${payload.tagName}  ${Math.round(box.width)} × ${Math.round(box.height)}`;
  badge.setAttribute(
    "style",
    `position:absolute;left:${left}px;top:${badgeTop}px;background:${colors.badge};color:#fff;font-size:11px;` +
      `line-height:1;padding:5px 7px;border-radius:3px;white-space:nowrap;`,
  );
  root.appendChild(badge);

  const panel = document.createElement("div");
  panel.setAttribute(
    "style",
    `position:absolute;left:0;right:0;bottom:0;height:${payload.panelHeight}px;background:${colors.panel};` +
      `border-top:1px solid ${colors.border};color:${colors.text};font-size:12px;line-height:1.55;display:flex;flex-direction:column;`,
  );

  const tabs = document.createElement("div");
  tabs.setAttribute(
    "style",
    `display:flex;align-items:center;gap:18px;padding:0 14px;height:30px;border-bottom:1px solid ${colors.border};` +
      `color:${colors.muted};font-size:11px;letter-spacing:0.3px;flex:none;`,
  );
  tabs.innerHTML =
    `<span style="color:${colors.text};border-bottom:2px solid #8ab4f8;height:30px;display:flex;align-items:center;">Elements</span>` +
    "<span>Accessibility</span><span>Styles</span><span>Computed</span>";
  panel.appendChild(tabs);

  const body = document.createElement("div");
  body.setAttribute("style", "display:flex;flex:1;min-height:0;");

  const code = document.createElement("div");
  code.setAttribute(
    "style",
    `flex:1.45;padding:12px 14px;overflow:hidden;border-right:1px solid ${colors.border};` +
      `white-space:pre-wrap;word-break:break-all;font-size:12px;color:${colors.text};`,
  );
  code.innerHTML = payload.htmlMarkup;
  body.appendChild(code);

  const meta = document.createElement("div");
  meta.setAttribute("style", "flex:1;padding:12px 14px;overflow:hidden;font-size:12px;");
  meta.innerHTML = payload.metaMarkup;
  body.appendChild(meta);

  panel.appendChild(body);
  root.appendChild(panel);
  document.body.appendChild(root);
};

export async function inspectElement(page: Page, options: InspectOptions, footer?: string): Promise<ElementRecord> {
  const locator = page.locator(options.selector).first();
  try {
    await locator.waitFor({ state: "attached", timeout: options.timeoutMs });
  } catch {
    throw new Error(
      `--inspect found no element matching ${options.selector}. ` +
        `Check the selector, or raise --delay if the app renders it late.`,
    );
  }
  await locator.scrollIntoViewIfNeeded({ timeout: options.timeoutMs }).catch(() => {});
  await page.waitForTimeout(150);
  const handle = await locator.elementHandle();
  if (handle == null) {
    throw new Error(`--inspect could not get a handle for ${options.selector}`);
  }
  await page.evaluate((element) => {
    (window as unknown as { __browsershotTarget: Element }).__browsershotTarget = element as Element;
  }, handle);
  const raw = await page.evaluate(READ_ELEMENT);
  const record: ElementRecord = {
    selector: options.selector,
    tagName: raw.tagName,
    role: raw.role,
    name: raw.name,
    description: raw.description,
    attributes: raw.attributes,
    outerHTML: truncate(raw.outerHTML, OUTER_HTML_LIMIT),
    displayHTML: truncate(shortenAttributeValues(raw.outerHTML), DISPLAY_HTML_LIMIT),
    box: raw.box,
  };
  await page.evaluate(INJECT_OVERLAY, overlayPayload(record, options.attr, footer));
  await page.waitForTimeout(120);
  return record;
}
