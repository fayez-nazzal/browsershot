import type { BrowserContext, Route } from "playwright";

export type MockKind = "redirect" | "json" | "merge";

export interface Mock {
  url: string;
  kind: MockKind;
  redirect?: string;
  status?: number;
  json?: unknown;
  merge?: Record<string, unknown>;
}

export interface MockFile {
  mocks: Mock[];
}

const DEFAULT_REDIRECT_STATUS = 302;
const DEFAULT_JSON_STATUS = 200;
const JSON_CONTENT_TYPE = "application/json";

function isPlainObject(value: unknown): boolean {
  let result = false;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    result = true;
  }
  return result;
}

export function deepMerge(base: unknown, patch: unknown): unknown {
  let result = patch;
  const bothObjects = isPlainObject(base) && isPlainObject(patch);
  if (bothObjects) {
    const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const key of Object.keys(patch as Record<string, unknown>)) {
      const nextBase = (base as Record<string, unknown>)[key];
      const nextPatch = (patch as Record<string, unknown>)[key];
      merged[key] = deepMerge(nextBase, nextPatch);
    }
    result = merged;
  }
  return result;
}

export function parseMocks(raw: string): Mock[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`--mock file is not valid JSON: ${(e as Error).message}`);
  }
  let entries: unknown = parsed;
  if (isPlainObject(parsed)) {
    entries = (parsed as MockFile).mocks;
  }
  if (!Array.isArray(entries)) {
    throw new Error('--mock file needs a "mocks" array, e.g. {"mocks":[{"url":"**/user_info*","merge":{}}]}');
  }
  const mocks: Mock[] = [];
  for (const entry of entries as Record<string, unknown>[]) {
    const url = entry.url;
    if (typeof url !== "string" || url.trim().length === 0) {
      throw new Error('every --mock entry needs a "url" glob, e.g. "**/user_info*"');
    }
    let kind: MockKind | null = null;
    if (typeof entry.redirect === "string") {
      kind = "redirect";
    } else if (isPlainObject(entry.merge)) {
      kind = "merge";
    } else if (entry.json !== undefined) {
      kind = "json";
    }
    if (kind === null) {
      throw new Error(`--mock entry for "${url}" needs one of "redirect", "merge" or "json"`);
    }
    const mock: Mock = { url, kind };
    if (kind === "redirect") {
      mock.redirect = entry.redirect as string;
      mock.status = DEFAULT_REDIRECT_STATUS;
    }
    if (kind === "merge") {
      mock.merge = entry.merge as Record<string, unknown>;
    }
    if (kind === "json") {
      mock.json = entry.json;
      mock.status = DEFAULT_JSON_STATUS;
    }
    if (typeof entry.status === "number") {
      mock.status = entry.status;
    }
    mocks.push(mock);
  }
  if (mocks.length === 0) {
    throw new Error("--mock file has no entries");
  }
  return mocks;
}

async function fulfilRedirect(route: Route, mock: Mock): Promise<void> {
  await route.fulfill({
    status: mock.status as number,
    headers: { location: mock.redirect as string },
    body: "",
  });
}

async function fulfilJson(route: Route, mock: Mock): Promise<void> {
  await route.fulfill({
    status: mock.status as number,
    contentType: JSON_CONTENT_TYPE,
    body: JSON.stringify(mock.json),
  });
}

async function fulfilMerge(route: Route, mock: Mock): Promise<void> {
  const response = await route.fetch();
  const text = await response.text();
  let body = text;
  let merged: unknown = null;
  try {
    merged = deepMerge(JSON.parse(text), mock.merge);
  } catch {
    merged = null;
  }
  if (merged !== null) {
    body = JSON.stringify(merged);
  } else {
    process.stderr.write(`browsershot: warning: --mock merge skipped, ${mock.url} did not return JSON\n`);
  }
  let status = response.status();
  if (typeof mock.status === "number") {
    status = mock.status;
  }
  await route.fulfill({ status, contentType: JSON_CONTENT_TYPE, body });
}

export async function applyMocks(context: BrowserContext, mocks: Mock[], onHit?: (message: string) => void): Promise<void> {
  for (const mock of mocks) {
    await context.route(mock.url, async (route) => {
      onHit?.(`mock hit: ${route.request().url()} (${mock.kind})`);
      if ("redirect" === mock.kind) {
        await fulfilRedirect(route, mock);
      } else if ("json" === mock.kind) {
        await fulfilJson(route, mock);
      } else {
        await fulfilMerge(route, mock);
      }
    });
  }
}
