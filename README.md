# browsershot

A CLI tool that lets you take screenshot of any page in one quick command:

```sh
browsershot https://example.com/pricing # Take screenshot of pricing page
```

It loads the URL, waits for the page to render, and writes a PNG path with a JSON summary.

## AI Agents

Browsershot works great with AI Agents, it's efficient enough to support AI Agents execute and validate efficiently, faster, with less tokens:
- Supports project-based configurations, this way a short command does the job without needing to provide tons of flags.
- Helps AI Agents do design work, it can take screenshots of implemented web pages and compare with design reference using vision.
- Helps write PRs with screenshot evidence of the implemented pages.
- Supports structured JSON output per command so AI Agents get quick summaries in its context window without having to re-check and fire many tool calls.
- Authentication support, without you worrying about unauthenticated screenshots or expired sessions, it has built-in support for my other tool [authstate](https://github.com/fayez-nazzal/authstate).
- For authentications, multiple testing users are supported using `.testing-credentials.yaml`, e.p: You can have a free, premium, non-onboarded user accounts, each with different testing data covering your testing views or use cases.

## Project-based configutations

When a project has a stable base URL, save it once and use short routes:

```sh
browsershot config set baseUrl https://example.com # Saved to .browsershot/config.json where invoked
browsershot /pricing # Works across multiple commands
```

This is the same capture pipeline. The path is simply resolved against the saved base in the current directory. A complete URL always wins over the saved
base and is never prefixed by it.

## Make one capture prove something

A PNG tells you that a file was written. It does not tell you that the menu
opened, the account loaded, or the route was the one you intended. Add a
readiness check when the page must reach a known landing state, then inspect the
result after any interaction:

```sh
browsershot /dashboard \
  --expect-element '#dashboard' \
  --act 'click:#menu' \
  --inspect '#menu' \
  --inspect-attr aria-expanded \
  --json
```

The element check happens before actions. The click happens before inspection.
The JSON result then carries the inspected element, including its attributes.
For a script or an agent, this is usually the most useful form of capture.

With `--json`, stdout contains exactly one object:

```json
{
  "outputPath": "/absolute/path/shot.png",
  "bytes": 76218,
  "sha256": "…",
  "inspectJsonPath": "/absolute/path/shot.json",
  "inspected": { "attributes": { "aria-expanded": "true" } },
  "publishedUrl": null
}
```

The six fields are stable. `--inspect-attr` brings an attribute to the front of
the report; it does not compare the value with an expectation. Assert on the
JSON field yourself. Without `--json`, the absolute PNG path is the first line
on stdout and human diagnostics go to stderr.

Never read PNG bytes into agent context. Use `outputPath`, `bytes`, `sha256`,
`inspected`, and the inspection sidecar as evidence.

## Saved settings and one-run choices

Project settings live in `.browsershot/config.json` in the current directory.
Save only what should be the default for that project:

```sh
browsershot config set baseUrl https://example.com
browsershot config set expectElement '#app'
browsershot config set authUser member
browsershot config set output .browsershot/captures/latest.png
browsershot config set json
browsershot config show
```

The canonical setting names are `baseUrl`, `authUser`, `expectElement`,
`expectText`, `output`, `json`, `autoOpen`, and `publish`. `config unset <name>`
removes a saved setting. Config commands also accept the existing kebab-case
aliases: `base-url`, `url`, `auth-user`, `expect-element`, `expect-text`, and
`auto-open`. Reads accept legacy `url` without rewriting the file; explicit
writes use `baseUrl`.

Saved settings are convenient, not binding. Override them for one capture:

```sh
browsershot /account --auth-user admin --expect-element '#account-ready'
browsershot /login --no-auth --no-expect
browsershot /pricing --output /tmp/pricing.png --no-json
```

An explicit `--expect-text` or `--expect-element` replaces the complete saved
assertion set for that run. If both are supplied, both must pass. `--no-expect`
turns off content assertions only; HTTP status and blank-render guards remain
active. A positive and negative flag for the same setting is a usage error.

## The capture lifecycle

Each capture uses one browser launch and one screenshot. The page is loaded,
checked for a disallowed HTTP status, and allowed to render. Then Browsershot
applies an optional delay, waits for an expected element and/or text, runs
actions, records inspection data, draws annotations, and writes the PNG.

`--expect-text <text>` is a case-sensitive check against `body.innerText`.
`--expect-element <selector>` waits up to 10 seconds for the first matching CSS
element to become visible. It uses the first match, so a specific selector is
safer than a broad one. Visibility does not prove that an element is in the
viewport, unobscured, fully opaque, or correct in every other way.

The built-in guards catch two common false captures:

- A non-2xx/3xx response fails unless you pass `--allow-status`.
- A page that still looks almost empty after polling fails unless you pass
  `--allow-blank`.

Use `--delay <ms>` when the application needs a known extra settling period.
Use `--verbose` when diagnosing navigation, browser, console, request, or action
problems. Guard and capture failures exit `1`; invalid options and conflicts
exit `2`.

## Actions and visual marks

Actions are transient and run only for the current capture. Steps are separated
by semicolons and use CSS selectors:

```sh
browsershot /settings \
  --act 'focus:#name;type:Ada;press:Tab;wait:300' \
  --inspect ':focus' \
  --json
```

Supported steps are `focus`, `click`, `press`, `type`, and `wait` in
milliseconds. `--inspect <selector>` records the first matching element and
draws its markup, role, name, and state over the capture. `--inspect-json <path>`
chooses the sidecar path; otherwise it sits beside the PNG. `--inspect-note`
adds a note to the panel.

For coordinate-level evidence, repeat `--box x,y,w,h[,color]` and
`--marker x,y[,color]`. Coordinates use the post-scale PNG and a top-left
origin. `--size WxH` changes the viewport, and `--full-page` captures the full
scrollable page.

## Authentication

Browsershot does not contain a login script. When a session is needed, `--auth`
asks the sibling `authstate` tool to discover `.testing-credentials.yaml`, run
the authentication flow, and provide a storage-state jar to the browser:

```sh
browsershot https://example.com/account \
  --auth --auth-user member \
  --inspect '[data-testid="account-name"]' --json
```

Use `--auth-credentials <path>` when discovery should use a specific file.
`--auth-user` implies `--auth`. Credentials and storage-state paths are never
saved in the Browsershot profile. If a saved user would trigger auth for a
particular public page, use `--no-auth`.

## Publishing

Publishing is optional and belongs at the end of a verified capture. Save a
destination for a project:

```sh
browsershot config set publish gdrive:shots/my-repo/my-branch/
browsershot /pricing --publish
```

Or choose a destination once:

```sh
browsershot /pricing --publish gdrive:other/dir/
```

An explicit destination wins. Bare `--publish` uses the saved `publish` value
and fails before the browser launches if none exists. `--publish-size <px>`
sets the embed width and `--publish-label <text>` sets its alt text. If upload
fails after the PNG is written, the PNG stays on disk and the command exits `5`.

## Configuration and reference

`browsershot config set <name> [value]` saves a setting. Boolean settings such
as `json` and `autoOpen` take no value and turn on when set. `config unset`
removes them. `config show` prints normalized settings, and `config path` prints
the current config path.

The default PNG path is `.browsershot/captures/<timestamp>.png`. `--output`
accepts any writable path. `-h, --help` prints the compact command reference;
`-v, --version` prints the version.

## For agents

The bundled [`AGENTS.md`](AGENTS.md) is the short operational recipe. The
installed [`skills/browsershot/SKILL.md`](skills/browsershot/SKILL.md) carries
the same essentials for agents that discover the skill directly.

## License

MIT. See [`LICENSE`](LICENSE).
