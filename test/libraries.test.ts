import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  catalogCachePath,
  fetchLibraryCatalog,
  librariesFilePath,
  matchCatalogEntry,
  readCachedCatalog,
  readLibraries,
  removeLibrary,
  resolveLibraryTarget,
  saveLibrary,
  writeCatalogCache,
  type CatalogFetcher,
  type LibraryDefinition,
} from "../src/libraries.ts";
import type { CatalogEntry, PluginDescription } from "../src/plugin-description.ts";
import { ExitError, EXIT_ENVIRONMENT, EXIT_FAILED, UsageError } from "../src/exit-codes.ts";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-libraries-test-"));
}

function sampleCatalogDocument(): unknown {
  return {
    v: 5,
    entries: {
      "components-button--primary": {
        id: "components-button--primary",
        title: "Components/Button",
        name: "Primary",
        type: "story",
      },
      "components-button--secondary": {
        id: "components-button--secondary",
        title: "Components/Button",
        name: "Secondary",
        type: "story",
      },
    },
  };
}

test("saveLibrary and removeLibrary preserve definitions and reject invalid or duplicate names", () => {
  const root = scratch();
  const definition: LibraryDefinition = {
    baseUrl: "https://storybook.example.test",
    plugin: "storybook",
    ready: "#custom-ready",
    scope: "#custom-scope",
  };

  const saved = saveLibrary(root, "design-system", definition);
  expect(saved.libraries["design-system"]).toEqual(definition);
  expect(readLibraries(root).libraries["design-system"]).toEqual(definition);

  expect(() => saveLibrary(root, "add", definition)).toThrow(UsageError);
  expect(() => saveLibrary(root, "add", definition)).toThrow(/library name "add" is reserved/);

  expect(() => saveLibrary(root, "Invalid Name!", definition)).toThrow(UsageError);
  expect(() => saveLibrary(root, "Invalid Name!", definition)).toThrow(/invalid library name "Invalid Name!"/);

  expect(() => saveLibrary(root, "design-system", definition)).toThrow(UsageError);
  expect(() => saveLibrary(root, "design-system", definition)).toThrow(/library "design-system" already exists/);

  const afterRemoval = removeLibrary(root, "design-system");
  expect(afterRemoval.libraries["design-system"]).toBeUndefined();
  expect(readLibraries(root).libraries["design-system"]).toBeUndefined();

  expect(() => removeLibrary(root, "nonexistent")).toThrow(UsageError);
  expect(() => removeLibrary(root, "nonexistent")).toThrow(/unknown library "nonexistent"/);
});

test("saveLibrary with an unknown plugin fails before writing the libraries file", () => {
  const root = scratch();
  const definition: LibraryDefinition = {
    baseUrl: "https://storybook.example.test",
    plugin: "unknown-plugin-missing",
  };

  expect(() => saveLibrary(root, "components", definition)).toThrow(UsageError);
  expect(() => saveLibrary(root, "components", definition)).toThrow(/unknown plugin "unknown-plugin-missing"/);
  expect(existsSync(librariesFilePath(root))).toBe(false);
});

test("matchCatalogEntry prefers exact id and supports case-insensitive group and label matches", () => {
  const entries: CatalogEntry[] = [
    {
      id: "primary",
      group: "Forms",
      label: "Submit",
    },
    {
      id: "components-button--primary",
      group: "Components/Button",
      label: "Primary",
    },
    {
      id: "components-button--secondary",
      group: "Components/Button",
      label: "Secondary",
    },
  ];

  const exactMatches = matchCatalogEntry(entries, "primary");
  expect(exactMatches).toEqual([
    {
      id: "primary",
      group: "Forms",
      label: "Submit",
    },
  ]);

  const groupLabelMatches = matchCatalogEntry(entries, "components/button/secondary");
  expect(groupLabelMatches).toEqual([
    {
      id: "components-button--secondary",
      group: "Components/Button",
      label: "Secondary",
    },
  ]);

  const bareLabelMatches = matchCatalogEntry(entries, "secondary");
  expect(bareLabelMatches).toEqual([
    {
      id: "components-button--secondary",
      group: "Components/Button",
      label: "Secondary",
    },
  ]);

  const ambiguousEntries: CatalogEntry[] = [
    {
      id: "button-action",
      group: "Buttons",
      label: "Action",
    },
    {
      id: "link-action",
      group: "Links",
      label: "Action",
    },
  ];
  const multipleMatches = matchCatalogEntry(ambiguousEntries, "action");
  expect(multipleMatches).toHaveLength(2);
  expect(multipleMatches.map((entry) => entry.id).sort()).toEqual(["button-action", "link-action"]);
});

