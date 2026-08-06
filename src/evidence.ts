import { readFileSync } from "node:fs";
import { escapeHtml } from "./inspect.ts";

/**
 * A before-and-after page built from DATA rather than from two screenshots.
 *
 * --compare puts two PNGs side by side, which needs the thing to already look like something. This
 * builds the page itself: what went in, what came back before, what came back after, each in plain
 * words. It is what you want for pipelines, model answers, API replies and anything else whose
 * evidence is text a reviewer should not have to read a terminal dump to follow.
 */

export interface EvidenceBadge {
  text: string;
  tone?: "good" | "bad" | "warn";
}

export interface EvidenceSide {
  label?: string;
  note?: string;
  outputLabel?: string;
  output?: string;
  badge?: EvidenceBadge;
  plain?: string;
  outcome?: string;
}

export interface EvidenceInput {
  heading?: string;
  meta?: string[][];
  text?: string;
  chips?: string[];
  hidden?: { label?: string; text: string };
}

export interface EvidenceSpec {
  step?: string;
  title: string;
  lede?: string;
  input?: EvidenceInput;
  before: EvidenceSide;
  after: EvidenceSide;
  result?: { text: string; tone?: "good" | "warn" };
}

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px; background: #eef1f6; color: #16202e;
         font: 16px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .page { max-width: 1000px; margin: 0 auto; }
  .step { font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: #64748b;
          font-weight: 700; }
  h1 { font-size: 30px; line-height: 1.25; margin: 6px 0 10px; }
  .lede { font-size: 17px; color: #445167; margin: 0 0 26px; max-width: 78ch; }
  .card { background: #fff; border: 1px solid #dbe2ec; border-radius: 14px; padding: 22px 24px;
          margin-bottom: 22px; box-shadow: 0 1px 2px rgba(16,24,40,.05); }
  h2 { font-size: 13px; letter-spacing: .1em; text-transform: uppercase; color: #64748b;
       margin: 0 0 14px; }
  .meta { font-size: 14px; color: #5a677d; margin-bottom: 4px; }
  .meta b { color: #16202e; font-weight: 600; }
  .text { margin-top: 14px; padding: 16px 18px; background: #f7f9fc; border-radius: 10px;
          border: 1px solid #e4eaf2; white-space: pre-wrap; }
  .chip { background: #eff4ff; border: 1px solid #cfdcfa; color: #23417f; border-radius: 999px;
          display: inline-block; padding: 6px 14px; font-size: 14px; font-weight: 600;
          margin: 0 8px 8px 0; }
  .hidden-note { margin-top: 14px; padding: 14px 16px; border-left: 4px solid #f0b429;
                 background: #fffaf0; border-radius: 0 10px 10px 0; white-space: pre-wrap;
                 font-size: 15px; }
  .hidden-note .tag { display: block; font-weight: 700; color: #8a5b00; margin-bottom: 6px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
  .panel { border-radius: 14px; padding: 20px 22px; border: 1px solid; }
  .panel.before { background: #fff5f5; border-color: #f2c9c9; }
  .panel.after { background: #f1fbf4; border-color: #b9e4c8; }
  .panel h3 { margin: 0 0 4px; font-size: 19px; }
  .panel.before h3 { color: #a02020; }
  .panel.after h3 { color: #1a7a41; }
  .panel .note { font-size: 14px; color: #55627a; margin-bottom: 14px; }
  .label { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #64748b;
           font-weight: 700; margin: 0 0 6px; }
  .output { background: #fff; border: 1px solid #dfe6ef; border-radius: 10px; padding: 14px 16px;
            font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap;
            word-break: break-word; }
  .badge { display: inline-block; margin-top: 12px; padding: 5px 12px; border-radius: 999px;
           font-size: 13.5px; font-weight: 600; }
  .badge.bad { background: #fde8e8; color: #9b1c1c; }
  .badge.good { background: #dcf5e5; color: #14663a; }
  .badge.warn { background: #fdf1d8; color: #7a4f00; }
  .plain { margin-top: 12px; font-size: 15px; }
  .plain b { display: block; font-size: 13px; text-transform: uppercase; letter-spacing: .08em;
             color: #64748b; margin-bottom: 4px; }
  .outcome { margin-top: 14px; font-size: 15px; }
  .result { background: #16202e; color: #fff; border-radius: 14px; padding: 18px 24px;
            font-size: 17px; margin-top: 22px; }
  .result b { color: #7ee2a8; }
  .result.warn { background: #7a4f00; }
  .result.warn b { color: #ffd479; }
`;

function metaRows(rows: string[][]): string {
  const out: string[] = [];
  for (const row of rows) {
    const name = escapeHtml(row[0] ?? "");
    const value = escapeHtml(row[1] ?? "");
    out.push(`<div class="meta">${name} <b>${value}</b></div>`);
  }
  return out.join("");
}

function chipRow(chips: string[]): string {
  const out: string[] = [];
  for (const chip of chips) {
    out.push(`<span class="chip">${escapeHtml(chip)}</span>`);
  }
  let result = "";
  if (out.length > 0) {
    result = `<p class="label" style="margin-top:18px">Attached</p>${out.join("")}`;
  }
  return result;
}

function inputCard(input: EvidenceInput | undefined): string {
  let result = "";
  if (input != null) {
    const parts: string[] = [];
    parts.push(`<h2>${escapeHtml(input.heading ?? "What went in")}</h2>`);
    if (input.meta != null) {
      parts.push(metaRows(input.meta));
    }
    if (input.text != null) {
      parts.push(`<div class="text">${escapeHtml(input.text)}</div>`);
    }
    if (input.chips != null && input.chips.length > 0) {
      parts.push(chipRow(input.chips));
    } else if (input.heading != null) {
      parts.push('<p class="meta" style="margin-top:16px">No attachments</p>');
    }
    if (input.hidden != null) {
      const tag = escapeHtml(input.hidden.label ?? "Hidden inside it, where a person would not look");
      parts.push(
        `<div class="hidden-note"><span class="tag">${tag}</span>${escapeHtml(input.hidden.text)}</div>`,
      );
    }
    result = `<div class="card">${parts.join("")}</div>`;
  }
  return result;
}

function panel(side: EvidenceSide, kind: "before" | "after"): string {
  const parts: string[] = [];
  let heading = "After";
  if (kind === "before") {
    heading = "Before";
  }
  parts.push(`<h3>${escapeHtml(side.label ?? heading)}</h3>`);
  if (side.note != null) {
    parts.push(`<div class="note">${escapeHtml(side.note)}</div>`);
  }
  if (side.output != null) {
    parts.push(`<p class="label">${escapeHtml(side.outputLabel ?? "What came back")}</p>`);
    parts.push(`<div class="output">${escapeHtml(side.output)}</div>`);
  }
  if (side.badge != null) {
    let tone = "bad";
    if (kind === "after") {
      tone = "good";
    }
    if (side.badge.tone != null) {
      tone = side.badge.tone;
    }
    parts.push(`<div class="badge ${tone}">${escapeHtml(side.badge.text)}</div>`);
  }
  if (side.plain != null) {
    parts.push(`<div class="plain"><b>In plain words</b>${escapeHtml(side.plain)}</div>`);
  }
  if (side.outcome != null) {
    parts.push(`<div class="outcome"><b>What happened:</b> ${escapeHtml(side.outcome)}</div>`);
  }
  return `<div class="panel ${kind}">${parts.join("")}</div>`;
}

export function readEvidenceSpec(path: string): EvidenceSpec {
  const spec = JSON.parse(readFileSync(path, "utf8")) as EvidenceSpec;
  if (spec.title == null || spec.before == null || spec.after == null) {
    throw new Error(`--evidence needs "title", "before" and "after" in ${path}`);
  }
  return spec;
}

export function buildEvidenceHtml(spec: EvidenceSpec): string {
  const head: string[] = [];
  if (spec.step != null) {
    head.push(`<div class="step">${escapeHtml(spec.step)}</div>`);
  }
  head.push(`<h1>${escapeHtml(spec.title)}</h1>`);
  if (spec.lede != null) {
    head.push(`<p class="lede">${escapeHtml(spec.lede)}</p>`);
  }
  let result = "";
  if (spec.result != null) {
    let tone = "";
    if (spec.result.tone === "warn") {
      tone = "warn";
    }
    result = `<div class="card result ${tone}">${spec.result.text}</div>`;
  }
  return (
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<title>${escapeHtml(spec.title)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n` +
    `<div class="page">${head.join("")}${inputCard(spec.input)}` +
    `<div class="pair">${panel(spec.before, "before")}${panel(spec.after, "after")}</div>` +
    `${result}</div>\n</body>\n</html>\n`
  );
}
