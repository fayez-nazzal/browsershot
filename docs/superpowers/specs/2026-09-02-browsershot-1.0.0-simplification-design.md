# browsershot 1.0.0 Simplification Design

Date: 2026-09-02
Status: Approved design, pending implementation plan

## Context
browsershot 1.0.0 grew two products in one binary. Quick capture with a saved
profile and a full agent harness with 33 options. The package was never
published to npm, so the simplified result replaces 1.0.0 under the same
version. No semver constraint applies.

The decision made in brainstorming: `browsershot <url-or-path>` with zero
flags is the normal thing. Everything else is opt-in. The quick capture
profile stays as invisible sugar. The tool keeps its prove-it contract
(`--inspect`, `--act`, guards, `--json`, sha256) and its authstate
integration.

## Removals

| Removed | Rationale |
|---|---|
| `--mock` | Fabricates states no server serves. `src/mock.ts` (150 lines), its help block, and `test/mock.test.ts` go. `--act` covers real interactive states. |
| `--html-class` | Niche theme forcing hack with a baked in repaint wait. |
| `--stdout` | Streams PNG bytes on stdout. Clashes with `--json` (exit 2). Agents read the path or the JSON. |
| `--preset` | Duplicates `--size 1920x1080`. |
| `--width`, `--height` | Collapse into `--size WxH` as the only sizing form. |
| `--scale` | Default 2 (retina) fits every use here. Hardcoded. |
| `--wait` | Event selection including the `networkidle` hang trap. Hardcoded `load`. `--delay` stays as the blunt fix and the blank guard catches dead pages. |
| `--timeout` | Navigation timeout override. Hardcoded 30s. A stuck capture fails visibly either way. |
| `--cookies` | Manual jar hand-off. `--auth` and `--auth-credentials` make authstate the single login path. Kills the exit 2 conflict rule and the longest help block. |

Kept without change: `--full-page`, `-o/--output`, `--delay`, `--size`,
`--auto-open`, `--verbose`, `--json`, the guard family
(`--expect-text`, `--allow-status`, `--allow-blank`), the inspect family,
`--act`, `--box`, `--marker`, the authstate family
(`--auth`, `--auth-user`, `--auth-credentials`), the publish family,
`--publish-size`, `--publish-label`.

## CLI surface after

```
browsershot <url-or-path> [options]
browsershot config <set|unset|show|path> [name] [value]

QUICK CAPTURE (the normal thing)
  -o, --output <path>       Output PNG path
                            (default: .browsershot/captures/<timestamp>.png)
      --size <WxH>          Viewport size (default: 1440x900)
      --delay <ms>          Extra wait after load before capture (default: 0)
      --full-page           Capture the whole scrollable page
      --auto-open           Open the written capture with the platform viewer
      --json                One JSON object on stdout with outputPath, bytes,
                            sha256, inspectJsonPath, inspected, publishedUrl
      --auth                authstate one-step authenticated capture
      --auth-user <name>    Credentials entry for --auth
      --auth-credentials <path>  Credentials file instead of discovery
      --publish [dest]      rclone upload plus public link embed
      --publish-size <px>   Long-edge width for the embed (default: 2560)
      --publish-label <text>     Alt text for the embed

PROVE IT
      --inspect <selector>       DevTools style panel over the shot
      --inspect-attr <name>      Emphasise this attribute
      --inspect-json <path>      Element data as JSON sidecar
      --inspect-note <text>      Extra panel line
      --act <steps>              Drive the page before capturing
      --box <x,y,w,h[,color]>    Rectangle outline (repeatable)
      --marker <x,y[,color]>     Point marker (repeatable)
      --expect-text <s>          Fail unless the text rendered
      --allow-status             Skip the response status guard
      --allow-blank              Skip the blank render guard

META
      --verbose             Playwright progress detail on stderr
  -h, --help
  -v, --version
```

Hardcoded capture defaults: viewport 1440x900, deviceScaleFactor 2,
wait event `load`, navigation timeout 30000 ms. Non-`--json` stdout keeps
printing the absolute output path as its first line. The `sha256 <hex>`
stderr line stays.

## Behavior changes

### Publish destination resolution

New `publish` profile key.

```
browsershot config set publish gdrive:PR-Shots/myrepo/mybranch/
browsershot /dashboard --publish                      # saved destination
browsershot /dashboard --publish gdrive:other/dir/    # explicit override
```

Resolution order: explicit `--publish <dest>` value, then the `publish`
profile key, then a usage error. `--publish` accepts an optional value.
`--publish-size` and `--publish-label` stay as plain value flags.

### Profile keys

