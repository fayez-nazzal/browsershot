# browsershot

Capture a page to a PNG from one command. Install the binary and Chromium once:

```sh
bun install && bun playwright install chromium
bun run build && bun link
```

## Capture a page

Use a complete URL without project setup:

```sh
browsershot https://example.com/pricing
```

For a route, save the application base URL in the current directory:

```sh
browsershot config set baseUrl https://example.com
browsershot /pricing
```

The config is `.browsershot/config.json` in the current directory. A quick path is appended to the saved URL, including hash routes. A complete URL always uses itself and never gets prefixed by the saved base. `http://`, host shorthand, and existing file URL behavior remain supported.

The default output is an absolute path under `.browsershot/captures/<timestamp>.png`. Use `-o, --output <path>` for a different file, `--size WxH`, `--full-page`, or `--delay <ms>` when needed.

## Save defaults and override one capture

Supported saved settings are `baseUrl`, `authUser`, `expectElement`, `expectText`, `output`, `json`, `autoOpen`, and `publish`:

```sh
browsershot config set expectElement '#header'
browsershot config set authUser member
browsershot config set json
browsershot config show
browsershot config unset expectElement
```

For one capture, use `--auth-user`, `--auth-credentials`, `--auth`, `--no-auth`, `--expect-text`, `--expect-element`, `--no-expect`, `--output`, `--json`, `--no-json`, `--auto-open`, and `--no-auto-open`. Explicit assertion flags replace the saved assertion set. If both text and element assertions are present, both must pass. `--no-expect` disables only content assertions; HTTP status and blank-render guards remain active.

`--expect-element` waits up to 10 seconds for the first matching CSS element to be visible before actions run. The first match is used, so prefer a specific selector. Positive and negative flags for one concern are usage errors.

The legacy config key `url` and kebab-case names such as `base-url`, `auth-user`, `expect-text`, `expect-element`, and `auto-open` are accepted. Reads normalize `url` to `baseUrl` in memory without rewriting the file; explicit config writes use canonical names.

## Actions and checks

Actions run after readiness and before inspection and the screenshot:

```sh
browsershot https://example.com/dashboard \
  --act 'click:#menu' \
  --inspect '#menu' --inspect-attr aria-expanded --json
```

`--inspect` records the first matching element and writes a JSON sidecar. `--inspect-attr` reports the attribute; it does not assert a required value. With `--json`, stdout contains one object with the stable fields `outputPath`, `bytes`, `sha256`, `inspectJsonPath`, `inspected`, and `publishedUrl`. Without it, the absolute output path is the first stdout line. Diagnostics are on stderr. Check the JSON or sidecar and never read PNG bytes into agent context.

`--expect-text` is a case-sensitive pre-action body-text check. `--allow-status` allows non-success HTTP responses, and `--allow-blank` allows sparse pages. Guard failures exit `1`; usage errors exit `2`.

## Authentication and publishing

`--auth` discovers `.testing-credentials.yaml` and uses `authstate` to create a storage-state jar. `--auth-user` implies `--auth`; `--auth-credentials` selects the credentials file. Credentials and jar paths are never saved in the profile.

```sh
browsershot https://example.com/account --auth --auth-user member --json
```

Save a publish destination or provide it for one run:

```sh
browsershot config set publish gdrive:shots/my-repo/my-branch/
browsershot /pricing --publish
browsershot /pricing --publish gdrive:other/dir/
```

Publishing keeps ownership with the existing `rclone` integration. A publish failure after writing the PNG exits `5` and keeps the file.

See `browsershot --help` for the complete flag list. Agents can use the short workflow in [`AGENTS.md`](AGENTS.md) and the installed [`skills/browsershot/SKILL.md`](skills/browsershot/SKILL.md).

## License

MIT. See [`LICENSE`](LICENSE).
