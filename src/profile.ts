import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ProfileConfig {
  baseUrl?: string;
  authUser?: string;
  authRedirect?: string;
  expectElement?: string;
  expectText?: string;
  output?: string;
  json?: boolean;
  autoOpen?: boolean;
  publish?: string;
}

interface ProfilePaths {
  directory: string;
  config: string;
  captures: string;
}

const aliases: Record<string, string> = {
  url: "baseUrl", "base-url": "baseUrl", "auth-user": "authUser",
  "auth-redirect": "authRedirect",
  "expect-text": "expectText", "expect-element": "expectElement", "auto-open": "autoOpen",
};
const CONFIG_KEYS = new Set(["baseUrl", "base-url", "url", "authUser", "auth-user", "authRedirect", "auth-redirect", "expectElement", "expect-element", "expectText", "expect-text", "output", "json", "autoOpen", "auto-open", "publish"]);

export function profilePaths(root = process.cwd()): ProfilePaths {
  const directory = join(root, ".browsershot");
  return { directory, config: join(directory, "config.json"), captures: join(directory, "captures") };
}

function validateConfig(config: unknown): ProfileConfig {
  if (config == null || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("profile config must be a JSON object");
  }
  const raw = config as Record<string, unknown>;
  const normalizedInput: Record<string, unknown> = { ...raw };
  if (raw.baseUrl !== undefined) delete normalizedInput.url;
  else if (raw.url !== undefined) normalizedInput.baseUrl = raw.url;
  delete normalizedInput.url;
  const result: ProfileConfig = {};
  for (const [key, value] of Object.entries(normalizedInput)) {
    if (!["baseUrl", "authUser", "authRedirect", "expectElement", "expectText", "output", "json", "autoOpen", "publish", "url"].includes(key)) {
      throw new Error(`unknown profile setting: ${key}`);
    }
    if (["json", "autoOpen"].includes(key)) {
      if (typeof value !== "boolean") {
        throw new Error(`profile setting ${key} must be boolean`);
      }
    } else if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`profile setting ${key} must be a non-empty string`);
    }
    (result as Record<string, unknown>)[key] = value;
  }
  if (result.baseUrl !== undefined) {
    try { new URL(result.baseUrl); } catch { throw new Error("profile setting baseUrl must be an absolute URL"); }
  }
  return result;
}

export function readProfile(root = process.cwd()): ProfileConfig {
  const path = profilePaths(root).config;
  let result: ProfileConfig = {};
  if (existsSync(path)) {
    try {
      result = validateConfig(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`malformed profile config: ${path}`);
      }
      throw error;
    }
  }
  return result;
}

export function writeProfile(root: string, config: ProfileConfig): void {
  const paths = profilePaths(root);
  mkdirSync(paths.directory, { recursive: true });
  const temporary = `${paths.config}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(validateConfig(config), null, 2)}\n`);
  renameSync(temporary, paths.config);
}

export function setProfileValue(root: string, name: string, rawValue?: string): ProfileConfig {
  if (!CONFIG_KEYS.has(name)) {
    throw new Error(`unknown profile setting: ${name}`);
  }
  const current = readProfile(root);
  const config = { ...current };
  const property = aliases[name] ?? name;
  if (["json", "autoOpen"].includes(property)) {
    if (rawValue != null) {
      throw new Error(`${name} does not take a value`);
    }
    (config as Record<string, unknown>)[property] = true;
  } else {
    if (rawValue == null || rawValue.trim() === "") {
      throw new Error(`${name} needs a non-empty value`);
    }
    if (property === "baseUrl") {
      try {
        new URL(rawValue);
      } catch {
        throw new Error("baseUrl must be an absolute URL");
      }
    }
    (config as Record<string, unknown>)[property] = rawValue;
  }
  writeProfile(root, config);
  return config;
}

export function unsetProfileValue(root: string, name: string): ProfileConfig {
  if (!CONFIG_KEYS.has(name)) {
    throw new Error(`unknown profile setting: ${name}`);
  }
  const config = { ...readProfile(root) } as Record<string, unknown>;
  const property = aliases[name] ?? name;
  delete config[property];
  writeProfile(root, config);
  return config;
}

export function resolveQuickUrl(base: string, quickPath: string): string {
  if (quickPath.trim() === "" || quickPath.startsWith("?") || quickPath.startsWith("#")) {
    throw new Error(`invalid quick path: ${quickPath}`);
  }
  const url = new URL(base);
  const path = quickPath.replace(/^\/+/, "");
  if (url.hash !== "") {
    const route = url.hash.slice(1).replace(/\/+$/, "");
    url.hash = `#${route}/${path}`;
  } else {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${path}`;
  }
  return url.toString();
}
