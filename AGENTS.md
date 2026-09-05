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

## 2. Useful flags

Use flags when a capture needs more than a simple route:

- `--act` clicks, types, or waits before the capture.
- `--inspect` checks an element and writes a JSON sidecar. Use
  `--inspect-attr` to check a specific attribute, such as `aria-expanded`.
- `--expect-text` confirms that the expected page appeared.
- `--expect-element` waits for a visible CSS element before actions.
- `--no-auth`, `--no-expect`, `--no-json`, and `--no-auto-open` disable saved
  settings for one capture.
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
`.browsershot/captures/{host}/{route}_{timestamp}.png`. Output, group, and label
templates support `{host}`, `{route}`, `{date}`, `{time}`, and `{timestamp}`.
Prefer `--group` and `--label` because they add safe separators automatically;
use `--output` only when the complete destination matters.

## Check the result

A PNG only proves that a file was written. For reliable checks, use
`--expect-text` or `--inspect`, then read the JSON output or sidecar. The
`sha256` value identifies the image without opening it.

When reporting a run, include the absolute `outputPath`, what text or element
you verified, and the exit code if the run failed. `--inspect-attr` reports a
value but does not assert equality. Do not read PNG files into context.
