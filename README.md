# browsershot

Capture a web page as a PNG, from one command.

```sh
browsershot https://example.com
```

By default, stdout contains the absolute PNG path. Add `--json` for a structured result.

- Capture whole pages or individual components.
- Interact with a page and inspect the resulting UI state.
- Save project defaults and produce JSON for scripts or coding agents.

[Get started](#get-started) · [Everyday captures](#everyday-captures) · [Reference](#reference) · [Development](#development)

## Get started

You need [Bun](https://bun.sh) and Git. This source installation uses a macOS/Linux shell:

```sh
git clone https://github.com/fayez-nazzal/browsershot.git
cd browsershot
bun install --frozen-lockfile
bunx playwright install chromium
bun run build
export PATH="$PWD/dist:$PATH"
browsershot https://example.com
```

The export makes the compiled command available in the current terminal without installing a global package or changing another project's dependencies. In a new terminal, repeat the export from the checkout, or add the checkout's absolute `dist` directory to your shell PATH.

The PNG is written under `.browsershot/captures/example.com/`; its absolute path is printed on stdout. `.browsershot` is relative to the directory where the command runs. Add `--auto-open` to open the image in the platform viewer.

On Linux, use `bunx playwright install --with-deps chromium` when browser OS dependencies are needed. That command can require administrator privileges.

## Everyday captures

Run from the app's directory with its server already running. Replace the example port, routes, and selectors with the app's own:

```sh
browsershot config set baseUrl http://localhost:3000
browsershot /pricing
```

Settings live in `.browsershot/config.json` in this directory. A complete URL uses itself instead of the saved base.

| Task | Command |
| --- | --- |
| Full page | `browsershot /pricing --full-page` |
| Narrow viewport | `browsershot /pricing --size 390x844` |
| One component | `browsershot /dashboard --element '#main-card'` |
| Grouped evidence | `browsershot /pricing --group PR-123 --label desktop` |

`--size` changes the viewport; it does not emulate a device. `--element` and `--full-page` cannot be combined. Use `--no-element` to override a saved element selector.

A grouped capture has an illustrative shape such as `.browsershot/captures/PR-123/localhost-3000/pricing_desktop_<timestamp>.png` (the timestamp is omitted here). Host and other path values are made safe, so `localhost:3000` becomes `localhost-3000`.

## Capture UI state

Use readiness checks before interaction and inspection after it:

```sh
browsershot /dashboard \
  --expect-element '#dashboard' \
  --act 'click:#menu' \
  --inspect '#menu' \
  --inspect-attr aria-expanded \
  --json
```

The order is **readiness → actions → inspection → screenshot**. `--inspect-attr` reports and highlights an attribute; it does not assert its value. A script can check `inspected.attributes["aria-expanded"] === "true"`. Inspection also creates a JSON sidecar beside the PNG.

For agents, use JSON and sidecar fields for programmatic checks and the screenshot for visual review. Do not put raw PNG bytes in text context. See the bundled [`AGENTS.md`](AGENTS.md) and [`skills/browsershot/SKILL.md`](skills/browsershot/SKILL.md) for operational recipes.

## Reference

Run `browsershot --help` for the complete flag list and `browsershot --version` for the version.

<details>
<summary>Saved defaults and one-run overrides</summary>

`config set` saves project defaults; `config unset` removes a setting. Boolean settings are set without a value:

```sh
browsershot config set json
browsershot config set expectElement '#app'
browsershot config show
browsershot config unset expectElement
browsershot config path
```

Canonical settings are `baseUrl`, `authUser`, `authRedirect`, `expectElement`, `expectText`, `element`, `output`, `group`, `label`, `json`, `autoOpen`, and `publish`. Accepted aliases are `base-url`, `url`, `auth-user`, `auth-redirect`, `expect-element`, `expect-text`, and `auto-open`. Legacy JSON `url` is read as `baseUrl`; reads do not rewrite or create the workspace, and explicit writes use canonical names.

Flags override saved defaults. Per-run disabling flags include `--no-auth`, `--no-auth-redirect`, `--no-expect`, `--no-element`, `--no-json`, and `--no-auto-open`. Positive and negative flags for the same setting conflict. Explicit `--expect-text` or `--expect-element` replaces the entire saved expectation set; both explicit checks must pass when both are supplied. `--no-expect` disables content assertions, not HTTP or blank-page guards.

Routes beginning with `/` append to the saved base path, including hash routes. Invalid saved configuration blocks full URLs as well as short routes.

</details>

<details>
<summary>Filenames and templates</summary>

The default path is `.browsershot/captures/{host}/{route}_{timestamp}.png`; a query adds `_q-{query}`. `--group` inserts safe relative directories before the host, and `--label` adds one safe filename segment. Values are sanitized and shortened as needed.

The six placeholders are `{host}`, `{route}` (or `home`), `{query}` (parameter names plus a 12-hex fingerprint, never plaintext query values), `{date}`, `{time}`, and `{timestamp}`. Dates and times are local. The fingerprint identifies rather than encrypts; use a label for readable state.

Hash fragments beginning with `/` supply the logical route and query. Ordinary anchors are ignored. Unknown placeholders fail before capture, while `{{` and `}}` escape literal braces.

For an exact destination:

```sh
browsershot /pricing --output '/tmp/{host}/{route}_{timestamp}.png'
```

An explicit output is the expanded path; it does not promise to append `.png`. Explicit `--output` cannot accompany explicit `--group` or `--label` and overrides saved naming. Explicit group or label selects structured naming instead of saved output. Saved `output` cannot coexist with saved group or label.

</details>

<details>
<summary>Readiness, actions, inspection, and output</summary>

The default viewport is `1440x900` at 2× scale. Navigation waits for the load event with a 30-second timeout; `--delay <ms>` adds settling time.

`--expect-element` waits up to 10 seconds for the first matching CSS element to be visible, not necessarily unobscured or in the viewport. `--expect-text` checks for a case-sensitive substring in body text. `--element` captures the first matching visible element.

HTTP and blank-render guards catch common false captures. Override them with `--allow-status` and `--allow-blank` when intentional. HTTP 401/403 remain authentication failures even with `--allow-status`, because the authentication check runs first. A render guard is not proof that the intended UI is correct.

Actions are per-run and use semicolon-separated `kind:value` steps. Supported kinds are `focus`, `click`, `hover`, `press`, `type`, and `wait` (milliseconds):

```sh
browsershot /settings --act 'focus:#name;type:Ada;press:Tab;wait:300'
```

`--inspect` records the first matching element. `--inspect-attr` highlights an attribute, `--inspect-json <path>` chooses the sidecar path, and `--inspect-note <text>` adds a note. A final hover can add a cursor/link preview.

Repeat `--box x,y,w,h[,color]` and `--marker x,y[,color]` for coordinate evidence. Coordinates use post-scale PNG pixels and a top-left origin. These annotations require macOS because they use `osascript`.

Successful `--json` output has these fields:

| Field | Meaning |
| --- | --- |
| `outputPath` | Absolute PNG path |
| `bytes` | PNG byte count |
| `sha256` | PNG SHA-256 digest |
| `inspectJsonPath` | Inspection sidecar path, or `null` |
| `inspected` | Inspection result, or `null` |
| `publishedUrl` | Public URL, or `null` |

With `--json`, exactly one object is emitted on stdout; human diagnostics use stderr. Without JSON, the absolute PNG path is first on stdout, and successful publishing additionally prints a Markdown embed. JSON success is emitted only after requested sidecar and publishing work succeeds.

Exit codes: `0` success; `1` capture or page-guard failure; `2` usage, conflicting flags, or invalid config; `3` Authstate or credentials environment failure; `4` PNG written but sidecar failed; `5` PNG written but publishing failed. In the last two cases the PNG remains and there is no successful JSON result.

</details>

<details>
<summary>Authenticated pages — optional Authstate setup</summary>

[Authstate](https://github.com/fayez-nazzal/authstate) handles installation and credential setup. Browsershot delegates login rather than implementing it. Named users require an Authstate executable supporting `ensure --user`.

```sh
browsershot /account --auth-user member
```

`--auth-user` and `--auth-credentials <path>` imply `--auth`; user names are keys in `.testing-credentials.yaml`. Discovery searches upward from the invocation directory and stops at the repository boundary. Credential and storage-state paths are not saved in the Browsershot profile; keep these files private. `--no-auth` disables saved authentication.

When authentication is requested, a 401/403 triggers one session verification and retry. `--auth-redirect /users/sign_in` opts into the same treatment for a redirect URL containing that literal text. Save it with `config set authRedirect /users/sign_in`, or disable it for one run with `--no-auth-redirect`. No redirect matching is implicit.

</details>

<details>
<summary>Publishing — optional rclone setup</summary>

Publishing requires `rclone`, `curl`, and a configured Google Drive remote. Run `rclone config` to configure it. Publishing produces a public image URL, so do not publish sensitive captures.

```sh
browsershot config set publish gdrive:shots/my-project/
browsershot /pricing --publish
```

An explicit destination wins:

```sh
browsershot /pricing --publish gdrive:other/dir/
```

Bare `--publish` needs a saved destination and otherwise fails before capture. Saving `publish` alone does not upload every capture. `--publish-size <px>` sets embed width and `--publish-label <text>` sets alt text. The PNG remains on a publishing failure (exit `5`).

</details>

## Help

| Symptom | Next step |
| --- | --- |
| Command not found | Repeat the PATH export from the checkout, or use the absolute compiled binary path. |
| Missing Chromium | Run `bunx playwright install chromium` from the checkout; on Linux, see the OS-dependency note above. |
| Short route fails | Set `baseUrl` in the app directory; inspect `config path` and `config show`. |
| Invalid saved config | Use `config path` and repair the reported file. `config unset` cannot bypass malformed JSON. |
| Unexpected page or state | Check that the app is running and selectors/auth are correct; use `--verbose` for diagnostics rather than routinely disabling guards. |

If something still looks wrong, [open an issue](https://github.com/fayez-nazzal/browsershot/issues) with the version, command, and error, but never credentials. Use [`SECURITY.md`](SECURITY.md) for private vulnerability reports.

## Development

For the clone, Bun dependency install, and matching Chromium download, follow [Get started](#get-started). The following commands run from the Browsershot checkout:

```sh
bun run start --help
bun run start https://example.com --json
bun test
bun run build
./dist/browsershot --help
```

`start` executes `src/cli.ts` directly, so source edits need no compilation for a source run. `bun test` includes unit tests and real Chromium-backed CLI tests; fixtures use local HTML and local HTTP servers, not live Authstate credentials or a configured cloud remote. `build` writes the locally compiled `dist/browsershot`; rerunning it refreshes that binary.

CI adds `--with-deps` on Linux, then builds and tests. Code map: `src/cli.ts` is the entry point and help, `src/` contains capture/runtime modules, and `test/` contains tests. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution conventions.

## License

MIT. See [`LICENSE`](LICENSE).
