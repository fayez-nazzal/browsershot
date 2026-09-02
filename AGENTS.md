# browsershot for agents

`browsershot` is built to be called by an AI coding agent, not typed by a human.
It drives a real browser, captures a page to a PNG, and hands back a
machine readable summary. The reason to call it instead of writing throwaway
Playwright is `--json` plus `--inspect-json`. You get `outputPath`, `bytes`,
`sha256` and the inspected element as text, so you can prove what the page did
without ever pulling image bytes into your context.

`README.md` documents every flag. This file documents the order to do things in,
the recipes, and the traps that waste a run.

## Golden rules

- Never read the PNG into your context. Read `--json` stdout and the
  `--inspect-json` sidecar instead.
- Always pass `--json` when a script consumes the run. Without it the absolute
  output path is the first stdout line and everything else is on stderr.
- Assert on text before you believe a run. A file is written even when the flow
  went nowhere.
- One capture, one claim. If you cannot name what the capture proves, do not
  ship it.
- Never log in from `browsershot`. It has no login flag. Prefer
  `--auth`, which gets the jar from `authstate` for you.
- Compare the `sha256` field across runs to catch two captures that are secretly
  the same image.

## Recipes

### Probe a flow cheaply before you capture it

Proves the `--act` chain lands on the page you think it does, in text, for the
price of one screenshot.

```sh
browsershot "https://example.com/dashboard" \
  --act 'click:#some-tab;wait:1500' \
  --inspect '[role="status"]' \
  --inspect-json probe.json \
  -o probe.png \
  --json
```

Then assert on the sidecar, never on the image.

```sh
jq -r '.inspected.name' probe.json
```

Prefer a narrow selector over `body`. `--inspect '[role="status"]'` on a
not-found page tells you more, in less text, than the whole body.

Ran here against a local file URL. Real output:

```
browsershot: inspected role=button (implicit) name="Menu" aria-expanded=true
browsershot: element json /tmp/p.json
```

### Capture a state that only exists after a click

Proves an interactive state, such as an expanded menu, with the ARIA attribute
as the evidence.

```sh
browsershot "https://example.com/dashboard" \
  --act 'click:#t' \
  --inspect '#t' \
  --inspect-attr aria-expanded \
  -o menu.png \
  --json
```

Ran here. `aria-expanded` came back as `true` in `inspected.attributes`, which is
the whole point. The click is proven from text.

### An authenticated capture

`browsershot` never logs in. There is no `--login` flag and no profile flag. The
session always comes from a Playwright storageState jar produced by the sibling
tool `authstate`. Use the one flag form.

```sh
browsershot "https://example.com/account" \
  --auth \
  --auth-user basic-user \
  --inspect '[data-testid="account-name"]' \
  -o account.png \
  --json
```

`--auth` discovers `.testing-credentials.yaml` by walking up from the working
directory, runs `authstate ensure`, and uses the jar. Drop `--auth-user` when the
credentials file's `default` entry is the one you want. When the credentials file
lives somewhere the walk-up will not find, point at it directly.

```sh
browsershot "https://example.com/account" \
  --auth-credentials ./config/testing-creds.yaml \
  --auth-user basic-user \
  --inspect '[data-testid="account-name"]' \
  -o account.png \
  --json
```

- A missing `authstate` binary exits `3` and tells you to install it.
- A failed login exits `1` and repeats the `authstate` exit code and its `reason`.
- Prove the session took. Inspect for something only a signed in page shows.

### Publish to a saved destination

Save the rclone destination once per project, then publish bare.

```sh
browsershot config set publish gdrive:PR-Shots/myrepo/mybranch/
browsershot /dashboard --publish
```

Resolution order: an explicit `--publish <dest>` value wins, then the `publish`
profile key, then a usage error exits `2`. Bare `--publish` without a saved key
fails before the browser launches.

```sh
browsershot /dashboard --publish gdrive:other/dir/    # explicit override
```

