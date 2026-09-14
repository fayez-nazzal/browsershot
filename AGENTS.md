# Browsershot

Browsershot is used in two ways: for a quick capture, or with flags that
control the page and validate the result.

## 1. Quick capture

The default, quickest way to capture screenshots.

Run the command from the application repository:

```sh
browsershot https://example.com/pricing
browsershot /route
```

Complete URLs need no config. Quick routes require `.browsershot/config.json`
with the app’s `baseUrl` (legacy `url` is accepted). Save it with:

```sh
browsershot config set baseUrl https://example.com
```

Browsershot keeps all run data in `.browsershot/`, all configs are stored in `.browsershot/config.json`, it stores the base URL and other project settings.

A quick path changes only URL resolution; every option behaves the same for a complete URL. Malformed project config is a usage error for either form, before capture starts. Reads never create the `.browsershot/` workspace.

## 2. Useful flags

Use flags when a capture needs more than a simple route:

- `--act` clicks, types, or waits before the capture.
- `--inspect` checks an element and writes a JSON sidecar. Use
  `--inspect-attr` to check a specific attribute, such as `aria-expanded`.
- `--expect-text` confirms that the expected page appeared.
- `--element` captures only the first matching visible element; `--no-element`
  disables a saved element selector for one capture. It cannot be combined
  with `--full-page`.
- `--expect-element` waits for a visible CSS element before actions.
- `--no-auth`, `--no-expect`, `--no-json`, and `--no-auto-open` disable saved
  settings for one capture.
- `--with-errors` writes browser console errors and uncaught page exceptions to
  `<png basename>.console.json` beside the PNG. The JSON result exposes this
  path as `consoleErrorsJsonPath`; it is `null` unless the flag is enabled.
- `--json` prints one machine-readable result. Use it in scripts.
- `--auth` captures an authenticated page using `authstate`.
- `--publish` sends the PNG to a saved or explicit destination.
- `--group` collects related captures under a directory, such as `PR-123`.
- `--label` describes the captured state, such as `menu-open`.
- `--output` sets an exact path or template when group and label are not enough.

Actions, checks, and inspection fit in one invocation:

```sh
browsershot /dashboard --act 'click:#menu' --inspect '#menu' --json
```

See `README.md` for the complete flag list.

The default path is
`.browsershot/captures/{host}/{route}_{timestamp}.png`, plus a `_q-{query}`
segment when the URL has a query. Output, group, and label templates support
`{host}`, `{route}`, `{query}`, `{date}`, `{time}`, and `{timestamp}`. `{query}`
holds sanitized parameter names plus a fingerprint; query values are never
written in plaintext. `{route}` uses the pathname of a hash route (a fragment
beginning with `/`); ordinary anchors are ignored.
Prefer `--group` and `--label` because they add safe separators automatically;
use `--output` only when the complete destination matters.

## 3. Saved pages

Use a saved page to recapture a known view by name, instead of rebuilding its
route, selector, and flags:

```sh
browsershot page checkout summary --setup empty
browsershot page add checkout /checkout --auth-user member
```

`page <page> [<element>] [--setup <name>]` captures; `page add`, `page element`,
`page setup`, `page list`, `page show`, and `page remove` manage definitions,
which live in `.browsershot/pages.json`. Page values are defaults, a setup
replaces the fields it declares, and per-run flags still win. Named captures are
written to
`.browsershot/captures/{page}/{element|page}[_{setup}]_{timestamp}.png`, with no
`_q-{query}` segment.

## 4. Component libraries

Use a library capture when the UI lives in a running component environment
(Storybook or Ladle) instead of on an application route:

```sh
browsershot library add ui http://localhost:6006 --plugin storybook
browsershot library ui button--primary --json
```

`add` registers the environment once; the second shape captures one example by
name, matching the catalog id or a case-insensitive `group/name`. Never guess
entry names: `browsershot library list ui` prints the entries a library
actually has. The default path is
`.browsershot/captures/{library}/{entry}_{timestamp}.png`.
## Check the result

A PNG only proves that a file was written. For reliable checks, use
`--expect-text` or `--inspect`, then read the JSON output or sidecar. The
`sha256` value identifies the image without opening it.

When reporting a run, include the absolute `outputPath`, what text or element
you verified, and the exit code if the run failed. `--inspect-attr` reports a
value but does not assert equality. Do not read PNG files into context.
