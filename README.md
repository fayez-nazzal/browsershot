# browsershot

[![CI](https://github.com/fayez-nazzal/browsershot/actions/workflows/ci.yml/badge.svg)](https://github.com/fayez-nazzal/browsershot/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

`browsershot` captures a web page to a PNG or an animated GIF using headless Chrome through Playwright.

It is built for producing review evidence. You point it at a URL, optionally drive the page with a few steps, and it writes an image plus a machine readable summary you can assert on.

It is made to be called by an AI coding agent, not typed by a human. The contract is machine readable: `--json` prints one JSON object on stdout, `--inspect-json` writes an element sidecar, and every failure carries a documented exit code. Recipes and traps live in [`AGENTS.md`](AGENTS.md).

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
- macOS only for GIF assembly. `--box` and `--marker` work everywhere.
- [`rclone`](https://rclone.org) only if you use `--publish`.

## Install

```sh
bun install
bun playwright install chromium
bun run build
bun link
```

`bin` points at `dist/browsershot`, which is build output and is not committed. A fresh clone must run `bun run build` before `bun link`.

`bun link` puts a global `browsershot` command in `~/.bun/bin`. Make sure that directory is on `PATH`:

```sh
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

## Use it with your AI agent

`browsershot` is built to be driven by an AI coding agent. The bundled skill teaches your agent when to reach for it and how to call it.

One command sets it up:

```sh
curl -fsSL https://raw.githubusercontent.com/fayez-nazzal/browsershot/main/scripts/install-skill.sh | bash
```

It asks which agents to set up. It defaults to Claude Code.

For scripts and CI, use the non-interactive form:

```sh
curl -fsSL https://raw.githubusercontent.com/fayez-nazzal/browsershot/main/scripts/install-skill.sh | bash -s -- --agents claude -y
```

- `--agents` accepts `claude`, `codex`, `cursor`, `opencode`, `grok`, `antigravity` or `all`.
- `--scope user` installs for every project instead of just this one.

### Claude Code plugin

Claude Code users can instead install the whole repo as a plugin:

```sh
/plugin marketplace add fayez-nazzal/browsershot
/plugin install browsershot
```

### Supported agents

Skill paths below are project scope.

| Agent | Skill path |
|---|---|
| Claude Code | `.claude/skills/browsershot/` |
| OpenAI Codex CLI | `.agents/skills/browsershot/` |
| Cursor | `.cursor/skills/browsershot/` |
| opencode | `.opencode/skills/browsershot/` |
| xAI Grok CLI | `.grok/skills/browsershot/` |
| Google Antigravity | `.agents/skills/browsershot/` |

Full recipes live in [`AGENTS.md`](AGENTS.md).

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

## Output

Every successful run prints the absolute output path as the first line on stdout. Human readable notes go to stderr, so a caller never has to parse stderr to find the file.

Pass `--json` to get one JSON object on stdout instead:

```json
{
  "outputPath": "/Users/you/browsershot/20260815-101500.png",
  "bytes": 38835,
  "sha256": "a1b2c3...",
  "gifPath": null,
  "inspectJsonPath": "/Users/you/browsershot/20260815-101500.json",
  "inspected": {
    "selector": "#t",
    "tagName": "button",
    "role": "button (implicit)",
    "name": "Menu",
    "description": "",
    "attributes": { "id": "t", "aria-expanded": "false" },
    "outerHTML": "<button id=\"t\" aria-expanded=\"false\">Menu</button>",
    "box": { "x": 8, "y": 100.4, "width": 49.4, "height": 21 }
  },
  "publishedUrl": null
}
```

- `gifPath` is set only with `--gif`.
- `inspectJsonPath` and `inspected` are set only with `--inspect`.
- `publishedUrl` is set only with `--publish`.
- Fields that do not apply to the run are `null`.

`--json` cannot be combined with `--stdout`, because both want stdout. That combination exits `2`.

Run `browsershot --help` for the full flag list.

## Notes for agents

`AGENTS.md` holds the recipes: how to probe a flow cheaply before recording it, how to script a login off camera, how to pick the right kind of mock, and the traps that waste a run.

Ready made mock specs live in `examples/`.

## Develop

```sh
bun test                  # unit tests, no network
bun run src/cli.ts --help
```

## Contributing

Issues and pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

Security reports go through [`SECURITY.md`](SECURITY.md).

## License

MIT. See [`LICENSE`](LICENSE).
