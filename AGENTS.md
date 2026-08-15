# browsershot for agents

`browsershot` is built to be called by an AI coding agent, not typed by a human.
It drives a real Chrome, captures a page to a PNG or a GIF, and hands back a
machine readable summary. The reason to call it instead of writing throwaway
Playwright is `--json` plus `--inspect-json`. You get `outputPath`, `bytes`,
`sha256` and the inspected element as text, so you can prove what the page did
without ever pulling image bytes into your context.

`README.md` documents every flag. This file documents the order to do things in,
the recipes, and the traps that waste a run.

## Golden rules

- Never read the PNG or the GIF into your context. Read `--json` stdout and the
  `--inspect-json` sidecar instead.
- Always pass `--json` when a script consumes the run. Without it the absolute
  output path is the first stdout line and everything else is on stderr.
- Never combine `--json` with `--stdout`. That exits `2`.
- Assert on text before you believe a run. A file is written even when the flow
  went nowhere.
- One capture, one claim. If you cannot name what the final frame proves, do not
  ship it.
- Never log in from `browsershot`. It has no login flag. Prefer
  `--auth-credentials <yaml>`, which gets the jar from `authstate` for you.
- Always pipe `authstate` through `jq -r .path` when you resolve the jar
  yourself. It prints a JSON envelope on stdout, not a bare path.
- Compare the `sha256` field across runs to catch two captures that are secretly
  the same image.
- Label any capture built with `--mock` as simulated, in the same breath as the path.

## Recipes

### Probe a flow cheaply before you record it

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
  --auth-credentials .testing-credentials.yaml \
  --auth-purpose basic-user \
  --inspect '[data-testid="account-name"]' \
  -o account.png \
  --json
```

`browsershot` runs `authstate ensure --credentials .testing-credentials.yaml
--purpose basic-user`, reads the `path` field out of the JSON envelope, and uses
that jar. Drop `--auth-purpose` when the credentials file holds one account.

The manual form is still there when you want the jar path in your own hands, for
example to reuse it across several tools.

```sh
jar=$(authstate ensure --credentials .testing-credentials.yaml --purpose basic-user | jq -r .path)
browsershot "https://example.com/account" \
  --cookies "$jar" \
  --inspect '[data-testid="account-name"]' \
  -o account.png \
  --json
```

Ran the `authstate` half here. Real stdout, trimmed:

```json
{"tool":"authstate","command":"path","ok":true,"status":"reused","path":"/Users/macbook/.authstate/example-app--basic-user.json","exit_code":0}
```

- A jar is a plain file. Any number of captures can read the same one at once.
- Different accounts means different jars, not a shared one.
- `--auth-credentials` together with `--cookies` exits `2`. Both pick the jar.
- `--auth-purpose` without `--auth-credentials` exits `2`.
- A missing `authstate` binary exits `3` and tells you to install it.
- A failed login exits `1` and repeats the `authstate` exit code and its `reason`.
- A missing jar path exits `2` with `--cookies file not found: <path>`.
- Prove the session took. Inspect for something only a signed in page shows.

### Record a flow as a GIF

A GIF that opens on the page you want to prove is a weak GIF. It shows a blank
frame then the answer. Record the journey instead.

```sh
browsershot "https://example.com" \
  --act 'wait:2000;click:#some-tab;wait:2500;click:a[data-cta];wait:12000' \
  --gif 20 \
  -o flow.png \
  --json
```

- Start at the entry point a person would start at, not the destination.
- `--gif <seconds>` must cover the sum of every `wait:` in the chain plus the
  page loads. Short by a second and the ending is missing.
- Keep it under about 20 seconds.
- The GIF path lands in `gifPath`, next to `-o` with a `.gif` extension.
- Probe with `--inspect` first. A recording is expensive and you cannot check it
  by looking.

Verified on this machine. A 3 second capture of a local page wrote a 47,705 byte GIF and exited `0`.

## Reading the output

Without `--json` the absolute output path is the first stdout line. Everything
human readable goes to stderr.

With `--json` stdout is exactly one JSON object. Real captured output:

```json
{"outputPath":"/tmp/p.png","bytes":71625,"sha256":"231ae8c5acd05c7c17e6a959f2370da91c92acda677b0afc44ab614a67884c1f","gifPath":null,"inspectJsonPath":"/tmp/p.json","inspected":{"selector":"#t","tagName":"button","role":"button (implicit)","name":"Menu","description":"","attributes":{"id":"t","aria-expanded":"true"},"outerHTML":"<button id=\"t\" aria-expanded=\"true\">Menu</button>","displayHTML":"<button id=\"t\" aria-expanded=\"true\">Menu</button>","box":{"x":8,"y":66.4375,"width":49.359375,"height":21}},"publishedUrl":null}
```

Fields worth asserting on.

- `outputPath` is the absolute PNG path.
- `sha256` identifies the image without opening it.
- `gifPath` is set only with `--gif`, otherwise `null`.
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
| `5` | The PNG was written but the inspect sidecar could not be | `wrote <png>, but could not write <json>` |
| `6` | The file was written but `--publish` failed | `wrote <path>, but publish failed: ...` |

`src/exit-codes.ts` also defines `3` and `4`. Nothing in the CLI raises them
today, so do not branch on them.

## Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Unknown option '--user-data-dir'` or `'--login'` | Neither flag exists. Older notes claimed they did | Use `--auth-credentials`, or `--cookies` with an `authstate` jar |
| `jar` contains JSON, not a path | `authstate` prints a JSON envelope on stdout | Use `--auth-credentials`, or pipe it: `authstate ensure ... \| jq -r .path` |
| `authstate is not installed` | The binary is not on `PATH` | Install `authstate`, then re-run |
| Exit `1` with `page still looks blank after 10s` | An app that renders late, or a genuinely sparse page | Raise `--delay`, or pass `--allow-blank` when a sparse page is the point |
| Exit `1` with `--expect-text ... was not found` | The flow did not reach the page you expected | Probe with `--inspect` and read the sidecar |
| Exit `2` on `--json --stdout` | Both want stdout | Pick one. Use `--json` for scripts |
| Run hangs until timeout | `--wait networkidle` on a page with polling, ads or analytics | Use `--wait load` with `--delay 3000` |
| Recording ends on the page you started on | The link had `target="_blank"`, so the new tab was never recorded | Click a link that stays in the tab, or navigate straight to the destination |
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

- Give the absolute `outputPath`, and `gifPath` when there is one.
- State what the final frame shows, quoting the text you asserted on from
  `inspected`, and say how you verified it.
- Give the exit code when the run failed.
- If a mock was used, say so and say which branch it stood in for.
