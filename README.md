# browsershot

[![CI](https://github.com/fayez-nazzal/browsershot/actions/workflows/ci.yml/badge.svg)](https://github.com/fayez-nazzal/browsershot/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Capture any web page to a PNG from one command.

## Quick start

```sh
bun install && bun playwright install chromium   # once
bun run build && bun link                        # once

browsershot example.com                          # -> .browsershot/captures/<timestamp>.png
```

## Features

## Act suport

Drive the page with interactive actions before taking the screenshot

```sh
browsershot example.com/dashboard --act 'click:#menu-button' # Page screenshot with `menu` open
```

## Inspect support

Use browser inspect to see what the interaction actually produced:

```sh
browsershot example.com/dashboard --act 'click:#menu-button' --inspect '#menu' --inspect-attr aria-expanded

# Output: inspected role=button name="Menu" aria-expanded=true
```

The `--inspect` run writes a JSON sidecar next to the PNG with the element's role, name, attributes and markup. This can help you asserting things.

## Asserting guards

There is also guards support to fail the full command: e.p wrong HTTP status, missing `--expect-text`, or a page that never rendered. `--allow-status` and `--allow-blank` skip them.

## Sign in

You can take screenshot of authenticated pages using, I integrated my tool [authstate](https://github.com/fayez-nazzal/authstate) into browsershot for authentication support.

```sh
browsershot example.com/account --auth
```

It discovers `.testing-credentials.yaml`, logs in, and captures with the jar. `--auth-user` picks an account.

## Publish

```sh
browsershot config set publish "gdrive:shots/my-repo/my-branch/"
browsershot example.com --publish
```

Uploads to an `rclone` remote and prints a ready-to-paste image embed. Explicit `--publish <dest>` overrides the saved key.

## Profile

Save settings per project in `.browsershot/config.json`:

| Key | Saves |
|---|---|
| `url` | Base URL, so `browsershot /route` just works |
| `output` | Where captures land |
| `auth-user` | Account for `--auth` |
| `expect-text` | Text that must render |
| `publish` | Default rclone destination |
| `json` | Always print JSON |
| `auto-open` | Always open the capture |

```sh
browsershot config set url "http://localhost:8990/app#/workspaces/8"
browsershot /clients-needing-attention
```

## Output

Every run prints the absolute PNG path on stdout. Add `--json` for one machine readable object: `outputPath`, `bytes`, `sha256`, `inspectJsonPath`, `inspected`, `publishedUrl`.

## For agents

Install the bundled skill, or just point your agent at [`AGENTS.md`](AGENTS.md) for recipes and traps.

```sh
curl -fsSL https://raw.githubusercontent.com/fayez-nazzal/browsershot/main/scripts/install-skill.sh | bash
```

## License

MIT. See [`LICENSE`](LICENSE). Contributions welcome via [`CONTRIBUTING.md`](CONTRIBUTING.md).
