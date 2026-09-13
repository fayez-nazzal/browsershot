import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUILTIN_PLUGIN_DESCRIPTIONS,
  expandPluginAddress,
  mapCatalogEntries,
  parsePluginDescription,
  readPluginDescription,
  resolvePluginAuthHeader,
  type CatalogEntry,
  type PluginDescription,
} from "../src/plugin-description.ts";
import { ExitError, EXIT_ENVIRONMENT, UsageError } from "../src/exit-codes.ts";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-plugin-description-test-"));
}

test("mapCatalogEntries parses Storybook catalogs and excludes docs entries", () => {
  const fixturePath = join(import.meta.dir, "fixtures", "libraries", "index.json");
  const document = JSON.parse(readFileSync(fixturePath, "utf8"));
  const entries = mapCatalogEntries(document, BUILTIN_PLUGIN_DESCRIPTIONS.storybook);

  expect(entries).toEqual([
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
  ]);
});

test("mapCatalogEntries handles Ladle keyed maps with array index paths", () => {
  const document = {
    stories: {
      "control--first": {
        name: "First",
        levels: ["Control"],
      },
    },
  };
  const description: PluginDescription = {
    version: 1,
    name: "ladle-custom",
    discover: {
      http: { path: "/meta.json" },
      entries: "stories",
      id: "$key",
      group: "levels.0",
      label: "name",
    },
    address: "/?story={id}",
  };

  const entries = mapCatalogEntries(document, description);
  expect(entries).toEqual([
    {
      id: "control--first",
      group: "Control",
      label: "First",
    },
  ]);
});

test("mapCatalogEntries navigates nested dotted paths numeric segments and nested filters", () => {
  const document = {
    catalog: {
      items: [
        {
          meta: { code: "btn-1", variant: { state: "published" } },
          hierarchy: [
            { category: "Atoms" },
          ],
          display: { text: "Click Me" },
        },
        {
          meta: { code: "btn-2", variant: { state: "draft" } },
          hierarchy: [
            { category: "Atoms" },
          ],
          display: { text: "Draft Button" },
        },
      ],
    },
  };
  const description: PluginDescription = {
    version: 1,
    name: "nested-catalog",
    discover: {
      http: { path: "/catalog.json" },
      entries: "catalog.items",
      filter: { "meta.variant.state": "published" },
      id: "meta.code",
      group: "hierarchy.0.category",
      label: "display.text",
    },
    address: "/view/{id}",
  };

  const entries = mapCatalogEntries(document, description);
  expect(entries).toEqual([
    {
      id: "btn-1",
      group: "Atoms",
      label: "Click Me",
    },
  ]);
});

test("expandPluginAddress expands id, base, literal braces, and rejects unknown placeholders", () => {
  const entry: CatalogEntry = {
    id: "components-button--primary",
    group: "Components/Button",
    label: "Primary",
  };
  const description: PluginDescription = {
    version: 1,
    name: "storybook",
    discover: {
      http: { path: "/index.json" },
      entries: "entries",
      id: "id",
    },
    address: "/iframe.html?id={id}&viewMode=story",
  };

  const joined = expandPluginAddress(description, entry, "https://storybook.example.test");
  expect(joined).toBe("https://storybook.example.test/iframe.html?id=components-button--primary&viewMode=story");

  const subpathBase = expandPluginAddress(description, entry, "https://storybook.example.test/preview/");
  expect(subpathBase).toBe("https://storybook.example.test/preview/iframe.html?id=components-button--primary&viewMode=story");

  const explicitBaseDescription: PluginDescription = {
    ...description,
    address: "{base}/render?story={id}",
  };
  const withExplicitBase = expandPluginAddress(
    explicitBaseDescription,
    entry,
    "https://storybook.example.test/app/",
  );
  expect(withExplicitBase).toBe("https://storybook.example.test/app/render?story=components-button--primary");

  const literalBraceDescription: PluginDescription = {
    ...description,
    address: "/iframe.html?id={id}&format={{raw}}",
  };
  const withLiteralBraces = expandPluginAddress(
    literalBraceDescription,
    entry,
    "https://storybook.example.test",
  );
  expect(withLiteralBraces).toBe("https://storybook.example.test/iframe.html?id=components-button--primary&format={raw}");

  const unknownPlaceholderDescription: PluginDescription = {
    ...description,
    address: "/iframe.html?target={unknownField}",
  };
  expect(() => expandPluginAddress(unknownPlaceholderDescription, entry, "https://storybook.example.test")).toThrow(
    /unknown address placeholder: \{unknownField\}/,
  );
});
test("expandPluginAddress URL-encodes catalog placeholders while preserving the raw base", () => {
  const description: PluginDescription = {
    version: 1,
    name: "encoded-plugin",
    discover: {
      http: { path: "/catalog.json" },
      entries: "entries",
      id: "id",
    },
    address: "{base}/iframe.html?id={id}&group={group}&label={label}",
  };

  expect(
    expandPluginAddress(
      description,
      { id: "button&primary?#", group: "Components/Button", label: "Primary & default" },
      "https://storybook.example.test/app/",
    ),
  ).toBe(
    "https://storybook.example.test/app/iframe.html?id=button%26primary%3F%23&group=Components%2FButton&label=Primary%20%26%20default",
  );
});

