import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ExitError, EXIT_ENVIRONMENT, UsageError } from "./exit-codes.ts";

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const ENV_REFERENCE_PATTERN = /^env:[A-Za-z_][A-Za-z0-9_]*$/;
const KEY_REFERENCE = "$key";

export interface PluginHttpDiscovery {
  path?: string;
  url?: string;
}

export interface PluginFilesDiscovery {
  glob: string;
  root?: string;
}

export interface PluginDiscover {
  http?: PluginHttpDiscovery;
  files?: PluginFilesDiscovery;
  entries: string;
  filter?: Record<string, unknown>;
  id: string;
  group?: string;
  label?: string;
}

export interface PluginAuth {
  header: string;
  valueFrom: string;
}

export interface PluginDescription {
  version: 1;
  name: string;
  discover: PluginDiscover;
  address: string;
  ready?: string;
  scope?: string;
  auth?: PluginAuth;
}

export interface CatalogEntry {
  id: string;
  group?: string;
  label?: string;
}

export const BUILTIN_PLUGIN_DESCRIPTIONS: Record<string, PluginDescription> = {
  storybook: {
    version: 1,
    name: "storybook",
    discover: {
      http: { path: "/index.json" },
      entries: "entries",
      filter: { type: "story" },
      id: "id",
      group: "title",
      label: "name",
    },
    address: "/iframe.html?id={id}&viewMode=story",
    ready: "#storybook-root",
  },
  ladle: {
    version: 1,
    name: "ladle",
    discover: {
      http: { path: "/meta.json" },
      entries: "stories",
      id: "$key",
      group: "levels.0",
      label: "name",
    },
    address: "/?story={id}",
    ready: "html[data-storyloaded]",
  },
};

