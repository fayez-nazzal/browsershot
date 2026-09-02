# browsershot

[![CI](https://github.com/fayez-nazzal/browsershot/actions/workflows/ci.yml/badge.svg)](https://github.com/fayez-nazzal/browsershot/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Capture any web page to a PNG from one command. Built for review evidence and for AI agents: every shot comes with a JSON summary you can assert on, never image bytes.

## Quick start

```sh
bun install && bun playwright install chromium   # once
bun run build && bun link                        # once

browsershot example.com                          # -> .browsershot/captures/<timestamp>.png
```

Defaults are hardcoded: viewport 1440x900 at 2x retina, wait event `load`, 30s timeout. `--size WxH` changes the viewport. `-o`, `--full-page`, `--delay` and `--auto-open` are there when you need them.

## Prove it

Drive the page, then inspect what the interaction actually produced:

```sh
browsershot example.com/dashboard \
  --act 'click:#menu-button' \
  --inspect '#menu' --inspect-attr aria-expanded
```

```
browsershot: inspected role=button name="Menu" aria-expanded=true
```

The `--inspect` run writes a JSON sidecar next to the PNG with the element's role, name, attributes and markup. Assert on that, not the image.

Guards fail the run instead of writing a junk capture: wrong HTTP status, missing `--expect-text`, or a page that never rendered. `--allow-status` and `--allow-blank` skip them.

## Sign in

`browsershot` never sees a password. The sibling tool `authstate` owns the login:

```sh
browsershot example.com/account --auth
```

It discovers `.testing-credentials.yaml`, logs in, and captures with the jar. `--auth-user` picks an account, `--auth-credentials` names a file outside the walk-up path.

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
