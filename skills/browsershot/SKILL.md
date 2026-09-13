---
name: browsershot
description: Use when a real browser capture and machine-readable verification are needed for a page or route.
license: MIT
compatibility: Needs the `browsershot` binary on `PATH`; complete URLs need no profile, while quick routes need a saved base URL in the current directory.
metadata:
  author: Fayez Nazzal
  version: "2.1.0"
---

# browsershot

Run from the target application repository. Choose a complete URL or a saved quick route:

```sh
browsershot https://example.com/pricing --expect-text Pricing --json

browsershot config set baseUrl https://example.com
browsershot /pricing --expect-element '#header' --json
```

Use `--element '#card'` to capture only the first matching visible element.
Save it with `browsershot config set element '#card'`, or use `--no-element`
for one full-page run. Element capture cannot be combined with `--full-page`.

Use `--act` for clicks, typing, key presses, waits, or hover states, and `--inspect` for evidence after those actions:

```sh
browsershot /dashboard --act 'click:#menu' \
  --inspect '#menu' --inspect-attr aria-expanded --json
```

When `hover:<selector>` is the final action, the capture adds a cursor SVG
centered on the hovered element's bottom edge. Hovered links also show a
black-and-white URL preview centered directly below the cursor; the preview
is ellipsized for long URLs and stays within the capture bounds.

Complete URLs do not require `.browsershot/config.json`. Quick paths require a known saved `baseUrl`; do not guess it. The legacy saved key `url` is accepted. A quick path changes only URL resolution; every option behaves the same for a complete URL, and malformed saved config is a usage error for either form, before capture starts. Saved auth, assertions, output, JSON, and viewer settings can be overridden for one run with `--no-auth`, `--no-expect`, `--output`, `--no-json`, or `--no-auto-open`.

Captures default to
`.browsershot/captures/{host}/{route}_{timestamp}.png`, plus a `_q-{query}`
segment when the URL has a query. Use `--group PR-123` to collect related
evidence and `--label menu-open` to name the captured state; Browsershot adds
safe separators, and a `--label` is the readable alternative to a query
fingerprint. These values and advanced `--output` templates accept `{host}`,
`{route}`, `{query}`, `{date}`, `{time}`, and `{timestamp}`. `{query}` holds
sanitized parameter names plus a fingerprint; query values are never written
in plaintext. `{route}` uses the pathname of a hash route (a fragment
beginning with `/`); ordinary anchors are ignored. Do not combine an explicit
`--output` with `--group` or `--label`.

Capture a saved page by name when definitions exist: `browsershot page checkout
summary --setup empty` captures the `summary` element of the `checkout` page in
its `empty` setup, and `browsershot page checkout` captures the page itself.
Definitions live in `.browsershot/pages.json`, are written with `browsershot
page add`, `page element`, and `page setup`, and are listed by `browsershot page
list` or `page show <page>`. Do not guess a name; an unknown page, element, or
setup name is a usage error that lists the known names. Page values are
defaults, a setup replaces the fields it declares, and per-run flags win over
both. Named captures are written to
`.browsershot/captures/{page}/{element|page}[_{setup}]_{timestamp}.png` without
the `_q-{query}` segment.

Read the single JSON object from stdout. Assert on `outputPath`, `sha256`, and `inspected` or `inspectJsonPath`; never read PNG bytes. The seventh field, `captured`, records what the run captured: `{"kind":"url"}` for a URL or quick-route capture, or `{"kind":"page","page":"checkout","element":"summary","setup":"empty"}` for a saved page, where `element` and `setup` are `null` when the run did not name them. `--expect-text` and `--expect-element` are pre-action readiness checks. `--inspect-attr` reports an attribute and does not compare it to an expected value. Report the absolute output path, the text or element verified, and any failure exit code.

See the repository [`README.md`](../../README.md) for uncommon flags and publishing details.