`--publish-size` and `--publish-label` control the embed width and alt text. A
publish failure after a successful write exits `5` and keeps the PNG on disk.

## Reading the output

Without `--json` the absolute output path is the first stdout line. Everything
human readable goes to stderr.

With `--json` stdout is exactly one JSON object. Real captured output:

```json
{"outputPath":"/tmp/p.png","bytes":71625,"sha256":"231ae8c5acd05c7c17e6a959f2370da91c92acda677b0afc44ab614a67884c1f","inspectJsonPath":"/tmp/p.json","inspected":{"selector":"#t","tagName":"button","role":"button (implicit)","name":"Menu","description":"","attributes":{"id":"t","aria-expanded":"true"},"outerHTML":"<button id=\"t\" aria-expanded=\"true\">Menu</button>","displayHTML":"<button id=\"t\" aria-expanded=\"true\">Menu</button>","box":{"x":8,"y":66.4375,"width":49.359375,"height":21}},"publishedUrl":null}
```

Fields worth asserting on.

- `outputPath` is the absolute PNG path.
- `sha256` identifies the image without opening it.
- `inspectJsonPath` and `inspected` are set only with `--inspect`, otherwise `null`.
- `inspected.attributes` carries the ARIA state. This is your assertion target.
- `inspected.box` of `0,0,0,0` means the element is hidden.
- `publishedUrl` is set only with `--publish`, otherwise `null`.

Exit codes seen in the source and reproduced by running the binary.

|Code|Meaning|Example message|
|---|---|---|
|`0`|Capture written|`browsershot: wrote /tmp/p.png (71625 bytes)`|
|`1`|The run failed a guard or the capture threw|`--expect-text "Nope" was not found on the page`|
|`2`|Usage error, including an unknown flag|`--size must look like WxH (e.g. 1920x1080), got "abc"`|
|`3`|Environment problem: `authstate` missing or no credentials file found|`no .testing-credentials.yaml found from ... up to ...`|
|`4`|The PNG was written but the inspect sidecar could not be|`wrote <png>, but could not write <json>`|
|`5`|The file was written but `--publish` failed|`wrote <path>, but publish failed: ...`|

## Pitfalls

|Symptom|Cause|Fix|
|---|---|---|
|`Unknown option '--user-data-dir'`, `'--login'`, `'--cookies'`, `'--mock'` or `'--stdout'`|None of these flags exist anymore. Older notes claimed they did|Use `--auth` for sessions, `--act` for interactive states, `--json` for scripts|
|Exit `2` with `--auth-purpose was removed`|The old flag is gone|Use `--auth-user`|
|`authstate is not installed`|The binary is not on `PATH`|Install `authstate`, then re-run|
|Exit `3` with `no .testing-credentials.yaml found`|`--auth` could not discover the file, or it does not exist|Pass `--auth-credentials <path>`|
|Exit `1` with `page still looks blank after 10s`|An app that renders late, or a genuinely sparse page|Raise `--delay`, or pass `--allow-blank` when a sparse page is the point|
|Exit `1` with `--expect-text ... was not found`|The flow did not reach the page you expected|Probe with `--inspect` and read the sidecar|
|The shot shows the page you started on|The link had `target="_blank"`, so the new tab was never captured|Click a link that stays in the tab, or navigate straight to the destination|
|Click times out on a visible looking control|It sits in a hidden tab or accordion pane|`--inspect` it first. A `box` of `0,0,0,0` means hidden. Open the parent first|
|A form step times out|The field is not on that page. Sign up and sign in pages differ|Probe for the field before typing into it|
|The capture shows a login screen|The jar expired|Re-run `authstate ensure`, which relogs in when the jar is dead|
|Two captures look identical|They are. Compare the `sha256` field|Check the flow actually moved between runs|

## Reporting

Report paths and a verdict. Never image bytes.

- Give the absolute `outputPath`.
- State what the capture shows, quoting the text you asserted on from
  `inspected`, and say how you verified it.
- Give the exit code when the run failed.