test("resolveLibraryTarget fetches once on cache miss and reuses the cache on subsequent lookups", async () => {
  const root = scratch();
  saveLibrary(root, "ui", {
    baseUrl: "https://storybook.example.test",
    plugin: "storybook",
    scope: "#custom-scope",
    ready: "#custom-ready",
  });

  const requestedUrls: string[] = [];
  const fakeFetcher: CatalogFetcher = async (url: string) => {
    requestedUrls.push(url);
    return sampleCatalogDocument();
  };

  const firstTarget = await resolveLibraryTarget({
    library: "ui",
    entry: "components-button--primary",
    root,
    fetcher: fakeFetcher,
  });

  expect(requestedUrls).toHaveLength(1);
  expect(requestedUrls[0]!.endsWith("/index.json")).toBe(true);
  expect(firstTarget.identity).toEqual({
    kind: "library",
    library: "ui",
    entry: "components-button--primary",
  });
  expect(firstTarget.url).toBe(
    "https://storybook.example.test/iframe.html?id=components-button--primary&viewMode=story",
  );
  expect(firstTarget.element).toBe("#custom-scope");
  expect(firstTarget.expectElement).toBe("#custom-ready");

  const secondTarget = await resolveLibraryTarget({
    library: "ui",
    entry: "components-button--secondary",
    root,
    fetcher: fakeFetcher,
  });

  expect(requestedUrls).toHaveLength(1);
  expect(secondTarget.identity).toEqual({
    kind: "library",
    library: "ui",
    entry: "components-button--secondary",
  });
  expect(secondTarget.element).toBe("#custom-scope");
  expect(secondTarget.expectElement).toBe("#custom-ready");
});

test("resolveLibraryTarget falls back to plugin defaults when definition selectors are omitted", async () => {
  const root = scratch();
  saveLibrary(root, "ui", {
    baseUrl: "https://storybook.example.test",
    plugin: "storybook",
  });

  const fakeFetcher: CatalogFetcher = async () => sampleCatalogDocument();
  const target = await resolveLibraryTarget({
    library: "ui",
    entry: "components-button--primary",
    root,
    fetcher: fakeFetcher,
  });

  expect(target.element).toBeUndefined();
  expect(target.expectElement).toBe("#storybook-root");
});

