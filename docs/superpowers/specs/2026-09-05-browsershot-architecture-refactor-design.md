# Browsershot Architecture Refactor Design

Date: 2026-09-05
Status: Approved design

## Goal

Refactor Browsershot's CLI orchestration into small, clearly owned units while
preserving one shared capture pipeline for quick routes and complete URLs. The
refactor will centralize run-option resolution and profile-setting definitions,
make configuration failures predictable, improve hash-route output names without
exposing raw query values, and make the behavioral contracts explicit in tests.

## Constraints

- Preserve all documented flags, saved settings, aliases, exit codes, stdout and
  stderr behavior, and the six-field JSON success result.
- Keep quick capture as URL-resolution convenience only. After URL resolution,
  quick routes and complete URLs must use identical option and capture paths.
- Treat any existing malformed, unreadable, or invalid project configuration as
  a usage error for both quick routes and complete URLs.
- Preserve current-directory configuration discovery and legacy `url` support.
- Preserve the recently added output templates, `--group`, and `--label`,
  including their precedence and conflict behavior.
- Do not add a runtime dependency, generic command framework, service container,
  plugin system, or class hierarchy.
- Keep Playwright behavior, authstate, publishing, inspection, annotations, and
  workspace mechanics in their existing domain modules unless orchestration
  extraction requires a narrow interface change.
- Do not add capture features, retries beyond the existing one-time auth retry,
  a daemon, remote state, video, or PDF support.

## Current State

At commit `e476971`, `src/cli.ts` contains about 700 lines and owns argument
parsing, config command dispatch, URL resolution, partial default resolution,
validation, authentication preparation, capture execution, artifact writing,
publishing, reporting, and viewer opening. Some precedence rules live in
`resolveRunDefaults`, while output and publishing rules are resolved separately
inside `main`.

`src/profile.ts` repeats profile knowledge across `ProfileConfig`, an alias map,
an accepted-key set, validation key lists, and setter-specific type checks. The
latest output work introduced `src/output-path.ts` and made invalid saved naming
fail for complete URLs as well as quick routes. That strict behavior and the new
`output`, `group`, and `label` contracts are established inputs to this design.

The baseline suite passes 183 tests across 22 files. Existing untracked files,
including the earlier quick-capture plan, are unrelated workspace state and must
not be overwritten or staged as part of this refactor.

## Considered Approaches

### 1. Focused functional core with a thin CLI shell

Extract one pure run-options resolver, one imperative capture runner, and one
profile-setting registry. Leave existing domain modules in place. This creates
clear boundaries around the actual sources of complexity without introducing a
new framework.

This is the selected approach because it fully addresses the duplicated and
scattered decisions with the smallest architectural change.

### 2. Phase-based orchestration modules

Create separate modules for parsing, authentication, browser execution,
artifact writing, inspection, publishing, and reporting. This would produce
smaller files, but it would add interfaces around behavior already well-owned by
`capture.ts`, `authstate.ts`, and `publish.ts`. It risks distributing rather
than reducing orchestration complexity.

### 3. Declarative command and schema framework

Define every CLI flag and profile setting in a generic registry that generates
parser options, help, validation, and precedence behavior. This maximizes
centralization, but special rules such as expectation-set replacement, bare
`--publish`, and output/group/label precedence become less direct. The framework
would be unnecessary abstraction for one capture command.

## Architecture and Ownership

### `src/cli.ts`

The executable shell owns only:

- parsing argv;
- dispatching help, version, config, or capture commands;
- providing process-bound inputs and output streams; and
- mapping typed failures to diagnostics and process exit codes.

It does not resolve saved defaults, prepare authentication, execute capture
phases, or write artifacts.

### `src/run-options.ts`

This module owns capture-input normalization. Its pure resolver consumes parsed
CLI values, one validated `ProfileConfig`, the positional input, workspace
paths, and an optional clock value. It returns one immutable
`ResolvedRunOptions` containing:

- the final URL and output path;
- the complete `CaptureOptions` input;
- authentication intent and credential inputs;
- annotations and inspection-sidecar choice;
- publication activation, destination, size, and label;
- JSON and auto-open decisions; and
- any execution metadata required by the runner.

