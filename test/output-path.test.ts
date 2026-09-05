import { expect, test } from "bun:test";
import { expandOutputTemplate, outputTemplateValues, resolveOutputPath, timestamp } from "../src/output-path.ts";

const now = new Date(2026, 8, 5, 14, 30, 12);

test("timestamp uses a readable sortable local date and time", () => {
  expect(timestamp(now)).toBe("2026-09-05_14-30-12");
});

test("output template values describe the resolved URL safely", () => {
  expect(outputTemplateValues("http://localhost:3000/account/settings?q=secret#panel", now)).toEqual({
    date: "2026-09-05",
    time: "14-30-12",
    timestamp: "2026-09-05_14-30-12",
    host: "localhost-3000",
    route: "account-settings",
    query: "q-4a2ceb34703b",
  });
  expect(outputTemplateValues("https://example.com/", new Date(2026, 8, 5))).toMatchObject({ host: "example.com", route: "home", query: "" });
  expect(outputTemplateValues("file:///tmp/example.html", new Date(2026, 8, 5))).toMatchObject({ host: "file", route: "tmp-example.html", query: "" });
});

test("output templates expand known placeholders and escaped braces", () => {
  const values = outputTemplateValues("https://example.com/pricing", now);
  expect(expandOutputTemplate("shots/{host}/{route}_{timestamp}.png", values)).toBe("shots/example.com/pricing_2026-09-05_14-30-12.png");
  expect(expandOutputTemplate("shots/{{draft}}/{date}.png", values)).toBe("shots/{draft}/2026-09-05.png");
  expect(() => expandOutputTemplate("shots/{timstamp}.png", values)).toThrow('unknown output placeholder: {timstamp}');
  expect(expandOutputTemplate("shots/draft{.png", values)).toBe("shots/draft{.png");
  expect(expandOutputTemplate("shots/release}.png", values)).toBe("shots/release}.png");
});

test("hash routers use the logical route while ordinary anchors use the outer path", () => {
  expect(outputTemplateValues("https://example.com/app#/workspaces/8/clients", now).route).toBe("workspaces-8-clients");
  expect(outputTemplateValues("https://example.com/app#pricing", now).route).toBe("app");
  expect(outputTemplateValues("https://example.com/app#%2Fencoded", now).route).toBe("app");
  expect(outputTemplateValues("https://example.com/app#/", now).route).toBe("home");
});

test("query identity includes outer and hash query structure but no plaintext values", () => {
  const url = "https://user:pass@example.com/app?org=8#/clients?filter=late&token=secret";
  const values = outputTemplateValues(url, now);
  expect(values.route).toBe("clients");
  expect(values.query).toMatch(/^filter-org-token-[0-9a-f]{12}$/);
  expect(values.query).not.toContain("secret");
  expect(values.query).not.toContain("late");
  expect(values.query).not.toContain("pass");
});

test("query identity is stable for key order and sensitive to source and duplicate value order", () => {
  const a = outputTemplateValues("https://example.com/app?b=2&a=1#/clients?c=3", now).query;
  const b = outputTemplateValues("https://example.com/app?a=1&b=2#/clients?c=3", now).query;
  expect(a).toBe(b);
  expect(outputTemplateValues("https://example.com/app?a=1&a=2", now).query).not.toBe(outputTemplateValues("https://example.com/app?a=2&a=1", now).query);
  expect(outputTemplateValues("https://example.com/app?a=1#/clients", now).query).not.toBe(outputTemplateValues("https://example.com/app#/clients?a=1", now).query);
});

test("default output adds a conditional query suffix and templates expose query", () => {
  const base = { capturesDirectory: "/repo/.browsershot/captures", now };
  const queried = resolveOutputPath({ ...base, url: "https://example.com/app#/clients?filter=late" });
  expect(queried).toMatch(/\/clients_q-filter-[0-9a-f]{12}_2026-09-05_14-30-12\.png$/);
  expect(resolveOutputPath({ ...base, url: "https://example.com/app#/clients" })).toBe("/repo/.browsershot/captures/example.com/clients_2026-09-05_14-30-12.png");
  const values = outputTemplateValues("https://example.com/app?q=secret", now);
  expect(expandOutputTemplate("{route}-{query}.png", values)).toMatch(/^app-q-[0-9a-f]{12}\.png$/);
});

test("default output paths support ergonomic groups and labels", () => {
  expect(resolveOutputPath({ capturesDirectory: "/repo/.browsershot/captures", url: "https://example.com/account/settings", now })).toBe("/repo/.browsershot/captures/example.com/account-settings_2026-09-05_14-30-12.png");
  expect(resolveOutputPath({ capturesDirectory: "/repo/.browsershot/captures", url: "https://example.com/account/settings", group: "regression/{date}", label: "menu open-{time}", now })).toBe("/repo/.browsershot/captures/regression/2026-09-05/example.com/account-settings_menu-open-14-30-12_2026-09-05_14-30-12.png");
});

test("groups and labels reject ambiguous or unsafe paths", () => {
  const base = { capturesDirectory: "/repo/.browsershot/captures", url: "https://example.com/pricing", now: new Date(2026, 8, 5) };
  expect(() => resolveOutputPath({ ...base, group: "../elsewhere" })).toThrow("group must stay inside");
  expect(() => resolveOutputPath({ ...base, group: "/absolute" })).toThrow("group must be a relative path");
  expect(() => resolveOutputPath({ ...base, label: "menu/open" })).toThrow("label must not contain path separators");
  expect(() => resolveOutputPath({ ...base, group: "..." })).toThrow("filename-safe text");
  expect(() => resolveOutputPath({ ...base, label: " " })).toThrow("filename-safe text");
});

test("structured names stay within common filesystem byte limits", () => {
  const output = resolveOutputPath({ capturesDirectory: "/repo/.browsershot/captures", url: `https://example.com/${"界".repeat(200)}`, group: "組".repeat(200), label: "状".repeat(200), now });
  const components = output.split("/");
  expect(components.every((component) => Buffer.byteLength(component, "utf8") <= 255)).toBe(true);
  expect(Buffer.byteLength(components.at(-1)!)).toBeLessThanOrEqual(255);
});

test("queried structured names retain the query digest within filename byte limits", () => {
  const queryKey = "filter".repeat(40);
  const output = resolveOutputPath({
    capturesDirectory: "/repo/.browsershot/captures",
    url: `https://example.com/${"界".repeat(200)}?${queryKey}=late`,
    label: "状".repeat(200),
    now,
  });
  const filename = output.split("/").at(-1)!;
  expect(Buffer.byteLength(filename, "utf8")).toBeLessThanOrEqual(255);
  expect(filename).toMatch(/_q-[^_]+-[0-9a-f]{12}_状+_2026-09-05_14-30-12\.png$/);
});

test("structured names avoid Windows reserved path components", () => {
  const output = resolveOutputPath({ capturesDirectory: "/repo/.browsershot/captures", url: "https://example.com/con", group: "NUL", label: "LPT1", now });
  expect(output).toContain("/_NUL/");
  expect(output).toContain("/_con__LPT1_");
});
