import { UsageError } from "./exit-codes.ts";

export const THEME_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function parseThemeName(value: string): string {
  if (!THEME_NAME_PATTERN.test(value)) {
    throw new UsageError(`--theme needs a name such as light, dark or sepia; got ${JSON.stringify(value)}`);
  }
  return value;
}
