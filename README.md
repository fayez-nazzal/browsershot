# browsershot

[![CI](https://github.com/fayez-nazzal/browsershot/actions/workflows/ci.yml/badge.svg)](https://github.com/fayez-nazzal/browsershot/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

`browsershot` captures a web page to a PNG through Playwright. Every run loads the page headless in the bundled Chromium headless shell.

It is built for producing review evidence. You point it at a URL, optionally drive the page with a few steps, and it writes an image plus a machine readable summary you can assert on.

It is made to be called by an AI coding agent, not typed by a human. The contract is machine readable: `--json` prints one JSON object on stdout, `--inspect-json` writes an element sidecar, and every failure carries a documented exit code. Recipes and traps live in [`AGENTS.md`](AGENTS.md).

## What it does

- Captures a page to a PNG at retina scale by default.
- Drives the page before capture with `--act`, so you can shoot an open menu or a focused control.
- Highlights one element with `--inspect` and writes its role, name and ARIA state to a JSON sidecar.
- Uploads the result and prints a public link with `--publish`.

## Stateless by design

The working directory's `.browsershot/` folder is the only thing `browsershot` reads and writes.

- Every run creates `.browsershot/` where you invoked the command.
- Saved settings live in `.browsershot/config.json`, captures land in `.browsershot/captures/`.
- Transient work (annotation scratch files) runs inside `.browsershot/tmp/` and is removed when the run exits.
- A generated `.browsershot/.gitignore` makes git ignore the whole directory, so nothing else in your repo is ever touched.
- Nothing lands in your home directory. Delete `.browsershot/` to reset the tool completely.

## Requirements

- [Bun](https://bun.sh) to run the CLI.
- The Playwright Chromium headless shell from `bun playwright install chromium`. Every capture runs on it.
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

Your agent never handles a password. For a signed in capture it passes `--auth`, and `browsershot` discovers `.testing-credentials.yaml`, calls `authstate` for the jar, and captures signed in. Add `--auth-user <name>` when the credentials file holds more than one account, or `--auth-credentials <path>` to point at a file the walk-up will not find.

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

## Quick capture

`browsershot <url-or-path>` with zero flags is the normal thing:

```sh
browsershot example.com                          # -> .browsershot/captures/<timestamp>.png
browsershot https://example.com -o shot.png      # custom path
browsershot example.com --size 1920x1080         # custom viewport
browsershot example.com --full-page              # whole scrollable page
browsershot example.com --delay 3000             # extra wait before capture
browsershot example.com --json                   # machine readable summary
browsershot example.com --auto-open              # open the PNG when done
```

Hardcoded capture defaults: viewport 1440x900 at 2x (retina), wait event `load`, navigation timeout 30s. `--size WxH` is the only sizing form.

## Prove it

Every capture can carry its own evidence. Drive the page first, then shoot:

```sh
browsershot https://example.com/dashboard \
  --act 'focus:button[aria-label="More actions"];press:Enter' \
  --inspect ':focus'
```

Steps are separated by `;` and each one is `kind:value`. The kinds are `focus`, `click`, `press`, `type` and `wait`.

Every `--inspect` run prints a one line summary to stderr and writes a JSON sidecar:

```
browsershot: inspected role=button (implicit) name="Menu" aria-expanded=false
browsershot: element json shot.json
```

That line is the point. You can assert on `role`, `name` and state without ever opening the image.

Guards keep bad captures out of your review. `--expect-text <s>` fails the run unless the text rendered. A non-2xx/3xx response fails the run unless you pass `--allow-status`. A page that still looks blank after 10s of polling fails the run unless you pass `--allow-blank`.

`--box` and `--marker` draw rectangles and point markers on the PNG after capture.

## Auth

`browsershot` never logs in and never stores a password. `authstate` owns every login:

```sh
browsershot https://example.com/account \
  --auth \
  --inspect '[data-testid="account-name"]'
```

`--auth` discovers `.testing-credentials.yaml` by walking up from the working directory, runs `authstate ensure` for the file's default user, reads the `path` field of the JSON envelope, and uses that jar. Add `--auth-user <name>` to pick one account out of the file, or `--auth-credentials <path>` to name the file the walk-up will not find. A missing `authstate` binary exits `3`.

Keep any local credentials file out of the repo. `.gitignore` already covers `.env` and `.testing-credentials.yaml`.

## Publish

Configure an `rclone` remote once with `rclone config`. Then upload and get a public embed:

```sh
browsershot example.com --publish "gdrive:shots/my-repo/my-branch/"
```

The command prints a PR-ready inline Drive image embed for the PNG. Save the destination in the profile to make it the default:

```sh
browsershot config set publish "gdrive:shots/my-repo/my-branch/"
browsershot example.com --publish
```

An explicit `--publish <dest>` value overrides the saved key. `--publish-size` and `--publish-label` control the embed width and alt text.

## Project profile

Save the URL and common capture settings in `.browsershot/` in your working directory:

```sh
browsershot config set url "http://localhost:8990/a/app?organizationId=8#/workspaces/8"
browsershot config set auth-user test-user
browsershot config set expect-text DocClever
browsershot config set output /tmp/docclever.png
browsershot config set publish "gdrive:shots/my-repo/my-branch/"
browsershot config set json
browsershot config set auto-open
```

Then capture a route with a short command:

```sh
browsershot /clients-needing-attention
```

The route is added inside the saved hash route. The query string stays before the hash. Without a hash route the path is added to the URL pathname. A capture without a saved URL must use a full URL.

Saved values apply after built-in defaults. Explicit flags override them for one run. Without a saved or explicit output path the PNG goes to `.browsershot/captures/<timestamp>.png`.

Inspect or remove saved values:

```sh
browsershot config show
browsershot config path
browsershot config unset url
browsershot config unset auth-user
browsershot config unset expect-text
browsershot config unset output
browsershot config unset publish
browsershot config unset json
browsershot config unset auto-open
```

The profile is local to `.browsershot/` and a generated `.browsershot/.gitignore` makes git ignore the whole directory. It never stores passwords or auth jars.

## Output

Every successful run prints the absolute output path as the first line on stdout. Human readable notes go to stderr, so a caller never has to parse stderr to find the file.

Pass `--json` to get one JSON object on stdout instead:

```json
{
  "outputPath": "/Users/you/dev/my-app/.browsershot/captures/20260815-101500.png",
  "bytes": 38835,
  "sha256": "a1b2c3...",
  "inspectJsonPath": "/Users/you/dev/my-app/.browsershot/captures/20260815-101500.json",
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

- `inspectJsonPath` and `inspected` are set only with `--inspect`.
- `publishedUrl` is set only with `--publish`.
- Fields that do not apply to the run are `null`.

Run `browsershot --help` for the full flag list.

## Notes for agents

`AGENTS.md` holds the recipes: how to probe a flow cheaply before capturing it, how to script a login, and the traps that waste a run.

## Develop

```sh
bun test                  # unit tests, no network
bun run src/cli.ts --help
```

To verify captures end to end with a local sample page:

```sh
bun test test/cli-e2e.test.ts
```

The test checks viewport and full-page PNG dimensions. It checks the PNG signature. It checks the output hash. It checks rendered heading text.

## Contributing

Issues and pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

Security reports go through [`SECURITY.md`](SECURITY.md).

## License

MIT. See [`LICENSE`](LICENSE).
