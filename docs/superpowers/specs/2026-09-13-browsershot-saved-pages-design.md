# Browsershot Saved Pages Design

Date: 2026-09-13
Status: Approved design. Plan A of two parallel plans.
Depends on: `2026-09-13-browsershot-capture-target-contract.md`

## Goal

Let a person or an agent recapture a known view by name, without supplying a
selector or rediscovering how the view is reached. A page is a reusable context:
it remembers where the view lives, what must happen before the shot, and which
parts of it are worth capturing.

## Constraints

- Produce a `CaptureTarget` and nothing else. Precedence, capture execution, and
  reporting stay where they already are.
- Reuse existing vocabulary. Registration accepts the same flags as capture, so
  there is no second dialect to learn.
- Reuse existing URL resolution. A route beginning with `/` resolves against the
  saved `baseUrl` exactly as a quick path does (`src/run-options.ts:223`).
- Definitions live in the local workspace and are never shared automatically.
- No selector discovery, no browser exploration, no inference about application
  state.
- An unsatisfiable capture fails; it never falls back to a different image.

## Current State

A single project-wide `element` selector can be saved, unattached to any page,
and overridden by `--element` or disabled by `--no-element`
(`src/run-options.ts:266`). Element capture waits for the first visible match and
screenshots its bounds (`src/capture.ts:206`). Saved settings live in
`.browsershot/config.json` through a registry of typed descriptors
(`src/profile-settings.ts:43`) with atomic writes (`src/profile.ts:34`).

No concept of a page, a named element, or a saved preparation exists.

## CLI Surface

Capture:

```text
browsershot page <page> [<element>] [capture options]
browsershot page <page> [<element>] --setup <name> [capture options]
```

Omitting the element captures the page itself. `--element` keeps meaning a
literal CSS selector and overrides the named element for that run.

Definition management:

```text
browsershot page add <page> <route-or-url> [capture options]
browsershot page element <page> <name> <selector>
browsershot page setup <page> <name> [capture options]
browsershot page list
browsershot page show <page>
browsershot page remove <page> [<element-or-setup>]
```

`add` and `setup` accept `--auth-user`, `--auth-redirect`, `--expect-element`,
`--expect-text`, `--act`, and `--size`, and store them as that page's or setup's
defaults. A setup may also restate the route when the state is expressed in the
URL.

`add`, `element`, `setup`, `list`, `show`, and `remove` are reserved and cannot
be used as page names. Registering an existing name is a usage error; replacing
one requires removing it first, so a definition is never silently lost.

Names match `[a-z0-9][a-z0-9_-]*`. This keeps them predictable in file paths and
unambiguous for agents that compose commands.

## Storage

One file, `.browsershot/pages.json`, written through the temporary-file and
atomic-rename pattern already used for the profile (`src/profile.ts:34`). A
single file keeps listing, validation, and rewriting trivial, and matches the
existing convention of one JSON document per concern.

```json
{
  "version": 1,
  "pages": {
    "checkout": {
      "route": "/checkout",
      "authUser": "member",
      "expectElement": "#checkout-ready",
      "act": "click:#promo;wait:250",
      "size": "1440x900",
      "elements": { "summary": "#order-summary" },
      "setups": {
        "empty": { "route": "/checkout?cart=empty" },
        "admin": { "authUser": "admin", "act": "click:#impersonate" }
      }
    }
  }
}
```

Actions are stored in the existing `--act` string syntax and parsed with
`parseActions` (`src/act.ts:24`), so one grammar covers the flag and the file.

Validation happens on write: routes are non-empty, selectors are non-empty,
action strings parse, `size` parses, and names are well formed. A quick route is
not checked against `baseUrl` at write time, because the base is allowed to
arrive later; an unresolvable route fails at capture time with the existing quick
capture message.

Reading a malformed `pages.json` is a usage error that blocks the run before
capture starts, mirroring malformed profile handling (`src/profile.ts:29`).

## Resolution

`src/pages.ts` owns reading, validating, and resolving. Given a page name, an
optional element name, and an optional setup name it returns a `CaptureTarget`:

1. Resolve the route through the existing URL rule: a leading `/` composes with
   the saved `baseUrl`, anything else is a complete URL.
2. Apply page defaults, then setup values. A setup replaces any field it
   declares, including the route.
3. Concatenate actions in order: page actions, then setup actions. The contract
   then appends per-run `--act` steps.
4. Resolve the element name to its selector, or leave `element` unset when no
   element was named.
5. Stamp `identity` as `{ kind: "page", page, element?, setup? }`.

Per-run flags override the resulting fields in `resolveRunOptions`, unchanged.
`--no-element` clears a named element for that run, and `--element` replaces it.

## Failure Behavior

| Trigger | Result |
|---|---|
| Unknown page, element, or setup name | Usage error listing the known names for that scope |
| Reserved word used as a page name | Usage error naming the reserved words |
| Named element absent at capture time | Existing element failure, exit 1, no file written |
| Named element plus `--full-page` | Existing conflict usage error |
| Quick route with no saved `baseUrl` | Existing quick capture usage error |

Nothing is written for an unsatisfied element, and no page-level image is
substituted.

## Output

Default paths follow the contract: `captures/{page}/{element|page}[_{setup}]`
plus the existing label and timestamp suffixes. `--output`, `--group`, and
`--label` behave as they do today.

## Verification

Without a browser:

- Store round trip, atomic write, malformed file rejection, duplicate and
  reserved name rejection, name pattern rejection.
- Resolution precedence: page defaults, setup overrides, per-run flags, and the
  action concatenation order.
- Element name to selector mapping, `--element` override, `--no-element`
  clearing, and the `--full-page` conflict.
- Unknown-name messages list known names for the right scope.
- Output paths for page, element, setup, label, and an oversized component.

With a browser, one end-to-end case in the style of `test/cli-e2e.test.ts`:
define a page against a `file://` fixture, capture a named element, and assert
the written PNG differs from the page-level capture and that `captured` names
the page and element.

## Non-Goals

- No selector discovery or suggestion.
- No sharing, syncing, or committing of definitions.
- No setups shared across pages; a setup belongs to its page.
- No modeling of application states such as empty, loading, or role-specific
  rendering. Those are outcomes of explicit inputs, not concepts to store.
- No capturing several elements in one run.