`url`, `auth-user`, `expect-text`, `output`, `json`, `auto-open`,
`publish`. Key validation in `src/profile.ts` gains `publish`.
`ProfileConfig` gains `publish?: string`.

### Exit codes

Dead `EXIT_CAPTURE_ERROR` (4) is deleted. Nothing raised it. The rest
compact with no gaps.

| Code | Meaning |
|---|---|
| 0 | Capture written |
| 1 | Capture or guard failure |
| 2 | Usage error |
| 3 | Environment problem (authstate missing, no credentials file) |
| 4 | Written, but inspect sidecar write failed |
| 5 | Written, but publish failed |

## Non-goals

- No new capture features. No retries, no video, no PDF.
- No remote state or daemon. Each run is one process.
- No login logic in browsershot. authstate stays the only login path.
- No config file beyond the `.browsershot/config.json` profile.

## Code changes

| File | Change |
|---|---|
| `src/mock.ts` | Delete |
| `test/mock.test.ts` | Delete |
| `src/capture.ts` | Remove mock import, `mocks` field, `applyMocks` call. Remove `width`, `height`, `scale`, `wait`, `timeout` option fields. Hardcode viewport 1440x900, scale 2, `load`, 30000 ms in the capture path. |
| `src/cli.ts` | Rewrite HELP with the three tiers above. Remove the ten removed options from `parse()`. Delete `WAIT_EVENTS` and `PRESETS`. Implement optional-value `--publish` parsing and the destination resolution order. Remove removed-flag wiring from `main()`. Update the `--verbose` description (no mock hits). |
| `src/profile.ts` | Add `publish` to `CONFIG_KEYS` and `ProfileConfig`. |
| `src/exit-codes.ts` | Delete `EXIT_CAPTURE_ERROR`. Renumber `EXIT_WRITE_ERROR` to 4 and `EXIT_PUBLISH_ERROR` to 5. |
| `src/annotate.ts`, `src/act.ts`, `src/inspect.ts`, `src/publish.ts`, `src/authstate.ts`, `src/credentials-discovery.ts`, `src/workspace.ts`, `src/open.ts`, `src/landing.ts` | No changes. |

## Docs changes

- `README.md`. Rewritten. Quick capture first, then prove it, then auth and
  publish. Every removed flag and its alternatives gone.
- `AGENTS.md`. Mocking section deleted. `--cookies` recipes and pitfall rows
  deleted. Exit code table updated to the new set. Publish key recipe added.
  Golden rules keep their meaning with jar-piping advice removed.

## Test changes

- Delete `test/mock.test.ts`.
- `test/cli-exit-codes.test.ts`. New numbers for write error (4) and publish
  error (5). Dead 4 assertion removed.
- `test/profile.test.ts`, `test/profile-cli.test.ts`. `publish` key accepted
  and round-tripped through `config set` / `unset` / `show`.
- `test/cli.test.ts`, `test/cli-e2e.test.ts`. Removed-flag references dropped.
  New cases: bare `--publish` resolves the profile key, bare `--publish`
  without a key exits 2, explicit `--publish <dest>` overrides the key.
- `test/capture.test.ts`, `test/capture-runtime.test.ts`. Option fields that
  no longer exist are removed from test inputs. Guard behavior assertions
  stay.
- `test/no-orphans.test.ts` and the rest updated only if they reference
  deleted files or flags.

## Verification plan

Built binary, real captures, evidence in chat as paths plus asserted text.

1. `bun test` green.
2. `npm run build`, then bare `browsershot https://example.com` writes the
   PNG and prints path plus sha256.
3. `config set url https://example.com` then `browsershot` quick-path
   capture works.
4. `--inspect 'body'` run asserts through the JSON sidecar.
5. `--expect-text` miss exits 1. Unknown flag exits 2. Publish failure
   without an rclone remote exits 5 with the new code.
6. `--auth` behavior stays covered by `test/authstate.test.ts` and
   `test/credentials-discovery.test.ts` against the fixture credentials. No
   live app exists in this repo so the real login flow is not browser
   verified here. That limit is stated, not hidden.

## Risks and tradeoffs

- `--mock` removal loses the flag-flip evidence workflow. Accepted in
  brainstorming. It can return as an add-on if a real workflow misses it.
- `--cookies` removal loses the hand-produced jar path. authstate discovery
  plus `--auth-credentials` covers every in-tree use.
- Hardcoded timeout means no escape hatch for very slow pages beyond the
  30s default failing visibly.
- Renumbering exit codes breaks any caller that branches on the old 5/6.
  The tool is unpublished, so the blast radius is this repo's own docs and
  tests.