Downstream code never reads raw CLI values or profile configuration again.
Kebab-case CLI names do not escape this boundary. Nested domain fields such as
`auth`, `expectations`, `output`, and `publish` keep related choices clear.

Special precedence and conflict rules remain explicit TypeScript rather than a
generic merge engine.

### `src/run-capture.ts`

This module owns the imperative pipeline after successful normalization. It
prepares authstate, invokes the existing capture and auth-retry behavior, draws
annotations, writes artifacts, publishes, reports the result, opens the viewer,
and cleans up run-scoped temporary state.

It accepts only `ResolvedRunOptions` plus a small optional dependency object for
focused tests. The dependency object may replace capture, auth resolution,
publication, and file opening; it is not a general service container. The
module never distinguishes a quick route from a complete URL and never calls
`process.exit`.

### `src/profile-settings.ts`

This module owns the persistent setting registry. Each descriptor provides:

- its canonical property name;
- accepted config-command aliases;
- its value kind, either non-empty string or presence-enabled boolean; and
- an optional setting-specific validator.

The canonical settings are:

```text
baseUrl, authUser, authRedirect, expectElement, expectText,
output, group, label, json, autoOpen, publish
```

The registry drives raw-property recognition, config-command name resolution,
boolean-versus-string handling, individual validation, canonical serialization,
and config display. Cross-setting validation stays separate because it
describes relationships rather than one setting.

### Existing modules

- `src/profile.ts` retains file reading, legacy normalization, atomic
  persistence, profile paths, and quick-route composition.
- `src/exit-codes.ts` retains exit-code ownership and gains a small
  `UsageError` carrying exit code 2 for validation failures raised outside the
  process shell.
- `src/output-path.ts` retains template expansion, filename safety, and output
  path construction, and gains URL identity derivation.
- `src/capture.ts` retains Playwright behavior and page lifecycle.
- `src/authstate.ts`, `src/publish.ts`, `src/annotate.ts`, `src/open.ts`, and
  `src/workspace.ts` retain their existing domain ownership.

Helpers currently exported from `cli.ts` move to the module that owns their
behavior. `cli.ts` may re-export established helpers during the refactor to
avoid unnecessary import breakage while tests move to the correct modules.

The dependency direction is:

```text
cli
 |-- profile + profile-settings
 |-- run-options -- output-path / action and annotation parsers
 `-- run-capture -- capture / authstate / annotate / publish / open / workspace
```

## Resolution Data Flow

Every capture command follows one linear path:

```text
argv
-> parse CLI syntax
-> read and validate project config
-> resolve positional URL or quick route
-> resolve all defaults, saved values, flags, overrides, and conflicts
-> produce one ResolvedRunOptions value
-> run the shared capture pipeline
-> emit the stable result
```

Resolution order is:

1. Built-in defaults establish viewport, delay, page mode, guards, JSON,
   auto-open, and inactive optional behaviors.
2. Saved project settings replace applicable built-in defaults.
3. Explicit CLI flags replace saved settings for that run.
4. Negative CLI flags disable their corresponding saved or positive state.
5. Conflicts are rejected before authentication, browser launch, workspace
   creation, temporary-directory creation, or artifact writes.
6. The positional value resolves the URL. A leading-slash route requires
   `baseUrl`; a complete or supported scheme-normalized URL resolves without
   using `baseUrl`. The two forms are identical after this step.

### Explicit special rules

- An explicit `--expect-text` or `--expect-element` replaces the complete saved
  expectation set. When both explicit flags are present, both apply.
- `--no-expect` conflicts with explicit expectation flags. It disables content
  assertions only, not HTTP status or blank-render guards.
- `--no-auth` conflicts with `--auth`, `--auth-user`, and
  `--auth-credentials`, and suppresses a saved `authUser`.
- `--no-auth-redirect`, `--no-json`, and `--no-auto-open` conflict with their
  explicit positive counterparts.
- Bare `--publish` activates publishing with the saved destination. An explicit
  destination wins. A saved destination alone never activates publishing.
- Explicit `--output` conflicts with explicit `--group` or `--label`.
- Explicit output ignores saved structured naming. An explicit group or label
  ignores saved output and retains the other compatible saved structured value.
- Saved `output` cannot coexist with saved `group` or `label`.

## Profile Behavior

The raw JSON object may contain canonical properties and legacy `url`.
`baseUrl` wins when both are present. Reads normalize `url` to `baseUrl` in
memory without rewriting the file. An explicit later config mutation writes
canonical names and preserves all other valid settings.

The aliases `url` and `base-url` map to `baseUrl`. Existing camelCase and
kebab-case config-command spellings remain accepted. Unknown settings, empty
string settings, incorrectly typed booleans, invalid base URLs, unsafe output
settings, and incompatible saved output settings remain usage errors.

If `.browsershot/config.json` exists but cannot be read, parsed, or validated,
every capture command exits 2 before auth or browser work. This applies equally
to a quick route and a complete URL because saved settings can affect either.
The absence of a config file remains valid for complete URLs.

## Hash Routes and Safe Query-Aware Output

`output-path.ts` uses the built-in `URL` and `URLSearchParams` implementations
to derive a safe URL identity. Raw URL text and raw parameter values never
appear in generated output components.

### Route derivation

- When the fragment payload begins with the literal `/` used by common hash
  routers, parse that payload against an inert base URL and use its pathname for
  `{route}`. Encoded leading slashes and fragments such as `#pricing` remain
  ordinary anchors rather than being guessed as routes.
