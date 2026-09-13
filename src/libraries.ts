import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  expandPluginAddress,
  mapCatalogEntries,
  readPluginDescription,
  resolvePluginAuthHeader,
  type CatalogEntry,
  type PluginDescription,
  type PluginFilesDiscovery,
} from "./plugin-description.ts";
import type { CaptureTarget } from "./capture-target.ts";
import { EXIT_ENVIRONMENT, EXIT_FAILED, ExitError, UsageError } from "./exit-codes.ts";

export const RESERVED_LIBRARY_WORDS = ["add", "list", "show", "refresh", "remove"] as const;

const LIBRARY_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const ENV_REFERENCE_PREFIX = "env:";

export interface LibraryDefinition {
  baseUrl: string;
  plugin: string;
  ready?: string;
  scope?: string;
}

export interface LibrariesFile {
  version: 1;
  libraries: Record<string, LibraryDefinition>;
}

export type CatalogFetcher = (url: string, headers: Record<string, string>) => Promise<unknown>;

interface CatalogCacheFile {
  fetchedAt: string;
  entries: CatalogEntry[];
}

class CatalogCredentialsRejected extends Error {
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = "CatalogCredentialsRejected";
  }
}

export function librariesFilePath(root: string): string {
  return join(root, ".browsershot", "libraries.json");
}

export function catalogCachePath(root: string, library: string): string {
  return join(root, ".browsershot", "cache", `${library}.json`);
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function nameList(names: string[]): string {
  if (names.length === 0) {
    return "(none)";
  }
  return [...names].sort().join(", ");
}

function knownLibraryList(file: LibrariesFile): string {
  return nameList(Object.keys(file.libraries));
}

function optionalSelector(input: Record<string, unknown>, field: string, name: string): string | undefined {
  const value = input[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value === "") {
    throw new UsageError(`library "${name}" needs a non-empty ${field} selector`);
  }
  return value;
}

function validateLibraryDefinition(input: unknown, path: string, name: string): LibraryDefinition {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new UsageError(`invalid libraries file: ${path}`);
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.baseUrl !== "string" || !isAbsoluteUrl(raw.baseUrl)) {
    throw new UsageError(`library "${name}" needs an absolute base URL`);
  }
  const baseUrl = new URL(raw.baseUrl);
  if (baseUrl.username !== "" || baseUrl.password !== "") {
    throw new UsageError(`library "${name}" base URL credentials are not allowed`);
  }
  if (typeof raw.plugin !== "string" || raw.plugin === "") {
    throw new UsageError(`library "${name}" needs a non-empty plugin`);
  }
  const definition: LibraryDefinition = { baseUrl: raw.baseUrl, plugin: raw.plugin };
  const ready = optionalSelector(raw, "ready", name);
  if (ready !== undefined) {
    definition.ready = ready;
  }
  const scope = optionalSelector(raw, "scope", name);
  if (scope !== undefined) {
    definition.scope = scope;
  }
  return definition;
}

function validateLibrariesFile(input: unknown, path: string): LibrariesFile {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new UsageError(`invalid libraries file: ${path}`);
  }
  const raw = input as Record<string, unknown>;
  if (raw.version !== 1) {
    throw new UsageError(`invalid libraries file: ${path}`);
  }
  if (raw.libraries == null || typeof raw.libraries !== "object" || Array.isArray(raw.libraries)) {
    throw new UsageError(`invalid libraries file: ${path}`);
  }
  const stored = raw.libraries as Record<string, unknown>;
  const libraries: Record<string, LibraryDefinition> = {};
  for (const name of Object.keys(stored).sort()) {
    if (!LIBRARY_NAME_PATTERN.test(name)) {
      throw new UsageError(`invalid library name "${name}"; names match [a-z0-9][a-z0-9_-]*`);
    }
    if (RESERVED_LIBRARY_WORDS.some((word) => word === name)) {
      throw new UsageError(`library name "${name}" is reserved; reserved words: ${RESERVED_LIBRARY_WORDS.join(", ")}`);
    }
    libraries[name] = validateLibraryDefinition(stored[name], path, name);
  }
  return { version: 1, libraries };
}

