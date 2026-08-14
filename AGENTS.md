# browsershot for agents

Recipes for capturing evidence from a real browser. Written for an agent that
must produce a screenshot or a GIF and report a verdict, without ever opening
the image.

`README.md` documents every flag. This file documents the order to do things in
and the traps that waste a run.

## Golden rules

- Never read the PNG or the GIF into your context. Read `--inspect-json` instead.
- Verify what the page ended on from text, then report. Do not assume a run worked
  because a file was written. A file is written even when the flow went nowhere.
- One capture, one claim. If you cannot name what the final frame proves, do not
  ship it.
- Label any capture built with `--mock` as simulated, in the same breath as the path.
- Delete profile directories that hold a real session when you are done.

## Verify before you record

A recording is expensive and you cannot check it by looking. Always do a cheap
probe run first with the same URL and the same `--act` chain, swapping `--gif`
for `--inspect`:

```sh
browsershot "$ENTRY_URL" \
  --act "$STEPS" \
  --inspect 'body' --inspect-json probe.json -o probe.png
```

Then read `probe.json` and assert on text:

```sh
python3 -c "
import json
name = str(json.load(open('probe.json')).get('name'))
print('LANDED OK' if 'text you expect' in name else 'WRONG PAGE: ' + name[:200])"
```

Only when the probe lands where you want, re-run with `--gif`.

Prefer a narrow selector over `body` when you know one. `--inspect '[role="status"]'`
on a not-found page tells you more, in less text, than the whole body.

## Recipe: record a flow as a GIF

A GIF that opens on the page you want to prove is a weak GIF. It shows a blank
frame then the answer. Record the journey instead.

- Start at the entry point a person would start at, not the destination.
- Drive every step with `--act`.
- Do the login **before** the recording, into a profile, so no credentials are on camera.
- Budget the time: `--gif <seconds>` must be at least the sum of every `wait:` in
  the chain plus the page loads. Short by a second and the ending is missing.
- Keep it under about 20 seconds. Longer reads as a recording nobody watches.

```sh
# step 1: log in off camera, into a profile
browsershot "$APP/users/sign_in" \
  --user-data-dir ~/.browsershot-profiles/$APP_KEY \
  --act "click:#user_remember_me;focus:#user_email;type:$EMAIL;focus:#user_password;type:$PASSWORD;press:Enter;wait:18000" \
  --allow-blank -o login.png

# step 2: record from the entry point
browsershot "$ENTRY_URL" \
  --user-data-dir ~/.browsershot-profiles/$APP_KEY \
  --act 'wait:2000;click:#some-tab;wait:2500;click:a[data-cta];wait:12000' \
  --gif 20 --allow-blank -o flow.png     # writes flow.gif
```

## Recipe: an authenticated capture

- Use `--user-data-dir` with a directory per app and per account. Never share one.
- `--login` opens a window and waits for a human. It is interactive, so an agent
  cannot use it. Script the form with `--act` instead.
- **Tick the remember me box.** Many session cookies live only as long as the
  browser process, so without it the profile looks logged in during the run and is
  logged out on the next one. This is the single most common wasted run.
- Prove the login took before you rely on it. Inspect for something only a signed
  in page shows.
- When the app is behind a separate auth host, drive the whole redirect chain in
  one run. Cookies set mid-chain persist into the profile.

Delete the profile when finished:

```sh
rm -rf ~/.browsershot-profiles/$APP_KEY
```

## Recipe: mock a response

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

## Pitfalls

| Symptom | Cause | Fix |
|---------|-------|-----|
| Run hangs until timeout | `--wait networkidle` on a page with polling, ads or analytics | Use `--wait load` with `--delay 3000` |
| Recording ends on the page you started on | The link had `target="_blank"`, so the new tab was never recorded | Click a link that stays in the tab, or navigate straight to the destination |
| Click times out on a visible looking control | It sits in a hidden tab or accordion pane | `--inspect` it first, a `box` of `0,0,0,0` means hidden. Open the parent first |
| A form step times out | The field is not on that page. Sign up and sign in pages differ | Probe for the field before typing into it |
| The capture shows a login screen | The profile session expired, or remember me was not ticked | Re-run the scripted login, with the checkbox |
| Blank capture fails the run | An app that renders late | Raise `--delay`, or pass `--allow-blank` when a sparse page is the point |
| Two captures look identical | They are. Compare the `sha256` line on stderr | Check the flow actually moved between runs |
| GIF cuts off before the ending | `--gif` seconds shorter than the `--act` chain | Add up every `wait:` and add the page loads |

## Reporting

Report paths and a verdict. Never image bytes.

State what the final frame shows, quoting the text you asserted on, and say how
you verified it. If a mock was used, say so and say which branch it stood in for.