- Otherwise, `{route}` uses the outer pathname and ignores the ordinary anchor.
- Outer queries, hash-route queries, userinfo, and ordinary fragments are never
  included in `{route}`.
- Existing decoding, Unicode normalization, unsafe-character replacement,
  reserved-name protection, and byte limits apply.
- An empty selected pathname or `/` produces `home`.

Examples:

```text
https://example.com/app#/workspaces/8/clients
-> {route} = workspaces-8-clients

https://example.com/app#pricing
-> {route} = app
```

### Query derivation

Outer queries and hash-route queries contribute to one query identity. The
canonical fingerprint input prefixes entries with `outer` or `hash`, sorts
parameter names within each source by Unicode code point, and preserves
duplicate values in their original order for each name. Length-prefixed fields
prevent separator ambiguity. Equivalent reordering of different parameter names
produces the same identity; value order for duplicate names remains significant.

`{query}` expands to the sorted unique sanitized parameter names from both
sources followed by the first 12 hexadecimal characters of the SHA-256 digest
of the complete canonical query representation. Parameter values never appear
in plaintext. If query entries exist but every name sanitizes to empty text,
the readable prefix falls back to `query`. With no query entries, `{query}`
expands to an empty string. Existing derived-segment byte limits apply to the
complete expansion while always retaining the 12-character fingerprint.

For example:

```text
https://example.com/app?org=8#/clients?filter=late&token=secret
-> {route} = clients
-> {query} = filter-org-token-<fingerprint>
```

The fingerprint distinguishes query-dependent captures but is not encryption.
Someone who knows the URL shape and expects low-entropy values could test
guesses. This residual risk is preferable to exposing raw values and is stated
in documentation rather than overstating secrecy.

The structured default output adds `_q-{query}` only when a query exists:

```text
.browsershot/captures/<host>/<route>_q-<query>[_<label>]_<timestamp>.png
```

Query-free captures keep the existing clean filename shape. Custom `--output`,
`group`, and `label` templates gain `{query}` without an implicit separator, so
callers control its placement. Existing placeholders and escaped-brace behavior
remain unchanged.

## Capture Execution and Failures

For capture commands, profile reading and complete option resolution happen
before `ensureWorkspace` and run temporary-directory creation. Config commands
continue to create or update the workspace when their requested operation needs
it.

After normalization, `run-capture.ts` performs:

1. workspace initialization and run-scoped temporary-directory creation;
2. authstate resolution when requested;
3. capture with the existing one-time authentication retry;
4. annotation drawing;
5. output-directory creation and PNG writing;
6. optional inspection-sidecar writing;
7. optional publishing;
8. stable human or JSON result output;
9. optional viewer opening; and
10. run-scoped cleanup through `try/finally`.

Failure categories remain:

