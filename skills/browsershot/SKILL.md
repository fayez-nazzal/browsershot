---
name: browsershot
description: Captures a web page to a PNG or GIF with a real Chrome and returns a JSON contract (`outputPath`, `bytes`, `sha256`, inspected element text) so an agent can prove what a page did without reading image bytes. Use when the user asks for a screenshot of a page or app, PR screenshot evidence, visual proof that a fix works, a before and after capture, a GIF recording of a UI flow, a capture of a page behind a login, or a check that a button, banner or state actually renders. Also use for phrases like "screenshot this URL", "capture the dashboard", "show me the page", "record the flow", "take shots for the PR", or when a change needs visual evidence instead of a code diff. Prefer this over hand written Playwright for any one off page capture.
license: MIT
compatibility: Needs the `browsershot` binary on `PATH`, an installed Chrome that Playwright can drive, and `jq` for reading JSON output. Authenticated captures need the sibling `authstate` CLI.
metadata:
  author: Fayez Nazzal
  version: "1.1.0"
---

# browsershot

Drives a real Chrome, writes a PNG or GIF, and hands back a machine readable summary you can assert on.

## When to use

- A PR needs screenshot or before and after evidence.
- You must prove a page reached a state, such as an expanded menu or a success banner.
- A capture is needed behind a login.
- A UI flow should be recorded as a GIF.
- You are tempted to write throwaway Playwright for a single capture.

## Check first

```sh
command -v browsershot && command -v jq
browsershot --help | head -20
```

- No binary on `PATH` means stop and say so.
- Authenticated work also needs `command -v authstate`.

## Core recipe

Probe the flow in text first, for the price of one screenshot.

```sh
browsershot "https://example.com/dashboard" \
  --act 'click:#some-tab;wait:1500' \
  --inspect '[role="status"]' \
  --inspect-json probe.json \
  -o probe.png \
  --json
```

Assert on the sidecar, never on the image.

```sh
jq -r '.inspected.name' probe.json
```

Prefer a narrow selector over `body`. For an authenticated page, get a jar first.

```sh
jar=$(authstate ensure --credentials .testing-credentials.yaml --purpose basic-user | jq -r .path)
browsershot "https://example.com/account" --cookies "$jar" --inspect '[data-testid="account-name"]' -o account.png --json
```

## Reading the result

With `--json`, stdout is exactly one JSON object. Without it, the absolute output path is the first stdout line and everything else goes to stderr.

- `outputPath` is the absolute PNG path.
- `sha256` identifies the image without opening it. Compare across runs to catch two captures that are secretly the same.
- `gifPath` is set only with `--gif`, otherwise `null`.
- `inspectJsonPath` and `inspected` are set only with `--inspect`, otherwise `null`.
- `inspected.attributes` carries the ARIA state and is your assertion target.
- `inspected.box` of `0,0,0,0` means the element is hidden.
- `publishedUrl` is set only with `--publish`, otherwise `null`.

Exit codes worth branching on.

| Code | Meaning |
|------|---------|
| `0` | Capture written |
| `1` | A guard failed or the capture threw |
| `2` | Usage error, such as an unknown flag or a missing jar |
| `5` | PNG written but the inspect sidecar could not be |
| `6` | File written but `--publish` failed |

Codes `3` and `4` exist in `src/exit-codes.ts` and are never raised. Do not branch on them.

## Rules

- Never read the PNG or GIF into your context. Read `--json` stdout and the `--inspect-json` sidecar.
- Always pass `--json` when a script consumes the run, and never combine `--json` with `--stdout`. That exits `2`.
- Never log in from `browsershot`. There is no login flag. Pass a jar from `authstate` with `--cookies`, always piped through `jq -r .path`.
- Assert on text before you believe a run. A file is written even when the flow went nowhere.
- One capture, one claim. If you cannot name what the final frame proves, do not ship it.
- Label any capture built with `--mock` as simulated, in the same breath as the path.
- `--gif` currently fails with `ffmpeg frame extraction failed` on this machine. Capture PNGs and report the GIF as unavailable.

Full recipes, mocking guidance and the pitfall table live in `AGENTS.md` at the repo root.
