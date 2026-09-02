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
- Never combine `--json` with `--stdout`. That exits `2`.
- Assert on text before you believe a run. A file is written even when the flow
  went nowhere.
- One capture, one claim. If you cannot name what the capture proves, do not
  ship it.
- Never log in from `browsershot`. It has no login flag. Prefer
  `--auth`, which gets the jar from `authstate` for you.
- Always pipe `authstate` through `jq -r .path` when you resolve the jar
  yourself. It prints a JSON envelope on stdout, not a bare path.
- Compare the `sha256` field across runs to catch two captures that are secretly
  the same image.
- Label any capture built with `--mock` as simulated, in the same breath as the path.

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

The manual form is still there when you want the jar path in your own hands, for
example to reuse it across several tools.

```sh
jar=$(authstate ensure --user basic-user | jq -r .path)
browsershot "https://example.com/account" \
  --cookies "$jar" \
  --inspect '[data-testid="account-name"]' \
  -o account.png \
  --json
```

- A jar is a plain file. Any number of captures can read the same one at once.
- Different accounts means different jars, not a shared one.
- Any of `--auth` / `--auth-user` / `--auth-credentials` together with `--cookies` exits `2`. Both pick the jar.
- A missing `authstate` binary exits `3` and tells you to install it.
- A failed login exits `1` and repeats the `authstate` exit code and its `reason`.
- A missing jar path exits `2` with `--cookies file not found: <path>`.
- Prove the session took. Inspect for something only a signed in page shows.

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

| Code | Meaning | Example message |
|------|---------|-----------------|
| `0` | Capture written | `browsershot: wrote /tmp/p.png (71625 bytes)` |
| `1` | The run failed a guard or the capture threw | `--expect-text "Nope" was not found on the page` |
| `2` | Usage error, including an unknown flag or a missing jar | `--cookies file not found: /tmp/nope.json` |
| `3` | Environment problem: `authstate` missing or no credentials file found | `no .testing-credentials.yaml found from ... up to ...` |
| `5` | The PNG was written but the inspect sidecar could not be | `wrote <png>, but could not write <json>` |
| `6` | The file was written but `--publish` failed | `wrote <path>, but publish failed: ...` |

`src/exit-codes.ts` also defines `4`. Nothing in the CLI raises it today, so do
not branch on it.

## Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Unknown option '--user-data-dir'` or `'--login'` | Neither flag exists. Older notes claimed they did | Use `--auth`, or `--cookies` with an `authstate` jar |
| `jar` contains JSON, not a path | `authstate` prints a JSON envelope on stdout | Use `--auth`, or pipe it: `authstate ensure ... \| jq -r .path` |
| Exit `2` with `--auth-purpose was removed` | The old flag is gone | Use `--auth-user` |
| `authstate is not installed` | The binary is not on `PATH` | Install `authstate`, then re-run |
| Exit `3` with `no .testing-credentials.yaml found` | `--auth` could not discover the file, or it does not exist | Pass `--auth-credentials <path>` |
| Exit `1` with `page still looks blank after 10s` | An app that renders late, or a genuinely sparse page | Raise `--delay`, or pass `--allow-blank` when a sparse page is the point |
| Exit `1` with `--expect-text ... was not found` | The flow did not reach the page you expected | Probe with `--inspect` and read the sidecar |
| Exit `2` on `--json --stdout` | Both want stdout | Pick one. Use `--json` for scripts |
| Run hangs until timeout | `--wait networkidle` on a page with polling, ads or analytics | Use `--wait load` with `--delay 3000` |
| The shot shows the page you started on | The link had `target="_blank"`, so the new tab was never captured | Click a link that stays in the tab, or navigate straight to the destination |
| Click times out on a visible looking control | It sits in a hidden tab or accordion pane | `--inspect` it first. A `box` of `0,0,0,0` means hidden. Open the parent first |
| A form step times out | The field is not on that page. Sign up and sign in pages differ | Probe for the field before typing into it |
| The capture shows a login screen | The jar expired | Re-run `authstate ensure`, which relogs in when the jar is dead |
| Two captures look identical | They are. Compare the `sha256` field | Check the flow actually moved between runs |

## Mocking

`--mock <spec.json>` intercepts requests before the page sees them, so a flow can
reach a state the server will not serve yet. Entries match a URL glob and do one
of three things.

| Kind | What it does | Reach for it when |
|------|--------------|-------------------|
| `redirect` | Answers with a 302 to somewhere else | A **server side** decision sends the user elsewhere and you need that branch |
| `merge` | Fetches the real response, deep merges your JSON patch into it | You want one field different and everything else real, such as one flag flipped |
| `json` | Replaces the body outright, with optional `status` | The endpoint does not exist yet, or you need an error |

```json
{
  "mocks": [
    { "url": "**/subscriptions/new*", "redirect": "https://app.example.com/checkout/new?plan=PRO" },
    { "url": "**/user_info*", "merge": { "feature_flags": { "new_checkout": true } } },
    { "url": "**/billing/quote*", "json": { "error": "unavailable" }, "status": 503 }
  ]
}
```

### Pick the right kind, or the mock does nothing

Ask where the decision is made.

- **The server decides.** A redirect, a rendered template, a flag read in the
  backend. Patching an API response in the browser changes nothing, because the
  server never sees your patch. Use `redirect` to stand in for the branch.
- **The client decides.** A flag the front end reads to choose what to render.
  Use `merge` so every other field stays real.
- **The route does not exist.** No mock helps. A missing page is missing whatever
  the flags say. Mock the step that leads there and let the real app answer.

Getting this backwards produces a run that looks fine and proves nothing.

### Keep specs portable across apps

- Match with `**/path*`, not a full URL. The same spec then works against local,
  staging and production.
- Put one spec per scenario in a file named after the scenario, not after the app.
- Keep the destination host in the `redirect` value only, since that is the one
  place it genuinely matters.

## Reporting

Report paths and a verdict. Never image bytes.

- Give the absolute `outputPath`.
- State what the capture shows, quoting the text you asserted on from
  `inspected`, and say how you verified it.
- Give the exit code when the run failed.
- If a mock was used, say so and say which branch it stood in for.
