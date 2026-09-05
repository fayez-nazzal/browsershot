import { expandOutputTemplate, validateOutputGroup, validateOutputLabel, type OutputTemplateValues } from "./output-path.ts";
import { UsageError } from "./exit-codes.ts";

export interface ProfileConfig {
  baseUrl?: string;
  authUser?: string;
  authRedirect?: string;
  expectElement?: string;
  expectText?: string;
  output?: string;
  group?: string;
  label?: string;
  json?: boolean;
  autoOpen?: boolean;
  publish?: string;
}

export type ProfileSettingName = keyof ProfileConfig;
type ProfileSettingDefinition = {
  kind: "string" | "boolean";
  aliases?: readonly string[];
  validate?: (value: string) => void;
};

const TEMPLATE_EXAMPLE: OutputTemplateValues = {
  date: "2026-09-05",
  time: "14-30-12",
  timestamp: "2026-09-05_14-30-12",
  host: "example.com",
  route: "pricing",
  query: "filter-a31f82c4d901",
};

function absoluteUrl(value: string): void {
  try {
    new URL(value);
  } catch {
    throw new UsageError("profile setting baseUrl must be an absolute URL");
  }
}

export const PROFILE_SETTINGS: { [Name in ProfileSettingName]-?: ProfileSettingDefinition } = {
  baseUrl: { kind: "string", aliases: ["base-url", "url"], validate: absoluteUrl },
  authUser: { kind: "string", aliases: ["auth-user"] },
  authRedirect: { kind: "string", aliases: ["auth-redirect"] },
  expectElement: { kind: "string", aliases: ["expect-element"] },
  expectText: { kind: "string", aliases: ["expect-text"] },
  output: { kind: "string", validate: (value) => { expandOutputTemplate(value, TEMPLATE_EXAMPLE); } },
  group: { kind: "string", validate: (value) => { validateOutputGroup(value, TEMPLATE_EXAMPLE); } },
  label: { kind: "string", validate: (value) => { validateOutputLabel(value, TEMPLATE_EXAMPLE); } },
  json: { kind: "boolean" },
  autoOpen: { kind: "boolean", aliases: ["auto-open"] },
  publish: { kind: "string" },
};

export const PROFILE_SETTING_NAMES = Object.freeze(
  Object.keys(PROFILE_SETTINGS) as ProfileSettingName[],
);

const PROFILE_SETTING_LOOKUP = Object.freeze(Object.entries(PROFILE_SETTINGS).reduce<Record<string, ProfileSettingName>>(
  (lookup, [name, definition]) => {
    const canonicalName = name as ProfileSettingName;
    lookup[canonicalName] = canonicalName;
    for (const alias of definition.aliases ?? []) {
      lookup[alias] = canonicalName;
    }
    return lookup;
  },
  {},
));

function validateString(name: ProfileSettingName, value: string): void {
  const validator = PROFILE_SETTINGS[name].validate;
  if (validator === undefined) return;
  try {
    validator(value);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    if (error instanceof Error) throw new UsageError(error.message);
    throw new UsageError(String(error));
  }
}

export function resolveProfileSettingName(name: string): ProfileSettingName | null {
  return PROFILE_SETTING_LOOKUP[name] ?? null;
}

export function validateProfileConfig(input: unknown): ProfileConfig {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new UsageError("profile config must be a JSON object");
  }
  const raw = input as Record<string, unknown>;
  const normalizedInput: Record<string, unknown> = { ...raw };
  if (raw.baseUrl === undefined && raw.url !== undefined) {
    normalizedInput.baseUrl = raw.url;
  }
  delete normalizedInput.url;
  const result: ProfileConfig = {};
  for (const [key, value] of Object.entries(normalizedInput)) {
    if (!Object.hasOwn(PROFILE_SETTINGS, key)) {
      throw new UsageError(`unknown profile setting: ${key}`);
    }
    const name = key as ProfileSettingName;
    const definition = PROFILE_SETTINGS[name];
    if (definition.kind === "boolean") {
      if (typeof value !== "boolean") {
        throw new UsageError(`profile setting ${name} must be boolean`);
      }
    } else {
      if (typeof value !== "string" || value.trim() === "") {
        throw new UsageError(`profile setting ${name} must be a non-empty string`);
      }
      validateString(name, value);
    }
    (result as Record<string, unknown>)[name] = value;
  }
  if (result.output !== undefined && (result.group !== undefined || result.label !== undefined)) {
    throw new UsageError("saved output cannot be combined with group or label; unset output or the structured naming settings first");
  }
  return result;
}

export function profileValueFromCommand(
  name: string,
  rawValue?: string,
): { name: ProfileSettingName; value: string | true } {
  const resolvedName = resolveProfileSettingName(name);
  if (resolvedName === null) {
    throw new UsageError(`unknown profile setting: ${name}`);
  }
  const definition = PROFILE_SETTINGS[resolvedName];
  if (definition.kind === "boolean") {
    if (rawValue !== undefined) {
      throw new UsageError(`${name} does not take a value`);
    }
    return { name: resolvedName, value: true };
  }
  if (rawValue === undefined || rawValue.trim() === "") {
    throw new UsageError(`${name} needs a non-empty value`);
  }
  validateString(resolvedName, rawValue);
  return { name: resolvedName, value: rawValue };
}
