import { isAbsolute, join, resolve } from "node:path";
import { Buffer } from "node:buffer";

const DERIVED_SEGMENT_BYTES = 120;
const LABEL_BYTES = 80;

export interface OutputTemplateValues {
  date: string;
  time: string;
  timestamp: string;
  host: string;
  route: string;
}

export interface ResolveOutputPathOptions {
  capturesDirectory: string;
  url: string;
  output?: string;
  group?: string;
  label?: string;
  now?: Date;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

export function dateStamp(now = new Date()): string {
  return `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
}

export function timeStamp(now = new Date()): string {
  return `${twoDigits(now.getHours())}-${twoDigits(now.getMinutes())}-${twoDigits(now.getSeconds())}`;
}

export function timestamp(now = new Date()): string {
  return `${dateStamp(now)}_${timeStamp(now)}`;
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function safeSegment(value: string, fallback: string, maxBytes = DERIVED_SEGMENT_BYTES): string {
  let normalized = decoded(value)
    .normalize("NFKC")
    .replace(/[\\/<>:"|?*\u0000-\u001f\u007f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-_]+|[.\-_]+$/g, "");
  normalized = truncateUtf8(normalized, maxBytes)
    .replace(/[.\-_]+$/g, "");
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(normalized)) {
    normalized = `_${truncateUtf8(normalized, maxBytes - 1)}`;
  }
  return normalized || fallback;
}

export function outputTemplateValues(urlText: string, now = new Date()): OutputTemplateValues {
  const url = new URL(urlText);
  const host = safeSegment(url.host || url.protocol.replace(/:$/, ""), "page");
  const route = safeSegment(url.pathname.replace(/^\/+|\/+$/g, "").replace(/\/+/g, "-"), "home");
  return { date: dateStamp(now), time: timeStamp(now), timestamp: timestamp(now), host, route };
}

export function expandOutputTemplate(template: string, values: OutputTemplateValues): string {
  let result = "";
  for (let index = 0; index < template.length;) {
    if (template.startsWith("{{", index)) {
      result += "{";
      index += 2;
      continue;
    }
    if (template.startsWith("}}", index)) {
      result += "}";
      index += 2;
      continue;
    }
    if (template[index] === "{") {
      const close = template.indexOf("}", index + 1);
      if (close === -1) {
        result += "{";
        index += 1;
        continue;
      }
      const name = template.slice(index + 1, close);
      if (!Object.prototype.hasOwnProperty.call(values, name)) {
        throw new Error(`unknown output placeholder: {${name}}`);
      }
      result += values[name as keyof OutputTemplateValues];
      index = close + 1;
      continue;
    }
    result += template[index];
    index += 1;
  }
  return result;
}

export function validateOutputGroup(template: string, values: OutputTemplateValues): string[] {
  const expanded = expandOutputTemplate(template, values);
  if (isAbsolute(expanded) || /^[A-Za-z]:[\\/]/.test(expanded)) {
    throw new Error("--group must be a relative path; use --output for an exact destination");
  }
  const rawSegments = expanded.split(/[\\/]/);
  if (rawSegments.some((segment) => segment === "..")) {
    throw new Error("--group must stay inside the captures directory");
  }
  const segments = rawSegments
    .filter((segment) => segment !== "" && segment !== ".")
    .map((segment) => safeSegment(segment, ""));
  if (segments.length === 0) throw new Error("--group needs a non-empty value");
  if (segments.some((segment) => segment === "")) throw new Error("--group needs filename-safe text in every path segment");
  return segments;
}

export function validateOutputLabel(template: string, values: OutputTemplateValues): string {
  const expanded = expandOutputTemplate(template, values);
  if (/[\\/]/.test(expanded)) throw new Error("--label must not contain path separators");
  const label = safeSegment(expanded, "", LABEL_BYTES);
  if (label === "") throw new Error("--label needs filename-safe text");
  return label;
}

export function resolveOutputPath(options: ResolveOutputPathOptions): string {
  const values = outputTemplateValues(options.url, options.now);
  if (options.output != null) {
    return resolve(expandOutputTemplate(options.output, values));
  }
  const directories = options.group == null ? [] : validateOutputGroup(options.group, values);
  const label = options.label == null ? "" : `_${validateOutputLabel(options.label, values)}`;
  return join(options.capturesDirectory, ...directories, values.host, `${values.route}${label}_${values.timestamp}.png`);
}
