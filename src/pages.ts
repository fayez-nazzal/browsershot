import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Action } from "./act.ts";
import { parseActions } from "./act.ts";
import type { CaptureTarget } from "./capture-target.ts";
import { toUsageError, UsageError } from "./exit-codes.ts";
import type { ProfileConfig } from "./profile-settings.ts";
import { resolveQuickUrl } from "./profile.ts";
import { normalizeUrl, parseSize } from "./run-options.ts";

export const RESERVED_PAGE_WORDS = ["add", "element", "setup", "list", "show", "remove"] as const;

const RESERVED_NAMES: readonly string[] = RESERVED_PAGE_WORDS;
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const SETTING_FIELDS = ["route", "authUser", "authRedirect", "expectElement", "expectText", "act", "size"] as const;

export interface PageSetup {
  route?: string;
  authUser?: string;
  authRedirect?: string;
  expectElement?: string;
  expectText?: string;
  act?: string;
  size?: string;
}

export interface SavedPage {
  route: string;
  authUser?: string;
  authRedirect?: string;
  expectElement?: string;
  expectText?: string;
  act?: string;
  size?: string;
  elements?: Record<string, string>;
  setups?: Record<string, PageSetup>;
}

export interface PagesFile {
  version: 1;
  pages: Record<string, SavedPage>;
}

function pagesRecord(value: unknown, path: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new UsageError(`invalid pages file: ${path}`);
  }
  return value as Record<string, unknown>;
}

function knownNames(names: readonly string[]): string {
  let result = "(none)";
  if (names.length > 0) {
    result = [...names].sort().join(", ");
  }
  return result;
}

function recordNames(record: Record<string, unknown> | undefined): readonly string[] {
  let result: readonly string[] = [];
  if (record !== undefined) {
    result = Object.keys(record);
  }
  return result;
}

function validateName(noun: "page" | "element" | "setup", name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new UsageError(`invalid ${noun} name "${name}"; names match [a-z0-9][a-z0-9_-]*`);
  }
  if (RESERVED_NAMES.includes(name)) {
    throw new UsageError(`${noun} name "${name}" is reserved; reserved words: ${RESERVED_PAGE_WORDS.join(", ")}`);
  }
}

function nonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new UsageError(message);
  }
  return value;
}

function optionalNonEmptyString(value: unknown, message: string): string | undefined {
  let result: string | undefined = undefined;
  if (value !== undefined) {
    result = nonEmptyString(value, message);
  }
  return result;
}

function parsePageActions(raw: string, place: string): Action[] {
  try {
    return parseActions(raw);
  } catch (error) {
    throw new UsageError(`invalid act ${place}: ${(error as Error).message}`);
  }
}

function validateSettings(source: Record<string, unknown>, subject: string, place: string): PageSetup {
  const settings: PageSetup = {};
  settings.authUser = optionalNonEmptyString(source.authUser, `${subject} needs a non-empty authUser`);
  settings.authRedirect = optionalNonEmptyString(source.authRedirect, `${subject} needs a non-empty authRedirect`);
  settings.expectElement = optionalNonEmptyString(source.expectElement, `${subject} needs a non-empty expectElement`);
  settings.expectText = optionalNonEmptyString(source.expectText, `${subject} needs a non-empty expectText`);
  settings.act = optionalNonEmptyString(source.act, `${subject} needs a non-empty act`);
  settings.size = optionalNonEmptyString(source.size, `${subject} needs a non-empty size`);
  if (settings.act !== undefined) {
    parsePageActions(settings.act, place);
  }
  if (settings.size !== undefined && parseSize(settings.size) === null) {
    throw new UsageError(`invalid size ${place}: "${settings.size}"`);
  }
  return settings;
}

function validatePageSetup(page: string, name: string, value: unknown, path: string): PageSetup {
  validateName("setup", name);
  const source = pagesRecord(value, path);
  const subject = `setup "${name}" on page "${page}"`;
  if (!SETTING_FIELDS.some((field) => source[field] !== undefined)) {
    throw new UsageError(`setup "${name}" on page "${page}" needs at least one setting`);
  }
  const route = optionalNonEmptyString(source.route, `${subject} needs a non-empty route`);
  const settings = validateSettings(source, subject, `on setup "${name}" of page "${page}"`);
  return { ...settings, route };
}

function validatePageElements(page: string, value: unknown, path: string): Record<string, string> {
  const source = pagesRecord(value, path);
  const elements: Record<string, string> = {};
  for (const [name, selector] of Object.entries(source)) {
    validateName("element", name);
    elements[name] = nonEmptyString(selector, `element "${name}" on page "${page}" needs a non-empty selector`);
  }
  return elements;
}