function pluginError(source: string, message: string): UsageError {
  return new UsageError(`${source} plugin: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainValue(value: unknown): boolean {
  if (value === null) return true;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isFieldReference(value: unknown): value is string {
  return isNonEmptyString(value) && value.split(".").every((segment) => segment !== "");
}

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
function validatePluginHttpUrl(value: string, source: string): void {
  const url = new URL(value);
  if (url.username !== "" || url.password !== "") {
    throw pluginError(source, "discover.http.url credentials are not allowed");
  }
  if (url.search !== "" || value.includes("?")) {
    throw pluginError(source, "discover.http.url query is not allowed");
  }
  if (url.hash !== "" || value.includes("#")) {
    throw pluginError(source, "discover.http.url hash is not allowed");
  }
}

function knownNamesText(names: string[]): string {
  return names.length === 0 ? "(none)" : names.join(", ");
}
function isKnownAddressPlaceholder(name: string): boolean {
  return name === "base" || name === "id" || name === "group" || name === "label";
}

function validateAddressTemplate(template: string): void {
  for (let index = 0; index < template.length;) {
    if (template.startsWith("{{", index) || template.startsWith("}}", index)) {
      index += 2;
      continue;
    }
    if (template[index] === "{") {
      const close = template.indexOf("}", index + 1);
      if (close === -1) {
        index += 1;
        continue;
      }
      const name = template.slice(index + 1, close);
      if (!isKnownAddressPlaceholder(name)) {
        throw new UsageError(`unknown address placeholder: {${name}}`);
      }
      index = close + 1;
      continue;
    }
    index += 1;
  }
}

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function parsePluginDescription(input: unknown, source: string): PluginDescription {
  if (!isObject(input)) {
    throw pluginError(source, "description must be an object");
  }
  if (input.version !== 1) {
    throw pluginError(source, "version must be 1");
  }
  if (typeof input.name !== "string" || !NAME_PATTERN.test(input.name)) {
    throw pluginError(source, `name must match ${NAME_PATTERN}`);
  }
  const rawDiscover = input.discover;
  if (!isObject(rawDiscover)) {
    throw pluginError(source, "discover must be an object");
  }
  const hasHttp = rawDiscover.http !== undefined;
  const hasFiles = rawDiscover.files !== undefined;
  if (hasHttp === hasFiles) {
    throw pluginError(source, "discover must define exactly one of http or files");
  }
  let http: PluginHttpDiscovery | undefined;
  if (hasHttp) {
    const rawHttp = rawDiscover.http;
    if (!isObject(rawHttp)) {
      throw pluginError(source, "discover.http must be an object");
    }
    const hasPath = rawHttp.path !== undefined;
    const hasUrl = rawHttp.url !== undefined;
    if (hasPath === hasUrl) {
      throw pluginError(source, "discover.http must define exactly one of path or url");
    }
    if (hasPath) {
      if (!isNonEmptyString(rawHttp.path) || !rawHttp.path.startsWith("/")) {
        throw pluginError(source, 'discover.http.path must start with "/"');
      }
      http = { path: rawHttp.path };
    } else {
      if (typeof rawHttp.url !== "string" || !isAbsoluteUrl(rawHttp.url)) {
        throw pluginError(source, "discover.http.url must be an absolute URL");
      }
      validatePluginHttpUrl(rawHttp.url, source);
      http = { url: rawHttp.url };
    }
  }
  let files: PluginFilesDiscovery | undefined;
  if (hasFiles) {
    const rawFiles = rawDiscover.files;
    if (!isObject(rawFiles)) {
      throw pluginError(source, "discover.files must be an object");
    }
    if (!isNonEmptyString(rawFiles.glob)) {
      throw pluginError(source, "discover.files.glob must be a non-empty string");
    }
    files = { glob: rawFiles.glob };
    if (rawFiles.root !== undefined) {
      if (!isNonEmptyString(rawFiles.root)) {
        throw pluginError(source, "discover.files.root must be a non-empty string");
      }
      files.root = rawFiles.root;
    }
  }
  if (!isFieldReference(rawDiscover.entries)) {
    throw pluginError(source, "discover.entries must be a non-empty dotted path");
  }
  if (!isFieldReference(rawDiscover.id)) {
    throw pluginError(source, "discover.id must be a non-empty field reference");
  }
  let group: string | undefined;
  if (rawDiscover.group !== undefined) {
    if (!isFieldReference(rawDiscover.group)) {
      throw pluginError(source, "discover.group must be a non-empty field reference");
    }
    group = rawDiscover.group;
  }
  let label: string | undefined;
  if (rawDiscover.label !== undefined) {
    if (!isFieldReference(rawDiscover.label)) {
      throw pluginError(source, "discover.label must be a non-empty field reference");
    }
    label = rawDiscover.label;
  }
  let filter: Record<string, unknown> | undefined;
  if (rawDiscover.filter !== undefined) {
    if (!isObject(rawDiscover.filter)) {
      throw pluginError(source, "discover.filter must be an object of plain values");
    }
    if (Object.values(rawDiscover.filter).some((value) => !isPlainValue(value))) {
      throw pluginError(source, "discover.filter must be an object of plain values");
    }
    filter = rawDiscover.filter;
  }
  if (!isNonEmptyString(input.address)) {
    throw pluginError(source, "address must be a non-empty string");
  }
  validateAddressTemplate(input.address);
  let ready: string | undefined;
  if (input.ready !== undefined) {
    if (!isNonEmptyString(input.ready)) {
      throw pluginError(source, "ready must be a non-empty string");
    }
    ready = input.ready;
  }
  let scope: string | undefined;
  if (input.scope !== undefined) {
    if (!isNonEmptyString(input.scope)) {
      throw pluginError(source, "scope must be a non-empty string");
    }
    scope = input.scope;
  }
  let auth: PluginAuth | undefined;
  if (input.auth !== undefined) {
    const rawAuth = input.auth;
    if (!isObject(rawAuth)) {
      throw pluginError(source, "auth must be an object");
    }
    if (!isNonEmptyString(rawAuth.header)) {
      throw pluginError(source, "auth header must be a non-empty string");
    }
    if (typeof rawAuth.valueFrom !== "string" || !ENV_REFERENCE_PATTERN.test(rawAuth.valueFrom)) {
      const shown = String(rawAuth.valueFrom);
      throw pluginError(source, `auth valueFrom must look like env:NAME, got "${shown}"`);
    }
    auth = { header: rawAuth.header, valueFrom: rawAuth.valueFrom };
  }
  const discover: PluginDiscover = { entries: rawDiscover.entries, id: rawDiscover.id };
  if (http !== undefined) {
    discover.http = http;
  }
  if (files !== undefined) {
    discover.files = files;
  }
  if (group !== undefined) {
    discover.group = group;
  }
  if (label !== undefined) {
    discover.label = label;
  }
  if (filter !== undefined) {
    discover.filter = filter;
  }
  const description: PluginDescription = {
    version: 1,
    name: input.name,
    discover,
    address: input.address,
  };
  if (ready !== undefined) {
    description.ready = ready;
  }
  if (scope !== undefined) {
    description.scope = scope;
  }
  if (auth !== undefined) {
    description.auth = auth;
  }
  return description;
}

function readPluginFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new UsageError(`malformed plugin file: ${path}`);
    }
    throw new UsageError(`could not read plugin file ${path}: ${(error as Error).message}`);
  }
}

export function knownPluginNames(root: string): string[] {
  const directory = join(root, ".browsershot", "plugins");
  const names = new Set<string>(Object.keys(BUILTIN_PLUGIN_DESCRIPTIONS));
  if (existsSync(directory)) {
    for (const file of readdirSync(directory)) {
      if (file.endsWith(".json")) {
        names.add(file.slice(0, -5));
      }
    }
  }
  return [...names].sort();
}

export function readPluginDescription(root: string, name: string): PluginDescription {
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    throw new UsageError(`invalid plugin name "${name}"; names match [a-z0-9][a-z0-9_-]*`);
  }
  const path = join(root, ".browsershot", "plugins", `${name}.json`);
  if (existsSync(path)) {
    return parsePluginDescription(readPluginFile(path), name);
  }
  if (Object.prototype.hasOwnProperty.call(BUILTIN_PLUGIN_DESCRIPTIONS, name)) {
    return BUILTIN_PLUGIN_DESCRIPTIONS[name];
  }
  throw new UsageError(`unknown plugin "${name}"; known plugins: ${knownNamesText(knownPluginNames(root))}`);
}

function resolveDottedPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (!isObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function resolveFieldReference(item: unknown, key: string | undefined, reference: string): unknown {
  if (reference === KEY_REFERENCE) {
    return key;
  }
  return resolveDottedPath(item, reference);
}

function referenceText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function optionalReferenceText(
  item: unknown,
  key: string | undefined,
  reference: string | undefined,
): string | undefined {
  if (reference === undefined) {
    return undefined;
  }
  return referenceText(resolveFieldReference(item, key, reference));
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => deepEqual(left[key], right[key]));
  }
  return false;
}

function matchesFilter(item: unknown, filter: Record<string, unknown> | undefined): boolean {
  if (filter === undefined) {
    return true;
  }
  return Object.keys(filter).every((path) => deepEqual(resolveDottedPath(item, path), filter[path]));
}

function catalogEntry(
  item: unknown,
  key: string | undefined,
  discover: PluginDiscover,
): CatalogEntry | null {
  if (!matchesFilter(item, discover.filter)) {
    return null;
  }
  const id = referenceText(resolveFieldReference(item, key, discover.id));
  if (id === undefined) {
    return null;
  }
  const entry: CatalogEntry = { id };
  const group = optionalReferenceText(item, key, discover.group);
  const label = optionalReferenceText(item, key, discover.label);
  if (group !== undefined) {
    entry.group = group;
  }
  if (label !== undefined) {
    entry.label = label;
  }
  return entry;
}

export function mapCatalogEntries(document: unknown, description: PluginDescription): CatalogEntry[] {
  const discovered = resolveDottedPath(document, description.discover.entries);
  const entries: CatalogEntry[] = [];
  if (Array.isArray(discovered)) {
    for (const item of discovered) {
      const entry = catalogEntry(item, undefined, description.discover);
      if (entry !== null) {
        entries.push(entry);
      }
    }
  } else if (isObject(discovered)) {
    for (const key of Object.keys(discovered)) {
      const entry = catalogEntry(discovered[key], key, description.discover);
      if (entry !== null) {
        entries.push(entry);
      }
    }
  } else {
    throw new UsageError(`catalog entries not found at ${description.discover.entries}`);
  }
  return entries.sort((a, b) => compareCodePoints(a.id, b.id));
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function joinAddress(baseUrl: string, address: string): string {
  const base = trimTrailingSlashes(baseUrl);
  const separator = address.startsWith("/") ? "" : "/";
  const joined = `${base}${separator}${address}`;
  let result = joined;
  if (isAbsoluteUrl(joined)) {
    result = new URL(joined).toString();
  }
  return result;
}

export function expandPluginAddress(
  description: PluginDescription,
  entry: CatalogEntry,
  baseUrl: string,
): string {
  const template = description.address;
  validateAddressTemplate(template);
  const base = trimTrailingSlashes(baseUrl);
  const values = { base, id: entry.id, group: entry.group ?? "", label: entry.label ?? "" };
  let expanded = "";
  for (let index = 0; index < template.length;) {
    if (template.startsWith("{{", index)) {
      expanded += "{";
      index += 2;
      continue;
    }
    if (template.startsWith("}}", index)) {
      expanded += "}";
      index += 2;
      continue;
    }
    if (template[index] === "{") {
      const close = template.indexOf("}", index + 1);
      if (close === -1) {
        expanded += "{";
        index += 1;
        continue;
      }
      const name = template.slice(index + 1, close);
      if (!Object.prototype.hasOwnProperty.call(values, name)) {
        throw new UsageError(`unknown address placeholder: {${name}}`);
      }
      expanded += values[name as keyof typeof values];
      index = close + 1;
      continue;
    }
    expanded += template[index];
    index += 1;
  }
  let result = expanded;
  if (!isAbsoluteUrl(expanded)) {
    result = joinAddress(baseUrl, expanded);
  }
  return result;
}

export function resolvePluginAuthHeader(auth: PluginAuth): { header: string; value: string } {
  if (typeof auth.valueFrom !== "string" || !ENV_REFERENCE_PATTERN.test(auth.valueFrom)) {
    throw new UsageError(`plugin auth valueFrom must look like env:NAME, got "${String(auth.valueFrom)}"`);
  }
  const name = auth.valueFrom.slice("env:".length);
  const value = process.env[name];
  if (value === undefined) {
    throw new ExitError(`environment variable ${name} is unset`, EXIT_ENVIRONMENT);
  }
  return { header: auth.header, value };
}