test("parsePluginDescription rejects invalid version, discover, http, auth, and name definitions", () => {
  const valid = {
    version: 1,
    name: "valid-plugin",
    discover: {
      http: { path: "/index.json" },
      entries: "entries",
      id: "id",
    },
    address: "/iframe.html?id={id}",
  };

  expect(() => parsePluginDescription({ ...valid, version: 2 }, "test")).toThrow(UsageError);
  expect(() => parsePluginDescription({ ...valid, version: 2 }, "test")).toThrow("version must be 1");

  const missingDiscover = { version: 1, name: "valid-plugin", address: "/iframe.html?id={id}" };
  expect(() => parsePluginDescription(missingDiscover, "test")).toThrow(UsageError);
  expect(() => parsePluginDescription(missingDiscover, "test")).toThrow("discover must be an object");

  const conflictingHttp = {
    ...valid,
    discover: {
      http: { path: "/index.json", url: "https://hosted.example.test/catalog.json" },
      entries: "entries",
      id: "id",
    },
  };
  expect(() => parsePluginDescription(conflictingHttp, "test")).toThrow(UsageError);
  expect(() => parsePluginDescription(conflictingHttp, "test")).toThrow(
    "discover.http must define exactly one of path or url",
  );

  const invalidAuth = {
    ...valid,
    auth: { header: "Authorization", valueFrom: "token:SECRET" },
  };
  expect(() => parsePluginDescription(invalidAuth, "test")).toThrow(UsageError);
  expect(() => parsePluginDescription(invalidAuth, "test")).toThrow(
    /auth valueFrom must look like env:NAME/,
  );

  const invalidName = {
    ...valid,
    name: "Invalid_Name!",
  };
  expect(() => parsePluginDescription(invalidName, "test")).toThrow(UsageError);
  expect(() => parsePluginDescription(invalidName, "test")).toThrow(
    /name must match/,
  );
});

test("readPluginDescription resolves builtins, allows workspace overrides, and reports known plugins on miss", () => {
  const emptyRoot = scratch();
  const storybook = readPluginDescription(emptyRoot, "storybook");
  expect(storybook.name).toBe("storybook");
  expect(storybook.ready).toBe("#storybook-root");

  const customRoot = scratch();
  const pluginsDirectory = join(customRoot, ".browsershot", "plugins");
  mkdirSync(pluginsDirectory, { recursive: true });
  const overridden = {
    version: 1,
    name: "storybook",
    discover: {
      http: { path: "/custom-index.json" },
      entries: "stories",
      id: "id",
    },
    address: "/custom-iframe.html?id={id}",
    ready: "#custom-root",
  };
  writeFileSync(join(pluginsDirectory, "storybook.json"), JSON.stringify(overridden));

  const loadedOverride = readPluginDescription(customRoot, "storybook");
  expect(loadedOverride.ready).toBe("#custom-root");
  expect(loadedOverride.address).toBe("/custom-iframe.html?id={id}");

  expect(() => readPluginDescription(emptyRoot, "missing-plugin")).toThrow(UsageError);
  expect(() => readPluginDescription(emptyRoot, "missing-plugin")).toThrow(
    'unknown plugin "missing-plugin"; known plugins: ladle, storybook',
  );
});

test("resolvePluginAuthHeader returns configured values and fails with code 3 when unset", () => {
  const envVar = "BROWSERSHOT_TEST_AUTH_TOKEN_ACTIVE";
  process.env[envVar] = "bearer-token-value";

  try {
    const header = resolvePluginAuthHeader({ header: "Authorization", valueFrom: `env:${envVar}` });
    expect(header).toEqual({ header: "Authorization", value: "bearer-token-value" });
  } finally {
    delete process.env[envVar];
  }

  const missingVar = "BROWSERSHOT_TEST_AUTH_TOKEN_MISSING";
  delete process.env[missingVar];

  let caught: unknown;
  try {
    resolvePluginAuthHeader({ header: "Authorization", valueFrom: `env:${missingVar}` });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ExitError);
  const exitError = caught as ExitError;
  expect(exitError.code).toBe(EXIT_ENVIRONMENT);
  expect(exitError.message).toContain(missingVar);
});
