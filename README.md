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

`config set` saves project defaults; `config unset` removes a setting. Boolean settings are set without a value. Delay is saved as a positive integer in milliseconds:

```sh
browsershot config set delay 3000
```

```sh
browsershot config set json
browsershot config set expectElement '#app'
browsershot config show
browsershot config unset expectElement
browsershot config path
```

Canonical settings are `baseUrl`, `authUser`, `authRedirect`, `expectElement`, `expectText`, `element`, `output`, `group`, `label`, `json`, `autoOpen`, `withErrors`, `delay`, and `publish`. Accepted aliases are `base-url`, `url`, `auth-user`, `auth-redirect`, `expect-element`, `expect-text`, `auto-open`, and `with-errors`. Legacy JSON `url` is read as `baseUrl`; reads do not rewrite or create the workspace, and explicit writes use canonical names. `browsershot config set withErrors` enables error collection for captures by default. Saved delay applies when `--delay` is omitted; an explicit `--delay` wins.

Flags override saved defaults. Per-run disabling flags include `--no-auth`, `--no-auth-redirect`, `--no-expect`, `--no-element`, `--no-json`, `--no-with-errors`, and `--no-auto-open`. Positive and negative flags for the same setting conflict. Explicit `--expect-text` or `--expect-element` replaces the entire saved expectation set; both explicit checks must pass when both are supplied. `--no-expect` disables content assertions, not HTTP or blank-page guards.

Routes beginning with `/` append to the saved base path, including hash routes. Invalid saved configuration blocks full URLs as well as short routes.

</details>

<details>
<summary>Saved pages — capture a known view by name</summary>

A page remembers where a view lives, what must happen before the shot, and which parts of it are worth capturing. Capture one by name, optionally naming a saved element and a saved setup:

```sh
browsershot page checkout
browsershot page checkout summary
browsershot page checkout summary --setup empty
```

Definitions are written once and then reused:

```sh
browsershot page add checkout /checkout --auth-user member --expect-element '#checkout-ready'
browsershot page element checkout summary '#order-summary'
browsershot page setup checkout empty /checkout?cart=empty
browsershot page list
browsershot page show checkout
browsershot page remove checkout summary
```

`page add` stores a route or complete URL together with `--auth-user`, `--auth-redirect`, `--expect-element`, `--expect-text`, `--act`, and `--size` as that page's defaults; a stored route beginning with `/` resolves against the saved `baseUrl` when the capture runs, exactly like a quick capture. `page element` gives a CSS selector a name. `page setup` stores the same six settings under a name and may restate the route when the state lives in the URL. `page remove` deletes the page, or only the element or setup named after it.

Page, element, and setup names match `[a-z0-9][a-z0-9_-]*`, and `add`, `element`, `setup`, `list`, `show`, and `remove` are reserved words that no name may use. Registering a name that already exists is a usage error; remove it first. An unknown page, element, or setup name is a usage error that lists the known names for that scope. Definitions live in `.browsershot/pages.json`, beside the project config.

A run starts from the page's defaults, replaces them with the values of a `--setup`, and lets per-run flags win over both; `--act` steps run in that same order, page first, then setup, then per-run. A named element supplies the element selector, `--element` replaces it with a literal selector for one run, and `--no-element` captures the whole page instead.

The default path is `.browsershot/captures/{page}/{element|page}[_{setup}]_{timestamp}.png`, without the `_q-{query}` segment, because the name rather than the URL identifies the capture. `--group`, `--label`, and `--output` behave as they do for any capture, and `captured` in a JSON result reports the page with the element and setup names the run used.

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
<summary>Component libraries — capture one example by name</summary>

A library is a running component environment — a Storybook or Ladle server you already started — that Browsershot reads through that environment's own catalog. Register it once, then capture any example by name:

```sh
browsershot library add ui http://localhost:6006 --plugin storybook
browsershot library ui button--primary
```

Definitions live in `.browsershot/libraries.json`. The management commands print JSON on stdout:

```sh
browsershot library list
browsershot library list ui
browsershot library show ui
browsershot library refresh ui
browsershot library remove ui
```

`list` without a name prints the saved definitions, and `list <library>` prints the known entries, fetching the catalog when nothing is cached. `show` prints one definition, `refresh` refetches the catalog, and `remove` drops the definition together with its cached catalog. Library names match `[a-z0-9][a-z0-9_-]*`; `add`, `list`, `show`, `refresh`, and `remove` are reserved; the base address must be absolute; and re-registering an existing name fails until that name is removed.

Built-in plugins are `storybook` and `ladle`. A file at `.browsershot/plugins/<name>.json` describes another environment, or replaces a built-in of the same name:

```json
{
  "version": 1,
  "name": "storybook",
  "discover": {
    "http": { "path": "/index.json" },
    "entries": "entries",
    "filter": { "type": "story" },
    "id": "id",
    "group": "title",
    "label": "name"
  },
  "address": "/iframe.html?id={id}&viewMode=story",
  "ready": "#storybook-root"
}
```

