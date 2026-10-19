import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeStorageState, openStatePath, readOpenState, writeOpenState } from "../src/open-state.ts";

const root = mkdtempSync(join(tmpdir(), "browsershot-open-state-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const cookie = (name: string, value: string, domain = "app.test", path = "/") => ({ name, value, domain, path });

describe("open-window state", () => {
  test("overlay values win, snapshot-only values survive", () => {
    const merged = mergeStorageState(
      {
        cookies: [cookie("session", "stale"), cookie("pref", "wide")],
        origins: [{ origin: "https://app.test", localStorage: [{ name: "theme", value: "dark" }, { name: "token", value: "stale" }] }],
      },
      {
        cookies: [cookie("session", "fresh")],
        origins: [{ origin: "https://app.test", localStorage: [{ name: "token", value: "fresh" }] }],
      },
    );
    expect(merged.cookies).toEqual([cookie("session", "fresh"), cookie("pref", "wide")]);
    expect(merged.origins).toEqual([
      { origin: "https://app.test", localStorage: [{ name: "theme", value: "dark" }, { name: "token", value: "fresh" }] },
    ]);
  });

  test("the same cookie name on another domain or path stays distinct", () => {
    const merged = mergeStorageState({ cookies: [cookie("a", "1", "one.test")] }, { cookies: [cookie("a", "2", "two.test"), cookie("a", "3", "one.test", "/x")] });
    expect(merged.cookies).toHaveLength(3);
  });

  test("a missing snapshot reads as null and a round trip is lossless", () => {
    const path = openStatePath(join(root, "workspace"));
    expect(readOpenState(path)).toBeNull();
    const state = { cookies: [cookie("a", "1")], origins: [] };
    writeOpenState(path, state);
    expect(readOpenState(path)).toEqual(state);
  });

  test("a corrupt snapshot is an error that names the file", () => {
    const path = join(root, "corrupt.json");
    writeFileSync(path, "{nope");
    expect(() => readOpenState(path)).toThrow(path);
  });
});
