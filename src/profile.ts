import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

export interface ProfileConfig {
  url?: string;
  authUser?: string;
  expectText?: string;
  output?: string;
  json?: boolean;
  autoOpen?: boolean;
}

interface ProfilePaths {
  directory: string;
  config: string;
  captures: string;
}

const CONFIG_KEYS = new Set(["url", "auth-user", "expect-text", "output", "json", "auto-open"]);

export function findProjectRoot(start = process.cwd()): string {
  let current = resolve(start);
  let result = "";
  while (true) {
    if (existsSync(join(current, ".git"))) {
      result = current;
      break;
    }
    const parent = parse(current).dir;
    if (parent === current) {
      break;
    }
    current = parent;
  }
  if (result === "") {
    throw new Error(`no project root found from ${start}`);
  }
  return result;
}

export function profilePaths(root = findProjectRoot()): ProfilePaths {
  const directory = join(root, ".browsershot");
  return { directory, config: join(directory, "config.json"), captures: join(directory, "captures") };
}

function validateConfig(config: unknown): ProfileConfig {
  if (config == null || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("profile config must be a JSON object");
  }
  const result: ProfileConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (!["url", "authUser", "expectText", "output", "json", "autoOpen"].includes(key)) {
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
  return result;
}

export function readProfile(root = findProjectRoot()): ProfileConfig {
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
  addProfileExclude(root);
  const temporary = `${paths.config}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(validateConfig(config), null, 2)}\n`);
  renameSync(temporary, paths.config);
}

export function addProfileExclude(root: string): void {
  const gitPath = join(root, ".git");
  if (!existsSync(gitPath)) {
    throw new Error(`no .git directory found at ${root}`);
  }
  const exclude = join(gitPath, "info", "exclude");
  mkdirSync(dirname(exclude), { recursive: true });
  const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  const lines = current.split("\n");
  if (!lines.includes(".browsershot/")) {
    let next = current;
    if (next !== "" && !next.endsWith("\n")) {
      next = `${next}\n`;
    }
    next = `${next}.browsershot/\n`;
    writeFileSync(exclude, next);
  }
}

export function setProfileValue(root: string, name: string, rawValue?: string): ProfileConfig {
  if (!CONFIG_KEYS.has(name)) {
    throw new Error(`unknown profile setting: ${name}`);
  }
  const current = readProfile(root);
  const config = { ...current };
  if (["json", "auto-open"].includes(name)) {
    if (rawValue != null) {
      throw new Error(`${name} does not take a value`);
    }
    (config as Record<string, unknown>)[name === "json" ? "json" : "autoOpen"] = true;
  } else {
    if (rawValue == null || rawValue.trim() === "") {
      throw new Error(`${name} needs a non-empty value`);
    }
    const property = name === "auth-user" ? "authUser" : name === "expect-text" ? "expectText" : name;
    if (property === "url") {
      try {
        new URL(rawValue);
      } catch {
        throw new Error("url must be an absolute URL");
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
  const property = name === "auth-user" ? "authUser" : name === "expect-text" ? "expectText" : name === "auto-open" ? "autoOpen" : name;
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