A plugin is data; nothing in it is executed. `discover` states exactly one of `http` (a `path` joined to the library's base address, or a complete `url`) or `files` (a `glob` with an optional `root`). `entries` is a dotted path to the catalog's array or object map, `id`, `group`, and `label` are dotted paths inside one entry where `$key` means the map key, and `filter` keeps entries whose fields equal the listed values. `address` is a template over `{base}`, `{id}`, `{group}`, and `{label}`; an unknown placeholder is an error. `ready` is the selector that proves the example rendered. Optional `scope` narrows the shot when one address renders more than the wanted example, and optional `auth` names a header and an environment variable, such as `{"header": "Authorization", "valueFrom": "env:CATALOG_TOKEN"}`. Only `env:` references are accepted: the value is read when the catalog is fetched and is never written into the workspace.

`--ready` and `--scope` on `add` replace the plugin's selectors for one library. Use the environment's own selectors in place of these:

```sh
browsershot library add design http://localhost:61000 --plugin ladle --scope '#preview' --ready '#preview .rendered'
```

An entry name matches the catalog `id` exactly, or else `group/name` or the name alone, case-insensitively. Several matches are a usage error listing the candidates; no match is chosen silently. A name that matches nothing refetches the catalog once and retries, so an example added moments ago is capturable without a manual refresh. Catalogs cache at `.browsershot/cache/<library>.json` and do not expire.

The default path is `.browsershot/captures/{library}/{entry}_{timestamp}.png`, with no query segment; `--group`, `--label`, and `--output` behave as they do for any capture. A scoped library captures that element, so it cannot be combined with `--full-page`; `--no-element` captures the whole page instead.

Unknown library, unknown entry, ambiguous entry, a malformed libraries or plugin file, and `--plugin`, `--ready`, or `--scope` outside `library add` are usage errors (exit `2`); an unknown library lists the known libraries and an ambiguous name lists the candidates. An unreachable catalog exits `1`, naming the library and the address tried. A catalog that rejects the credentials, or an environment variable that is unset, exits `3`, naming that variable.

Histoire has no built-in description, because its single-variant URL form is unconfirmed and a guessed address would capture the wrong thing. Save a page pointing at the variant's URL instead.

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

`--with-errors` collects browser console errors and uncaught page exceptions during the capture, including readiness, actions, inspection, and screenshot preparation. It writes `<png basename>.console.json` beside the PNG, such as `capture.console.json`; for an explicit non-`.png` output, the final extension is replaced with `.console.json`. Warnings, informational console messages, and failed requests are excluded.
Repeat `--box x,y,w,h[,color]` and `--marker x,y[,color]` for coordinate evidence. Coordinates use post-scale PNG pixels and a top-left origin. These annotations require macOS because they use `osascript`.

Successful `--json` output has these fields:

| Field | Meaning |
| --- | --- |
| `outputPath` | Absolute PNG path |
| `bytes` | PNG byte count |
| `sha256` | PNG SHA-256 digest |
| `inspectJsonPath` | Inspection sidecar path, or `null` |
| `consoleErrorsJsonPath` | Console-error sidecar path, or `null` |
| `consoleErrors` | Collected console and page errors when enabled, or `null` |
| `inspected` | Inspection result, or `null` |
| `publishedUrl` | Public URL, or `null` |
| `captured` | What the run captured: `{"kind": "url"}` for an ad-hoc capture, or the saved page or library entry identity |

With `--json`, exactly one object is emitted on stdout and successful captures emit no human diagnostics on stderr; when error collection is enabled, `consoleErrors` is included inline. Without JSON, human diagnostics use stderr, formatted collected errors are printed there, and the absolute PNG path remains first on stdout. Successful publishing additionally prints a Markdown embed. JSON success is emitted only after requested sidecar and publishing work succeeds.

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
<details>
<summary>Network observability</summary>

Use explicit category flags: `--with-resources`, `--with-api` (XHR and Fetch), and `--with-websockets`; each has a matching `--no-*` override. Saved booleans are `withResources`, `withApi`, and `withWebsockets`. Nothing is collected unless a category is enabled.

Enabled captures add `networkObservability` and `networkObservabilityJsonPath` to JSON and write `<png-basename>.network.json`. HTTP records preserve individual attempts, child-frame attribution, resource type, request data, response status, delivery source (`network`, `cache`, `service-worker`, or `unknown`), outcome (`completed`, `failed`, `aborted`, or `pending`), and elapsed plus ISO-8601 UTC timestamps. WebSockets include lifecycle and bounded message direction/type/size/timing, never contents. The cutoff marker is taken immediately before full-page or element screenshot capture.

Known-sensitive header names and URL/query/body locations are replaced with `[REDACTED]` (authorization, cookies, proxy credentials, API keys, tokens, secrets, and password-like names). This baseline cannot detect every secret. Limits are 1,000 HTTP/WebSocket records, 200 messages per socket, and 8,192 characters per field; truncation counters and collection diagnostics remain visible and do not fail a valid screenshot. Human mode keeps the PNG path first on stdout and reports the sidecar on stderr. JSON emits only after sidecar writing succeeds.

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