export function readLibraries(root: string): LibrariesFile {
  const path = librariesFilePath(root);
  if (!existsSync(path)) {
    return { version: 1, libraries: {} };
  }
  try {
    return validateLibrariesFile(JSON.parse(readFileSync(path, "utf8")), path);
  } catch (error) {
    if (error instanceof UsageError) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new UsageError(`malformed libraries file: ${path}`);
    }
    throw new UsageError(`could not read libraries file ${path}: ${(error as Error).message}`);
  }
}

export function writeLibraries(root: string, file: LibrariesFile): LibrariesFile {
  const path = librariesFilePath(root);
  const validated = validateLibrariesFile(file, path);
  mkdirSync(join(root, ".browsershot"), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`);
  renameSync(temporary, path);
  return validated;
}

export function saveLibrary(root: string, name: string, definition: LibraryDefinition): LibrariesFile {
  if (!LIBRARY_NAME_PATTERN.test(name)) {
    throw new UsageError(`invalid library name "${name}"; names match [a-z0-9][a-z0-9_-]*`);
  }
  if (RESERVED_LIBRARY_WORDS.some((word) => word === name)) {
    throw new UsageError(`library name "${name}" is reserved; reserved words: ${RESERVED_LIBRARY_WORDS.join(", ")}`);
  }
  const current = readLibraries(root);
  if (current.libraries[name] !== undefined) {
    throw new UsageError(`library "${name}" already exists; remove it first`);
  }
  readPluginDescription(root, definition.plugin);
  if (!isAbsoluteUrl(definition.baseUrl)) {
    throw new UsageError(`library "${name}" needs an absolute base URL`);
  }
  const libraries = { ...current.libraries, [name]: definition };
  return writeLibraries(root, { version: 1, libraries });
}

export function removeLibrary(root: string, name: string): LibrariesFile {
  const current = readLibraries(root);
  if (current.libraries[name] === undefined) {
    throw new UsageError(`unknown library "${name}"; known libraries: ${knownLibraryList(current)}`);
  }
  const libraries = { ...current.libraries };
  delete libraries[name];
  rmSync(catalogCachePath(root, name), { force: true });
  return writeLibraries(root, { version: 1, libraries });
}

export function readResolvedLibrary(
  root: string,
  name: string,
): { definition: LibraryDefinition; description: PluginDescription } {
  const file = readLibraries(root);
  const definition = file.libraries[name];
  if (definition === undefined) {
    throw new UsageError(`unknown library "${name}"; known libraries: ${knownLibraryList(file)}`);
  }
  return { definition, description: readPluginDescription(root, definition.plugin) };
}

function parseCachedEntries(input: unknown): CatalogEntry[] | null {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.entries)) {
    return null;
  }
  const entries: CatalogEntry[] = [];
  for (const item of raw.entries) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const cached = item as Record<string, unknown>;
    if (typeof cached.id !== "string") {
      return null;
    }
    const entry: CatalogEntry = { id: cached.id };
    if (cached.group !== undefined) {
      if (typeof cached.group !== "string") {
        return null;
      }
      entry.group = cached.group;
    }
    if (cached.label !== undefined) {
      if (typeof cached.label !== "string") {
        return null;
      }
      entry.label = cached.label;
    }
    entries.push(entry);
  }
  return entries;
}

export function readCachedCatalog(root: string, library: string): CatalogEntry[] | null {
  const path = catalogCachePath(root, library);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return parseCachedEntries(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

export function writeCatalogCache(root: string, library: string, entries: CatalogEntry[]): void {
  const path = catalogCachePath(root, library);
  mkdirSync(join(root, ".browsershot", "cache"), { recursive: true });
  const file: CatalogCacheFile = { fetchedAt: new Date().toISOString(), entries };
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(temporary, path);
}

async function fetchCatalogDocument(url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { headers });
  if (response.status === 401 || response.status === 403) {
    throw new CatalogCredentialsRejected(response.status);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function compareEntries(a: CatalogEntry, b: CatalogEntry): number {
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

async function discoverFileEntries(root: string, discovery: PluginFilesDiscovery): Promise<CatalogEntry[]> {
  const scanRoot = join(root, discovery.root ?? ".");
  const entries: CatalogEntry[] = [];
  for await (const file of new Bun.Glob(discovery.glob).scan({ cwd: scanRoot })) {
    const id = file.replaceAll("\\", "/");
    entries.push({ id, label: basename(id).replace(/\.[^.]*$/, "") });
  }
  entries.sort(compareEntries);
  return entries;
}

function catalogUrl(description: PluginDescription, baseUrl: string): string {
  const http = description.discover.http;
  if (http?.url !== undefined) {
    return http.url;
  }
  return `${baseUrl.replace(/\/+$/, "")}${http?.path ?? "/"}`;
}

export async function fetchLibraryCatalog(input: {
  root: string;
  name: string;
  fetcher?: CatalogFetcher;
}): Promise<CatalogEntry[]> {
  const { definition, description } = readResolvedLibrary(input.root, input.name);
  let headers: Record<string, string> = {};
  let authVariable: string | undefined;
  if (description.auth !== undefined) {
    authVariable = description.auth.valueFrom.slice(ENV_REFERENCE_PREFIX.length);
    try {
      const resolved = resolvePluginAuthHeader(description.auth);
      headers = { [resolved.header]: resolved.value };
    } catch (error) {
      if (error instanceof ExitError && error.code === EXIT_ENVIRONMENT) {
        throw new ExitError(
          `library "${input.name}" catalog needs environment variable ${authVariable}; it is unset`,
          EXIT_ENVIRONMENT,
        );
      }
      throw error;
    }
  }
  if (description.discover.files !== undefined) {
    const entries = await discoverFileEntries(input.root, description.discover.files);
    writeCatalogCache(input.root, input.name, entries);
    return entries;
  }
  const url = catalogUrl(description, definition.baseUrl);
  const fetcher = input.fetcher ?? fetchCatalogDocument;
  let document: unknown;
  try {
    document = await fetcher(url, headers);
  } catch (error) {
    if (error instanceof ExitError) {
      throw error;
    }
    if (error instanceof CatalogCredentialsRejected && authVariable !== undefined) {
      throw new ExitError(
        `library "${input.name}" catalog rejected credentials for environment variable ${authVariable}`,
        EXIT_ENVIRONMENT,
      );
    }
    throw new ExitError(
      `library "${input.name}" catalog unreachable at ${url}: ${(error as Error).message}`,
      EXIT_FAILED,
    );
  }
  const entries = mapCatalogEntries(document, description);
  writeCatalogCache(input.root, input.name, entries);
  return entries;
}

export function matchCatalogEntry(entries: CatalogEntry[], wanted: string): CatalogEntry[] {
  const exact = entries.filter((entry) => entry.id === wanted);
  if (exact.length > 0) {
    return exact;
  }
  const lowered = wanted.toLowerCase();
  return entries.filter((entry) => {
    const label = entry.label;
    if (label === undefined) {
      return false;
    }
    if (entry.group !== undefined && `${entry.group}/${label}`.toLowerCase() === lowered) {
      return true;
    }
    return label.toLowerCase() === lowered;
  });
}

export async function resolveLibraryTarget(input: {
  library: string;
  entry: string;
  root: string;
  fetcher?: CatalogFetcher;
}): Promise<CaptureTarget> {
  const { definition, description } = readResolvedLibrary(input.root, input.library);
  const cached = readCachedCatalog(input.root, input.library);
  let matches: CatalogEntry[] = [];
  if (cached !== null) {
    matches = matchCatalogEntry(cached, input.entry);
  }
  if (matches.length === 0) {
    const entries = await fetchLibraryCatalog({ root: input.root, name: input.library, fetcher: input.fetcher });
    matches = matchCatalogEntry(entries, input.entry);
  }
  if (matches.length === 0) {
    throw new UsageError(`unknown entry "${input.entry}" in library "${input.library}"`);
  }
  if (matches.length > 1) {
    const candidates = matches.map((entry) => entry.id).sort();
    throw new UsageError(`ambiguous entry "${input.entry}"; candidates: ${candidates.join(", ")}`);
  }
  const match = matches[0];
  const target: CaptureTarget = {
    url: expandPluginAddress(description, match, definition.baseUrl),
    identity: { kind: "library", library: input.library, entry: match.id },
  };
  const element = definition.scope ?? description.scope;
  if (element !== undefined) {
    target.element = element;
  }
  const expectElement = definition.ready ?? description.ready;
  if (expectElement !== undefined) {
    target.expectElement = expectElement;
  }
  return target;
}
