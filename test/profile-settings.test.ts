import { expect, test } from "bun:test";
import { UsageError } from "../src/exit-codes.ts";
import {
  PROFILE_SETTINGS,
  PROFILE_SETTING_NAMES,
  profileValueFromCommand,
  resolveProfileSettingName,
  validateProfileConfig,
} from "../src/profile-settings.ts";

test("the registry contains every persistent setting exactly once", () => {
  expect(PROFILE_SETTING_NAMES).toEqual([
    "baseUrl", "authUser", "authRedirect", "expectElement", "expectText",
    "output", "group", "label", "json", "autoOpen", "publish",
  ]);
  expect(Object.keys(PROFILE_SETTINGS)).toEqual(PROFILE_SETTING_NAMES);
  expect(PROFILE_SETTINGS.json.kind).toBe("boolean");
  expect(PROFILE_SETTINGS.autoOpen.kind).toBe("boolean");
  expect(PROFILE_SETTINGS.baseUrl.kind).toBe("string");
});

test("canonical names and legacy aliases resolve through one registry", () => {
  expect(resolveProfileSettingName("baseUrl")).toBe("baseUrl");
  expect(resolveProfileSettingName("base-url")).toBe("baseUrl");
  expect(resolveProfileSettingName("url")).toBe("baseUrl");
  expect(resolveProfileSettingName("auth-user")).toBe("authUser");
  expect(resolveProfileSettingName("auth-redirect")).toBe("authRedirect");
  expect(resolveProfileSettingName("expect-element")).toBe("expectElement");
  expect(resolveProfileSettingName("expect-text")).toBe("expectText");
  expect(resolveProfileSettingName("auto-open")).toBe("autoOpen");
  expect(resolveProfileSettingName("unknown")).toBeNull();
});

test("command values use descriptor kinds and validators", () => {
  expect(profileValueFromCommand("json", undefined)).toEqual({ name: "json", value: true });
  expect(profileValueFromCommand("url", "https://example.com/app")).toEqual({
    name: "baseUrl", value: "https://example.com/app",
  });
  expect(() => profileValueFromCommand("json", "true")).toThrow("does not take a value");
  expect(() => profileValueFromCommand("baseUrl", "not a url")).toThrow("absolute URL");
  expect(() => profileValueFromCommand("unknown", "x")).toThrow(UsageError);
});

test("raw validation normalizes legacy url and rejects invalid combinations", () => {
  expect(validateProfileConfig({ url: "https://legacy.example", json: true })).toEqual({
    baseUrl: "https://legacy.example", json: true,
  });
  expect(validateProfileConfig({ url: "https://legacy.example", baseUrl: "https://canonical.example" }).baseUrl)
    .toBe("https://canonical.example");
  expect(() => validateProfileConfig({ output: "shot.png", label: "menu" })).toThrow("cannot be combined");
  expect(() => validateProfileConfig({ json: "true" })).toThrow("must be boolean");
  expect(() => validateProfileConfig({ mystery: "x" })).toThrow(UsageError);
});