function validatePageSetups(page: string, value: unknown, path: string): Record<string, PageSetup> {
  const source = pagesRecord(value, path);
  const setups: Record<string, PageSetup> = {};
  for (const [name, setup] of Object.entries(source)) {
    setups[name] = validatePageSetup(page, name, setup, path);
  }
  return setups;
}

function validateSavedPage(name: string, value: unknown, path: string): SavedPage {
  validateName("page", name);
  const source = pagesRecord(value, path);
  const subject = `page "${name}"`;
  const route = nonEmptyString(source.route, `${subject} needs a non-empty route`);
  const settings = validateSettings(source, subject, `on page "${name}"`);
  const page: SavedPage = { ...settings, route };
  if (source.elements !== undefined) {
    page.elements = validatePageElements(name, source.elements, path);
  }
  if (source.setups !== undefined) {
    page.setups = validatePageSetups(name, source.setups, path);
  }
  if (page.elements !== undefined && page.setups !== undefined) {
    for (const elementName of Object.keys(page.elements)) {
      if (Object.hasOwn(page.setups, elementName)) {
        throw new UsageError(`element "${elementName}" and setup "${elementName}" conflict on page "${name}"`);
      }
    }
  }
  return page;
}

function validatePagesFile(input: unknown, path: string): PagesFile {
  const file = pagesRecord(input, path);
  if (file.version !== 1) {
    throw new UsageError(`invalid pages file: ${path}`);
  }
  const source = pagesRecord(file.pages, path);
  const pages: Record<string, SavedPage> = {};
  for (const [name, value] of Object.entries(source)) {
    pages[name] = validateSavedPage(name, value, path);
  }
  return { version: 1, pages };
}

function requireSavedPage(file: PagesFile, page: string): SavedPage {
  const saved = file.pages[page];
  if (saved === undefined) {
    throw new UsageError(`unknown page "${page}"; known pages: ${knownNames(Object.keys(file.pages))}`);
  }
  return saved;
}

function resolveNamedSelector(saved: SavedPage, page: string, element?: string): string | undefined {
  let selector: string | undefined = undefined;
  if (element !== undefined) {
    selector = saved.elements?.[element];
    if (selector === undefined) {
      throw new UsageError(`unknown element "${element}" on page "${page}"; known elements: ${knownNames(recordNames(saved.elements))}`);
    }
  }
  return selector;
}

function resolveNamedSetup(saved: SavedPage, page: string, setup?: string): PageSetup {
  let named: PageSetup = {};
  if (setup !== undefined) {
    const found = saved.setups?.[setup];
    if (found === undefined) {
      throw new UsageError(`unknown setup "${setup}" on page "${page}"; known setups: ${knownNames(recordNames(saved.setups))}`);
    }
    named = found;
  }
  return named;
}

function resolveViewport(size: string, page: string): { width: number; height: number } {
  const viewport = parseSize(size);
  if (viewport === null) {
    throw new UsageError(`invalid size on page "${page}"`);
  }
  return viewport;
}

function resolveRouteUrl(route: string, profile: Readonly<ProfileConfig>): string {
  let result = "";
  if (route.startsWith("/")) {
    if (profile.baseUrl == null) {
      throw new UsageError("quick capture needs a saved baseUrl; run: browsershot config set baseUrl <url>");
    }
    result = resolveQuickUrl(profile.baseUrl, route);
  } else {
    result = normalizeUrl(route);
  }
  return result;
}

export function pagesFilePath(root: string): string {
  return join(root, ".browsershot", "pages.json");
}

export function readPages(root: string): PagesFile {
  const path = pagesFilePath(root);
  let file: PagesFile = { version: 1, pages: {} };
  if (existsSync(path)) {
    try {
      file = validatePagesFile(JSON.parse(readFileSync(path, "utf8")), path);
    } catch (error) {
      if (error instanceof UsageError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new UsageError(`malformed pages file: ${path}`);
      }
      throw new UsageError(`could not read pages file ${path}: ${(error as Error).message}`);
    }
  }
  return file;
}

