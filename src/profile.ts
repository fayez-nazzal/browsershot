import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  profileValueFromCommand,
  resolveProfileSettingName,
  validateProfileConfig,
  type ProfileConfig,
} from "./profile-settings.ts";
import { UsageError } from "./exit-codes.ts";

export type { ProfileConfig } from "./profile-settings.ts";

export interface ProfilePaths {
  directory: string;
  config: string;
  captures: string;
}

export function profilePaths(root = process.cwd()): ProfilePaths {
  const directory = join(root, ".browsershot");
  return { directory, config: join(directory, "config.json"), captures: join(directory, "captures") };
}

export function readProfile(root = process.cwd()): ProfileConfig {
  const path = profilePaths(root).config;
  if (!existsSync(path)) return {};
  try {
    return validateProfileConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (error instanceof UsageError) throw error;
    if (error instanceof SyntaxError) throw new UsageError(`malformed profile config: ${path}`);
    throw new UsageError(`could not read profile config ${path}: ${(error as Error).message}`);
  }
}

export function writeProfile(root: string, config: ProfileConfig): void {
  const paths = profilePaths(root);
  const validatedConfig = validateProfileConfig(config);
  mkdirSync(paths.directory, { recursive: true });
  const temporary = `${paths.config}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(validatedConfig, null, 2)}\n`);
  renameSync(temporary, paths.config);
}

export function setProfileValue(root: string, name: string, rawValue?: string): ProfileConfig {
  const current = readProfile(root);
  const setting = profileValueFromCommand(name, rawValue);
  const config = { ...current } as Record<string, unknown>;
  config[setting.name] = setting.value;
  writeProfile(root, config);
  return config as ProfileConfig;
}

export function unsetProfileValue(root: string, name: string): ProfileConfig {
  const setting = resolveProfileSettingName(name);
  if (setting === null) throw new UsageError(`unknown profile setting: ${name}`);
  const config = { ...readProfile(root) } as Record<string, unknown>;
  delete config[setting];
  writeProfile(root, config);
  return config as ProfileConfig;
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