test("resolveLibraryTarget refreshes once and raises UsageError for unknown entries", async () => {
  const root = scratch();
  saveLibrary(root, "ui", {
    baseUrl: "https://storybook.example.test",
    plugin: "storybook",
  });

  const requestedUrls: string[] = [];
  const fakeFetcher: CatalogFetcher = async (url: string) => {
    requestedUrls.push(url);
    return sampleCatalogDocument();
  };

  let caught: unknown;
  try {
    await resolveLibraryTarget({
      library: "ui",
      entry: "missing-entry",
      root,
      fetcher: fakeFetcher,
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(UsageError);
  const usageError = caught as UsageError;
  expect(usageError.message).toMatch(/unknown entry "missing-entry" in library "ui"/);
  expect(requestedUrls).toHaveLength(1);
});

test("resolveLibraryTarget raises UsageError listing candidates when the entry name is ambiguous", async () => {
  const root = scratch();
  saveLibrary(root, "ui", {
    baseUrl: "https://storybook.example.test",
    plugin: "storybook",
  });

  const ambiguousDocument = {
    v: 5,
    entries: {
      "button--action": {
        id: "button--action",
        title: "Buttons",
        name: "Action",
        type: "story",
      },
      "link--action": {
        id: "link--action",
        title: "Links",
        name: "Action",
        type: "story",
      },
    },
  };

  const fakeFetcher: CatalogFetcher = async () => ambiguousDocument;

  let caught: unknown;
  try {
    await resolveLibraryTarget({
      library: "ui",
      entry: "action",
      root,
      fetcher: fakeFetcher,
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(UsageError);
  const usageError = caught as UsageError;
  expect(usageError.message).toMatch(/ambiguous entry "action"; candidates: button--action, link--action/);
});

test("resolveLibraryTarget wraps generic fetcher errors in ExitError with code 1", async () => {
  const root = scratch();
  saveLibrary(root, "ui", {
    baseUrl: "https://storybook.example.test",
    plugin: "storybook",
  });

  const failingFetcher: CatalogFetcher = async () => {
    throw new Error("connection reset by peer");
  };

  let caught: unknown;
  try {
    await resolveLibraryTarget({
      library: "ui",
      entry: "components-button--primary",
      root,
      fetcher: failingFetcher,
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ExitError);
  const exitError = caught as ExitError;
  expect(exitError.code).toBe(EXIT_FAILED);
  expect(exitError.message).toMatch(/library "ui" catalog unreachable at https:\/\/storybook\.example\.test\/index\.json/);
});

test("resolveLibraryTarget propagates ExitError with code 3 untouched", async () => {
  const root = scratch();
  saveLibrary(root, "ui", {
    baseUrl: "https://storybook.example.test",
    plugin: "storybook",
  });

  const credentialsFetcher: CatalogFetcher = async () => {
    throw new ExitError("unauthorized access", EXIT_ENVIRONMENT);
  };

  let caught: unknown;
  try {
    await resolveLibraryTarget({
      library: "ui",
      entry: "components-button--primary",
      root,
      fetcher: credentialsFetcher,
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ExitError);
  const exitError = caught as ExitError;
  expect(exitError.code).toBe(EXIT_ENVIRONMENT);
  expect(exitError.message).toBe("unauthorized access");
});

test("resolveLibraryTarget fails with code 3 naming the unset variable before any fetch", async () => {
  const root = scratch();
  const pluginsDir = join(root, ".browsershot", "plugins");
  mkdirSync(pluginsDir, { recursive: true });

  const unsetVar = "BROWSERSHOT_TEST_CATALOG_SECRET_TOKEN";
  delete process.env[unsetVar];

  const authenticatedPlugin: PluginDescription = {
    version: 1,
    name: "authenticated-plugin",
    discover: {
      http: { path: "/catalog.json" },
      entries: "entries",
      id: "id",
    },
    address: "/iframe.html?id={id}",
    auth: {
      header: "Authorization",
      valueFrom: `env:${unsetVar}`,
    },
  };
  writeFileSync(join(pluginsDir, "authenticated-plugin.json"), JSON.stringify(authenticatedPlugin));

  saveLibrary(root, "secure-ui", {
    baseUrl: "https://secure.example.test",
    plugin: "authenticated-plugin",
  });

  const requestedUrls: string[] = [];
  const fakeFetcher: CatalogFetcher = async (url: string) => {
    requestedUrls.push(url);
    return sampleCatalogDocument();
  };

  let caught: unknown;
  try {
    await resolveLibraryTarget({
      library: "secure-ui",
      entry: "any-entry",
      root,
      fetcher: fakeFetcher,
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ExitError);
  const exitError = caught as ExitError;
  expect(exitError.code).toBe(EXIT_ENVIRONMENT);
  expect(exitError.message).toContain(unsetVar);
  expect(requestedUrls).toHaveLength(0);
});
test("authenticated catalogs cannot send credentials to a different origin", async () => {
  const root = scratch();
  const pluginsDir = join(root, ".browsershot", "plugins");
  mkdirSync(pluginsDir, { recursive: true });
  const secretVar = "BROWSERSHOT_TEST_CATALOG_SECRET_ORIGIN";
  process.env[secretVar] = "secret";
  const authenticatedPlugin: PluginDescription = {
    version: 1,
    name: "cross-origin-plugin",
    discover: {
      http: { url: "https://collector.example.test/catalog.json" },
      entries: "entries",
      id: "id",
    },
    address: "/iframe.html?id={id}",
    auth: { header: "Authorization", valueFrom: `env:${secretVar}` },
  };
  writeFileSync(join(pluginsDir, "cross-origin-plugin.json"), JSON.stringify(authenticatedPlugin));
  saveLibrary(root, "secure-ui", {
    baseUrl: "https://storybook.example.test",
    plugin: "cross-origin-plugin",
  });

  const requestedUrls: string[] = [];
  const fakeFetcher: CatalogFetcher = async (url: string) => {
    requestedUrls.push(url);
    return sampleCatalogDocument();
  };

  await expect(
    fetchLibraryCatalog({ root, name: "secure-ui", fetcher: fakeFetcher }),
  ).rejects.toThrow("authenticated library catalog URL must share the registered library origin");
  expect(requestedUrls).toHaveLength(0);
  delete process.env[secretVar];
});

test("malformed libraries file and malformed plugin file throw UsageError before any fetch", async () => {
  const malformedLibrariesRoot = scratch();
  mkdirSync(join(malformedLibrariesRoot, ".browsershot"), { recursive: true });
  writeFileSync(librariesFilePath(malformedLibrariesRoot), "{not-valid-json");

  const requestedUrls: string[] = [];
  const fakeFetcher: CatalogFetcher = async (url: string) => {
    requestedUrls.push(url);
    return sampleCatalogDocument();
  };

  let librariesError: unknown;
  try {
    await resolveLibraryTarget({
      library: "ui",
      entry: "button",
      root: malformedLibrariesRoot,
      fetcher: fakeFetcher,
    });
  } catch (error) {
    librariesError = error;
  }

  expect(librariesError).toBeInstanceOf(UsageError);
  expect((librariesError as UsageError).message).toMatch(/malformed libraries file:/);
  expect(requestedUrls).toHaveLength(0);

  const malformedPluginRoot = scratch();
  const pluginDir = join(malformedPluginRoot, ".browsershot", "plugins");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "broken-plugin.json"), "{broken-plugin-json");

  saveLibrary(malformedPluginRoot, "ui", {
    baseUrl: "https://ui.example.test",
    plugin: "storybook",
  });

  const librariesFile = readLibraries(malformedPluginRoot);
  librariesFile.libraries["ui"]!.plugin = "broken-plugin";
  writeFileSync(librariesFilePath(malformedPluginRoot), JSON.stringify(librariesFile));

  let pluginError: unknown;
  try {
    await resolveLibraryTarget({
      library: "ui",
      entry: "button",
      root: malformedPluginRoot,
      fetcher: fakeFetcher,
    });
  } catch (error) {
    pluginError = error;
  }

  expect(pluginError).toBeInstanceOf(UsageError);
  expect((pluginError as UsageError).message).toMatch(/malformed plugin file:/);
  expect(requestedUrls).toHaveLength(0);
});

test("writeCatalogCache and readCachedCatalog round trip and malformed cache reads as null", () => {
  const root = scratch();
  const entries: CatalogEntry[] = [
    {
      id: "components-button--primary",
      group: "Components/Button",
      label: "Primary",
    },
  ];

  expect(readCachedCatalog(root, "ui")).toBeNull();

  writeCatalogCache(root, "ui", entries);
  expect(readCachedCatalog(root, "ui")).toEqual(entries);

  const cacheFile = catalogCachePath(root, "ui");
  expect(existsSync(cacheFile)).toBe(true);

  writeFileSync(cacheFile, "{not-valid-json");
  expect(readCachedCatalog(root, "ui")).toBeNull();

  writeFileSync(cacheFile, JSON.stringify({ fetchedAt: "now", entries: [{ missingId: true }] }));
  expect(readCachedCatalog(root, "ui")).toBeNull();
});
