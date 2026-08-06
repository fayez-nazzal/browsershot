import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { escapeHtml, stateRows, type ElementRecord, type StateRow } from "./inspect.ts";

export interface ComparePair {
  before: string;
  after: string;
}

export interface CardSide {
  label: string;
  imageUri: string;
  rows: StateRow[];
  caption: string;
}

export interface CardInput {
  title: string;
  chips: string[];
  before: CardSide;
  after: CardSide;
}

export const DEFAULT_LABELS: ComparePair = { before: "before", after: "after" };

export function parsePair(raw: string, flag: string): ComparePair {
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    throw new Error(`--${flag} must look like <before>,<after>, got "${raw}"`);
  }
  return { before: parts[0]!, after: parts[1]! };
}

export function sidecarPath(imagePath: string): string {
  let result = `${imagePath}.json`;
  if (imagePath.toLowerCase().endsWith(".png")) {
    result = `${imagePath.slice(0, -4)}.json`;
  }
  return result;
}

export function readRecord(imagePath: string): ElementRecord | null {
  const candidate = sidecarPath(imagePath);
  let result: ElementRecord | null = null;
  if (existsSync(candidate)) {
    result = JSON.parse(readFileSync(candidate, "utf8")) as ElementRecord;
  }
  return result;
}

export function dataUri(imagePath: string): string {
  if (!existsSync(imagePath)) {
    throw new Error(`--compare could not read ${imagePath}`);
  }
  const bytes = readFileSync(imagePath);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

export function buildSide(imagePath: string, label: string, attr?: string): CardSide {
  const record = readRecord(imagePath);
  let rows: StateRow[] = [];
  let caption = basename(imagePath);
  if (record != null) {
    rows = stateRows(record, attr);
    caption = record.selector;
  }
  return { label, imageUri: dataUri(imagePath), rows, caption };
}

function toneColor(tone: StateRow["tone"], side: "before" | "after"): string {
  let colour = "#e6e6e6";
  if (tone === "muted") {
    colour = "#9aa3b2";
  }
  if (tone === "good") {
    colour = "#7ee2a8";
  }
  if (tone === "bad") {
    colour = "#ff9b95";
  }
  if (tone === "plain" && side === "before") {
    colour = "#e6e6e6";
  }
  return colour;
}

function rowsTable(rows: StateRow[], side: "before" | "after"): string {
  let result = "";
  if (rows.length > 0) {
    const cells: string[] = [];
    for (const row of rows) {
      const colour = toneColor(row.tone, side);
      cells.push(
        `<tr><th>${escapeHtml(row.label)}</th><td style="color:${colour}">${escapeHtml(row.value)}</td></tr>`,
      );
    }
    result = `<table class="state">${cells.join("")}</table>`;
  }
  return result;
}

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #12141a; color: #e6e6e6; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { padding: 28px 32px 32px; }
  h1 { margin: 0 0 10px; font-size: 26px; font-weight: 650; letter-spacing: -0.2px; }
  .meta { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 22px; }
  .chip { font-size: 12px; padding: 4px 10px; border-radius: 999px; background: #222630; color: #b9c0cc; border: 1px solid #2e3440; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
  .col { background: #181b22; border: 1px solid #262b36; border-radius: 10px; overflow: hidden; }
  .col header { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; font-size: 13px; font-weight: 600; }
  .before header { background: #3a2325; color: #ff9b95; border-bottom: 1px solid #5c3034; }
  .after header { background: #1d3327; color: #7ee2a8; border-bottom: 1px solid #2e5c3f; }
  .shot { display: block; width: 100%; height: auto; border-bottom: 1px solid #262b36; }
  table.state { width: 100%; border-collapse: collapse; font-family: Menlo, Monaco, monospace; font-size: 12px; }
  table.state th { text-align: left; color: #8f97a5; font-weight: 500; width: 34%; padding: 7px 14px; border-bottom: 1px solid #22262f; }
  table.state td { padding: 7px 14px; border-bottom: 1px solid #22262f; word-break: break-all; }
  .caption { padding: 10px 14px; font-family: Menlo, Monaco, monospace; font-size: 11px; color: #8f97a5; word-break: break-all; }
`;

function column(side: CardSide, kind: "before" | "after"): string {
  return (
    `<div class="col ${kind}">` +
    `<header><span>${escapeHtml(kind)}</span><span>${escapeHtml(side.label)}</span></header>` +
    `<img class="shot" src="${side.imageUri}" alt="">` +
    rowsTable(side.rows, kind) +
    `<div class="caption">${escapeHtml(side.caption)}</div>` +
    `</div>`
  );
}

export function buildCardHtml(input: CardInput): string {
  const chips: string[] = [];
  for (const chip of input.chips) {
    chips.push(`<span class="chip">${escapeHtml(chip)}</span>`);
  }
  let meta = "";
  if (chips.length > 0) {
    meta = `<div class="meta">${chips.join("")}</div>`;
  }
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${escapeHtml(input.title)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n` +
    `<div class="wrap">` +
    `<h1>${escapeHtml(input.title)}</h1>` +
    meta +
    `<div class="cols">${column(input.before, "before")}${column(input.after, "after")}</div>` +
    `</div>\n</body>\n</html>\n`
  );
}