export function writePages(root: string, pages: PagesFile): PagesFile {
  const path = pagesFilePath(root);
  const validated = validatePagesFile(pages, path);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`);
  renameSync(temporary, path);
  return validated;
}

export function savePage(root: string, name: string, page: SavedPage): PagesFile {
  const current = readPages(root);
  if (Object.hasOwn(current.pages, name)) {
    throw new UsageError(`page "${name}" already exists; remove it first`);
  }
  return writePages(root, { version: 1, pages: { ...current.pages, [name]: page } });
}

export function savePageElement(root: string, page: string, name: string, selector: string): PagesFile {
  const current = readPages(root);
  const saved = requireSavedPage(current, page);
  const elements = saved.elements ?? {};
  const setups = saved.setups ?? {};
  if (Object.hasOwn(elements, name)) {
    throw new UsageError(`element "${name}" already exists on page "${page}"; remove it first`);
  }
  if (Object.hasOwn(setups, name)) {
    throw new UsageError(`setup "${name}" already exists on page "${page}"; remove it first`);
  }
  const updated: SavedPage = { ...saved, elements: { ...elements, [name]: selector } };
  return writePages(root, { version: 1, pages: { ...current.pages, [page]: updated } });
}

export function savePageSetup(root: string, page: string, name: string, setup: PageSetup): PagesFile {
  const current = readPages(root);
  const saved = requireSavedPage(current, page);
  const setups = saved.setups ?? {};
  const elements = saved.elements ?? {};
  if (Object.hasOwn(setups, name)) {
    throw new UsageError(`setup "${name}" already exists on page "${page}"; remove it first`);
  }
  if (Object.hasOwn(elements, name)) {
    throw new UsageError(`element "${name}" already exists on page "${page}"; remove it first`);
  }
  const updated: SavedPage = { ...saved, setups: { ...setups, [name]: setup } };
  return writePages(root, { version: 1, pages: { ...current.pages, [page]: updated } });
}

export function removePage(root: string, name: string): PagesFile {
  const current = readPages(root);
  requireSavedPage(current, name);
  const pages = { ...current.pages };
  delete pages[name];
  return writePages(root, { version: 1, pages });
}

export function removePagePart(root: string, page: string, name: string): PagesFile {
  const current = readPages(root);
  const saved = requireSavedPage(current, page);
  const elements = saved.elements ?? {};
  const setups = saved.setups ?? {};
  const isElement = Object.hasOwn(elements, name);
  const isSetup = Object.hasOwn(setups, name);
  if (!isElement && !isSetup) {
    throw new UsageError(`unknown element or setup "${name}" on page "${page}"; known elements: ${knownNames(Object.keys(elements))}; known setups: ${knownNames(Object.keys(setups))}`);
  }
  const updated: SavedPage = { ...saved };
  if (isElement) {
    const remaining = { ...elements };
    delete remaining[name];
    updated.elements = remaining;
  } else {
    const remaining = { ...setups };
    delete remaining[name];
    updated.setups = remaining;
  }
  return writePages(root, { version: 1, pages: { ...current.pages, [page]: updated } });
}

export function resolvePageTarget(input: {
  root: string;
  page: string;
  element?: string;
  setup?: string;
  profile: Readonly<ProfileConfig>;
}): CaptureTarget {
  try {
    const saved = requireSavedPage(readPages(input.root), input.page);
    const selector = resolveNamedSelector(saved, input.page, input.element);
    const setup = resolveNamedSetup(saved, input.page, input.setup);
    const actions: Action[] = [];
    if (saved.act !== undefined) {
      actions.push(...parsePageActions(saved.act, `on page "${input.page}"`));
    }
    if (setup.act !== undefined) {
      actions.push(...parsePageActions(setup.act, `on setup "${input.setup}" of page "${input.page}"`));
    }
    const targetActions = actions.length === 0 ? undefined : actions;
    let targetViewport: { width: number; height: number } | undefined = undefined;
    const size = setup.size ?? saved.size;
    if (size !== undefined) {
      targetViewport = resolveViewport(size, input.page);
    }
    let targetRoute = saved.route;
    if (setup.route !== undefined) {
      targetRoute = setup.route;
    }
    let targetExpectElement = saved.expectElement;
    if (setup.expectElement !== undefined) {
      targetExpectElement = setup.expectElement;
    }
    let targetExpectText = saved.expectText;
    if (setup.expectText !== undefined) {
      targetExpectText = setup.expectText;
    }
    let targetAuthUser = saved.authUser;
    if (setup.authUser !== undefined) {
      targetAuthUser = setup.authUser;
    }
    let targetAuthRedirect = saved.authRedirect;
    if (setup.authRedirect !== undefined) {
      targetAuthRedirect = setup.authRedirect;
    }
    return {
      url: resolveRouteUrl(targetRoute, input.profile),
      element: selector,
      expectElement: targetExpectElement,
      expectText: targetExpectText,
      actions: targetActions,
      authUser: targetAuthUser,
      authRedirect: targetAuthRedirect,
      viewport: targetViewport,
      identity: {
        kind: "page",
        page: input.page,
        element: input.element ?? null,
        setup: input.setup ?? null,
      },
    };
  } catch (error) {
    throw toUsageError(error);
  }
}