| Exit | Meaning |
|---|---|
| 1 | Capture or page-guard failure |
| 2 | Parsing, configuration, normalization, or usage failure |
| 3 | Existing authstate or credentials environment failure |
| 4 | PNG written but inspection sidecar failed |
| 5 | PNG written but publishing failed |

Sidecar and publishing failures retain and report the PNG. Viewer failures
remain warnings and do not turn a successful capture into a failure. Pure and
domain modules throw errors; user-input validation throws `UsageError`; and only
`cli.ts` maps errors to process termination. Native argument-parser failures are
converted to the same usage category at the CLI boundary.

## Testing Strategy

Tests follow ownership rather than continuing to import orchestration helpers
from the entry point.

### Profile settings and persistence

`test/profile-settings.test.ts` covers every canonical setting, alias, value
kind, individual validator, and the registry-derived accepted-name set. A
completeness assertion prevents the profile TypeScript model and registry from
drifting.

`test/profile.test.ts` continues to cover persistence and adds raw JSON
normalization, unreadable and malformed files, unknown keys, canonical
precedence, atomic writes, and cross-setting conflicts.

### Run-option resolution

`test/run-options.test.ts` uses table-driven tests for built-in defaults, saved
values, explicit values, negative overrides, whitespace-only values, and every
conflict. Tests verify that input values are not mutated.

Equivalent quick-route and complete-URL inputs are resolved under representative
combinations from every flag family. When both forms resolve to the same URL
and use the same fixed clock, their complete normalized models must be deeply
equal. This makes parity a property of the normalization boundary rather than a
claim inferred from separate tests.

### Output identity

`test/output-path.test.ts` covers normal paths, hash routes, ordinary anchors,
encoded paths, outer queries, hash-route queries, duplicate parameters,
reordered distinct parameters, empty queries, safe normalization, absence of
plaintext values, conditional default suffixes, and `{query}` in custom
templates.

### Capture runner

`test/run-capture.test.ts` injects focused dependencies to verify phase order,
early stopping, cleanup, artifact retention, failure-category propagation, and
unchanged handoff of normalized capture options.

### CLI and browser integration

Paired subprocess tests prove that malformed config produces exit 2 for quick
routes and complete URLs with the same diagnostic category and without browser
or output work. Conflict tests similarly prove early failure before auth
discovery.

One paired local-server integration test runs equivalent quick-route and
complete-URL captures with readiness, actions, inspection, output naming, JSON,
and temporary overrides. It checks equivalent observable behavior and artifact
metadata. Existing focused Playwright tests remain; the suite does not duplicate
every resolver permutation in the browser.

Verification after each implementation task uses focused tests. Final
verification is the complete `bun test` suite followed by `bun run build`.

## Documentation

`README.md`, `AGENTS.md`, `skills/browsershot/SKILL.md`, and CLI help will:

- state that malformed project config blocks every capture form;
- publish one precise precedence and conflict model;
- describe hash-route `{route}` behavior;
- document safe `{query}` and the conditional default query suffix; and
- continue to describe quick capture as URL convenience over one pipeline.

No flag, saved setting, or feature is renamed or removed.

## Success Criteria

- `src/cli.ts` is a thin process shell with no scattered option-resolution or
  capture-execution logic.
- One immutable normalized model is the sole input to capture orchestration.
- Persistent setting names, aliases, kinds, and individual validators have one
  authoritative definition.
- Invalid existing config behaves identically for routes and complete URLs and
  fails before capture-side effects.
- Every applicable option has identical resolved behavior for equivalent route
  and complete-URL inputs.
- Hash-routed apps produce logical `{route}` values.
- Query-dependent URLs receive distinct default names without plaintext query
  values.
- Existing CLI contracts and output/group/label behavior remain compatible
  except for the approved query-aware default filename addition.
- Focused tests and the full suite pass, and the compiled binary builds.

## Non-Goals

- Generating CLI help or parser definitions from the profile registry.
- Making transient capture flags persistent.
- Changing project-root discovery.
- Changing Playwright readiness, action, inspection, or screenshot semantics.
- Adding heuristic secret-name lists or writing raw query values to filenames.
- Reorganizing unrelated domain modules.
