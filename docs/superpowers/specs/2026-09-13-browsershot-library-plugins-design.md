# Browsershot Library Plugins Design

Date: 2026-09-13
Status: Approved design. Plan B of two parallel plans.
Depends on: `2026-09-13-browsershot-capture-target-contract.md`

## Goal

Capture one example from a component environment by name, using that
environment's own catalog as the source of truth. Browsershot stays agnostic:
it knows how to read a declarative description of a system, not the system
itself. Storybook is one description among several, with no privileged path.

## Constraints

- The core contains no knowledge of any specific component system. Anything a
  bundled description can do, a user-written description can do.
- A plugin is data, not code. Nothing from a plugin is executed, spawned, or
  imported.
- The environment must already be running or reachable. Browsershot never
  starts, supervises, or stops a server.
- Credentials are referenced, never stored, matching the repository's existing
  separation of credentials from configuration.
- Produce a `CaptureTarget` and nothing else.
- One capture per run.

## Current State

Nothing in the repository models a component environment. Capture accepts a URL
and an optional CSS selector (`src/capture.ts:206`), and readiness is expressed
as an optional selector wait plus a blank-render guard (`src/capture.ts:146`).
The workspace already holds project-local state and ignores itself
(`src/workspace.ts:7`).

## Concepts

- **Plugin.** A description of a system: how to discover entries, how to map
  them, how to address one, and how to know it has rendered.
- **Library.** One instance of such a system in this project: a name, a base
  address, a plugin, and optional overrides.
- **Entry.** One capturable example: an `id`, an optional `group`, and a `name`.

## Evidence for the Format

Verified 2026-09-13, and the reason each field exists:

| System | Discovery | Notes |
|---|---|---|
| Storybook | `GET /index.json` → `{v, entries:{id,title,name,type,tags}}` | `iframe.html?id=…&viewMode=story` isolates one story |
| Ladle | `GET /meta.json` → `{about, stories:{"control--first":{name, levels[], filePath}}}` | Documents a ready signal, `data-storyloaded` on `<html>` |
| Histoire | No catalog endpoint found; stories are `*.story.vue` with `<Story>` and `<Variant>` | Single layout isolates in an iframe; grid layout renders all variants together |

Two discovery strategies are therefore required, not one. A URL template alone
is insufficient, because an address can render more than the wanted example, as
Histoire's grid layout does, which is why scoping exists.

## Plugin Description

Plugins live at `.browsershot/plugins/<name>.json`. Descriptions shipped with
Browsershot use the identical format and are overridden by a workspace file of
the same name.

```json
{
  "version": 1,
  "name": "storybook",
  "discover": {
    "http": { "path": "/index.json" },
    "entries": "entries",
    "filter": { "type": "story" },
    "id": "id",
    "group": "title",
    "label": "name"
  },
  "address": "/iframe.html?id={id}&viewMode=story",
  "ready": "#storybook-root"
}
```

Field rules:

- `discover.http.path` is joined to the library's base address;
  `discover.http.url` states a complete address instead, for hosted systems.
- `discover.files.glob` selects files relative to a declared root, for systems
  with no catalog endpoint.
- `entries` is a dotted path to an array or an object map. Within an entry,
  `id`, `group`, and `label` are dotted paths, and `$key` means the map key.
- `filter` is equality on one or more fields. There is no query language.
- `address` is a template over `{base}`, `{id}`, `{group}`, `{label}`. An unknown
  placeholder is an error, matching output-template behavior
  (`src/output-path.ts:142`).
- `ready` is a CSS selector. Ladle's documented signal is expressible as
  `html[data-storyloaded]`, so no attribute-specific vocabulary is needed.
- `scope` is an optional CSS selector for systems whose address renders more
  than the example, such as a page that shows several variants at once.
- `auth` names an environment variable and a header:
  `{ "header": "Authorization", "valueFrom": "env:CATALOG_TOKEN" }`. Only
  `env:` references are accepted. A missing variable fails with exit 3 naming
  the variable.

The vocabulary is deliberately small. If a system cannot be expressed in it,
the documented fallback is a saved page pointing at the example's URL, which
works today.

## CLI Surface

```text
browsershot library <lib> <entry> [capture options]
browsershot library add <lib> <base-url> --plugin <plugin> [--ready <selector>] [--scope <selector>]
browsershot library list [<lib>]
browsershot library show <lib>
browsershot library refresh <lib>
browsershot library remove <lib>
```

`library list <lib>` prints known entries, fetching the catalog first if none is
cached. `add`, `list`, `show`, `refresh`, and `remove` are reserved names.
Library definitions live in `.browsershot/libraries.json`, written atomically
like the profile.

## Entry Resolution

1. Exact `id` match.
2. Otherwise, a case-insensitive match on `group/label` or on `label` alone.
3. Several matches produce a usage error listing the candidates. A first match
   is never chosen silently.

On a miss, refresh the catalog once and retry before failing. This makes an
example added moments ago resolvable without intervention.

The resolved entry becomes a `CaptureTarget` with the addressed URL, the plugin
or library `scope` as `element`, and `ready` as `expectElement`, stamped with
`identity` of `{ kind: "library", library, entry }`.

## Caching

Catalogs cache at `.browsershot/cache/<library>.json` as
`{ "fetchedAt": "…", "entries": [ … ] }`. There is no expiry: refresh happens on
a miss or on `library refresh`. A stale hit pointing at a removed example is
caught by the readiness selector, which fails rather than capturing an
environment error page.

## Failure Behavior

| Trigger | Result |
|---|---|
| Unknown library | Usage error listing known libraries |
| Unknown entry after one refresh | Usage error naming the library |
| Ambiguous entry name | Usage error listing candidates |
| Malformed plugin or library file | Usage error naming the file |
| Base address unreachable | Exit 1, naming the library and the address tried |
| Catalog rejects credentials, or the variable is unset | Exit 3, naming the environment variable |
| Readiness selector never appears | Existing readiness failure, exit 1, nothing written |

## Validation Plan

The universality test is one description per system, exercised in this order:

1. **Storybook** and **Ladle** — HTTP discovery, against checked-in catalog
   fixtures for unit tests and one manual run against a live instance.
2. **Histoire** — file discovery. Its variant addressing is **unverified**; the
   plan must confirm the URL form and variant identifiers against a running
   instance before the description is shipped.

If any system cannot be expressed without widening the vocabulary, widen it once
and re-check the other two. Growth of the vocabulary is a design decision, not
an implementation detail.

## Verification

Without a browser:

- Mapping, filtering, `$key` handling, dotted paths, and template expansion
  against Storybook and Ladle catalog fixtures.
- Resolution order, ambiguity errors, and refresh-on-miss using a fake fetcher
  that records calls.
- Credential reference handling, including the unset-variable message.
- Malformed plugin and library files produce usage errors before any fetch.

With a browser, one end-to-end case using a `file://` base address, a fixture
catalog file, and a fixture entry page, asserting the captured PNG and that
`captured` names the library and entry.

## Non-Goals

- No starting, supervising, or stopping of environments.
- No executable or JavaScript plugins.
- No capturing a component's full set of examples in one run.
- No linkage between a library entry and an application page.
- No plugin registry, distribution mechanism, or versioned plugin API beyond the
  `version` field in the description.
