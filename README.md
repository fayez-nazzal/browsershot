# browsershot

`browsershot` captures a web page to a PNG or an animated GIF using headless Chrome through Playwright.

It is built for producing review evidence. You point it at a URL, optionally drive the page with a few steps, and it writes an image plus a machine readable summary you can assert on.

## What it does

- Captures a page to a PNG at retina scale by default.
- Records a short flow to a GIF with `--gif <seconds>`.
- Drives the page before capture with `--act`, so you can shoot an open menu or a focused control.
- Highlights one element with `--inspect` and writes its role, name and ARIA state to a JSON sidecar.
- Builds a before and after card from two PNGs with `--compare`.
- Builds a before and after page from plain data with `--evidence`.
- Fakes a network response with `--mock`, so a flow can reach a state the server will not serve yet.
- Uploads the result and prints a public link with `--publish`.

## Requirements

- [Bun](https://bun.sh) to run the CLI.
- Google Chrome installed. Playwright uses the `chrome` channel first and falls back to bundled Chromium.
- macOS only for `--annotate`, `--copy`, `--box`, `--marker` and GIF assembly.
- [`rclone`](https://rclone.org) only if you use `--publish`.

## Install

```sh
bun install
bun playwright install chromium
bun link
```

`bun link` puts a global `browsershot` command in `~/.bun/bin`. Make sure that directory is on `PATH`:

```sh
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

## Configure

`browsershot` needs no config file for normal use.

Two things are optional.

- For an authenticated capture, pass a Playwright storage state file with `--cookies <path>`. `browsershot` never logs in and never stores a password.
- For `--publish`, configure an `rclone` remote once with `rclone config`. Then pass a destination such as `--publish "gdrive:shots/my-repo/my-branch/"`.

Keep any local credentials file out of the repo. `.gitignore` already covers `.env` and `.testing-credentials.yaml`.

## Daily use

```sh
browsershot example.com                          # -> ~/browsershot/<timestamp>.png
browsershot https://example.com -o shot.png      # custom path
browsershot example.com --preset phone           # 390x844 viewport
browsershot example.com --size 1920x1080         # custom viewport
browsershot example.com --full-page              # whole scrollable page
browsershot example.com --gif 5                  # 5 second recording -> shot.gif
browsershot example.com --stdout > shot.png
```

Drive the page first, then shoot:

```sh
browsershot https://example.com/dashboard \
  --act 'focus:button[aria-label="More actions"];press:Enter' \
  --inspect ':focus'
```

Steps are separated by `;` and each one is `kind:value`. The kinds are `focus`, `click`, `press`, `type` and `wait`.

Build a before and after card:

```sh
browsershot --compare before.png,after.png \
  --compare-labels "main,my-branch" \
  --compare-title "menu button missing aria-expanded" \
  -o card.png
```

Every `--inspect` run prints a one line summary to stderr and writes a JSON sidecar:

```
browsershot: inspected role=button (implicit) name="Menu" aria-expanded=false
browsershot: element json shot.json
```

That line is the point. You can assert on `role`, `name` and state without ever opening the image.

Run `browsershot --help` for the full flag list.

## Notes for agents

`AGENTS.md` holds the recipes: how to probe a flow cheaply before recording it, how to script a login off camera, how to pick the right kind of mock, and the traps that waste a run.

Ready made mock specs live in `examples/`.

## Develop

```sh
bun test                  # unit tests, no network
bun run src/cli.ts --help
```

## License

MIT. See `LICENSE`.
