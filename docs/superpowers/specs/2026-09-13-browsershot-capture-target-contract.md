# Browsershot Named Captures: Shared Contract

Date: 2026-09-13
Status: Approved design. Prerequisite for both named-capture plans.

## Goal

Fix the single seam that saved pages and library plugins both touch, so the two
plans can be built in parallel without colliding in run-option resolution. The
seam is one value object describing what to capture, plus the way a result
reports what it captured.

This document specifies no user-facing feature on its own. It exists so
`2026-09-13-browsershot-saved-pages-design.md` and
`2026-09-13-browsershot-library-plugins-design.md` never need to agree with each
other directly.

## Constraints

- Preserve every documented flag, saved setting, exit code, and stdout or stderr
  behavior. The six existing JSON success fields keep their names and types.
- Keep one capture pipeline. `src/capture.ts` and `src/run-capture.ts` must not
  learn that pages or libraries exist.
- Add no runtime dependency, no plugin runtime, and no service container.
- Definitions and caches stay inside the self-ignoring `.browsershot/`
  workspace. `ensureWorkspace` keeps its existing behavior of never overwriting
  an existing `.browsershot/.gitignore`.
- Named capture is additive. `browsershot <url-or-path>` behaves exactly as it
  does today.

## Current State

`resolveRunOptions` consumes the positional argument, parsed flags, the
validated profile, workspace paths, and an optional clock, and returns one
immutable `ResolvedRunOptions` (`src/run-options.ts:252`). Within it:

- `capture.element` is a CSS selector sourced only from `--element` or the saved
  `element` setting (`src/run-options.ts:266`), and cannot combine with
  `--full-page` (`src/run-options.ts:267`).
- `outputPath` comes from `resolveOutputPath`, which derives a host segment and
  a route segment from the URL (`src/output-path.ts:201`).
- Success is reported as `SuccessSummary` with six fields
  (`src/run-capture.ts:14`), printed as one JSON object when `--json` is active
  (`src/run-capture.ts:222`).
- Exit codes are 0 success, 1 capture or guard failure, 2 usage, 3 environment
  or credentials, 4 sidecar write, 5 publish (`src/exit-codes.ts`).

Nothing today associates a selector with a page, and no command namespace exists
beyond `config`.

## The Shared Value Object

A new module `src/capture-target.ts` owns one type and no behavior beyond
validation. It imports only the `Action` type from `src/act.ts`.

```ts
export type CaptureIdentity =
  | { kind: "url" }
  | { kind: "page"; page: string; element?: string; setup?: string }
  | { kind: "library"; library: string; entry: string };

export interface CaptureTarget {
  url: string;
  element?: string;
  expectElement?: string;
  expectText?: string;
  actions?: Action[];
  authUser?: string;
  viewport?: { width: number; height: number };
  identity: CaptureIdentity;
}
```

Rules that both plans depend on:

1. Exactly one resolver produces a `CaptureTarget` for a run: the existing
   URL path, the page resolver, or the library resolver. Resolvers never read
   flags outside the ones that address them.
2. `resolveRunOptions` remains the only place where precedence lives. A resolved
   target supplies defaults; explicit per-run flags replace them, with the same
   positive-versus-negative conflict rules already in force.
3. `actions` is the exception to replacement. Per-run `--act` steps run after
   the target's steps, in order, with no interleaving and no deduplication.
4. `identity` is inert data. Capture execution must not branch on it. Its only
   consumers are output naming and the JSON report.
5. A target carrying `element` conflicts with `--full-page` exactly as a saved
   `element` setting does today.

## Resolution Failures

Name resolution failures are usage errors, because nothing about the run can be
salvaged by the browser:

| Situation | Exit | Message shape |
|---|---|---|
| Unknown name | 2 | `unknown page "checkout"; known pages: billing, dashboard` |
| Ambiguous entry name | 2 | `ambiguous entry "loading"; candidates: button--loading, spinner--loading` |
| Malformed definition file | 2 | Mirrors `malformed profile config: <path>` |
| Catalog host unreachable | 1 | Names the library and the address tried |
| Catalog rejects credentials | 3 | Names the library and the environment variable consulted |

Exit 1 and exit 3 keep their current meanings: a runtime failure that a working
environment would not produce, and a credentials or environment failure.

## Output Naming

When an identity is not `url` and no explicit `--output` is given, the default
path groups by the saved name rather than by URL host and route:

```text
.browsershot/captures/{group?}/{page}/{element|page}[_{setup}][_{label}]_{timestamp}.png
.browsershot/captures/{group?}/{library}/{entry}[_{label}]_{timestamp}.png
```

`--output`, `--group`, and `--label` keep their current precedence and conflict
rules. Existing segment sanitizing, Windows reserved-name handling, and the
255-byte component limits in `src/output-path.ts` apply unchanged. The `_q-`
query suffix is omitted for named captures, because the saved name and setup,
not the URL, identify the capture.

`resolveOutputPath` gains one optional `identity` field on
`ResolveOutputPathOptions`. Its absence reproduces today's behavior byte for
byte.

## Result Identity

`SuccessSummary` gains exactly one field, `captured`, holding the identity:

```json
{
  "outputPath": "/abs/path.png",
  "bytes": 76218,
  "sha256": "…",
  "inspectJsonPath": null,
  "inspected": null,
  "publishedUrl": null,
  "captured": { "kind": "page", "page": "checkout", "element": "summary", "setup": null }
}
```

An ad-hoc run reports `{ "kind": "url" }`. The six existing fields are
unchanged, so consumers reading them by name are unaffected. The documented
contract becomes seven stable fields; `README.md` and `skills/browsershot`
must be updated in the plan that lands second.

## Landing Order and Collision Avoidance

Both plans extend command dispatch and run-option resolution, which is the only
place they would otherwise conflict. To keep them parallel:

1. One small preparatory change lands first: `src/capture-target.ts`, the
   optional `identity` handling in `src/output-path.ts`, the `captured` field in
   `SuccessSummary`, and dispatch entries in `src/cli.ts` for the `page` and
   `library` keywords that fail with a not-implemented usage error.
2. Plan A then owns `src/pages.ts` and its CLI surface; Plan B owns
   `src/libraries.ts`, plugin handling, and its CLI surface. Each adds its own
   resolver call to `resolveRunOptions` at the call site reserved in step 1.
3. Neither plan imports the other. Shared behavior changes go through this
   document, not through direct coordination.

## Verification

All of it runs without a browser:

- A target's fields become `ResolvedRunOptions.capture` fields, and explicit
  flags override them.
- Per-run `--act` steps appear after target steps in the resolved action list.
- A target with `element` plus `--full-page` is a usage error.
- Output naming for each identity kind, including a setup name, a label, and a
  component that would exceed 255 bytes.
- `--json` output contains the six original fields unchanged plus `captured`,
  and `{ "kind": "url" }` for an ad-hoc capture.

## Non-Goals

- No change to capture execution, authentication, publishing, or inspection.
- No shared component identity between pages and library entries.
- No committed or synchronized definitions.
- No general plugin runtime; see the library plan for the declarative format.
