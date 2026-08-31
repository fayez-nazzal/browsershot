# Quick capture CLI design

## Goal

Add a project-local Browsershot profile so repeated captures use short commands while preserving the existing full URL and advanced flag workflows.

## Profile ownership

The project root is the nearest ancestor of the current working directory that contains `.git`. The profile lives at `.browsershot/config.json` and `.browsershot/captures/`.

The first setting or capture command creates the profile directory. The local Git exclude file receives `.browsershot/` once. Profile data never contains credentials or authentication jars.

## Configuration

The supported settings are `url`, `auth-user`, `expect-text`, `output`, `json`, and `auto-open`. The JSON representation uses `url`, `authUser`, `expectText`, `output`, `json`, and `autoOpen`.

String settings require non-empty valid values. Boolean settings are enabled by presence and are removed by `config unset`. Unknown settings and malformed JSON are usage errors.

`config set` writes through a temporary file and atomic rename. `config show` reports the saved settings. `config path` reports the profile path.

## Capture behavior

Configuration resolution is built-in defaults, saved project settings, explicit capture flags, then quick path resolution. Explicit flags apply only to the current run and override saved settings.

With a saved URL, a positional quick path is appended inside the hash route when present. Its query string remains before the hash. Without a hash route the path is appended to the URL pathname. Separators are normalized to one. A quick capture requires a saved URL and a valid path.

When neither the profile nor the command supplies an output path, captures write to `.browsershot/captures/<timestamp>.png`.

Auto open runs only after a successful file write. It invokes `open` on macOS, `xdg-open` on Linux, and `start` on Windows. An open failure warns without changing the successful capture result.

Existing capture modules continue to own browser behavior, assertions, encoding, and result reporting.

## Verification

Unit tests cover profile read and write round trips, quick URL resolution, and idempotent Git exclude updates. CLI tests cover configuration commands, saved setting precedence, invalid and missing configuration, and quick dispatch without a live browser. The existing suite, build, and CLI help command must pass.
