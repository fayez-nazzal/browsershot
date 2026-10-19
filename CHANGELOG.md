# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versioning follows [SemVer](https://semver.org). Releases before this changelog are not documented here.

## [Unreleased]

### Added

- The `size` profile key. `browsershot config set size 360x520` saves a project
  viewport; `--size` and saved page or setup sizes keep precedence.
- `browsershot open [<url-or-path>]` opens a headed Chromium window on a
  persistent profile in `.browsershot/browser/`. With no argument it opens the
  saved `baseUrl`, and the saved `size` sets the viewport. Cookies, sign-ins,
  and localStorage persist between runs. Closing the window or pressing Ctrl-C
  finishes the command with the profile flushed. Closing also saves the
  profile's cookies and localStorage to `.browsershot/open-state.json`, and
  captures start from that snapshot, so a theme or sign-in set by hand shows up
  in screenshots. Captures stay headless and isolated; `--no-auth` ignores the
  snapshot, and the authstate jar wins over it.
  With a saved `authUser`, the authstate jar for that user is applied before the
  page loads, as captures do.
- `--theme <name>` renders a theme. Library entries send the name through the plugin's `theme` template (built-in `storybook`: `globals=theme:<name>`). URL and page captures accept `light` or `dark`, which set `prefers-color-scheme`; other names are usage errors for them. A plugin without a `theme` template rejects `--theme` before the catalog is fetched.
- `config set theme <name>` saves a default theme, `config unset theme` removes it, and `--theme` overrides it per run. The saved default is best effort: library entries use it when the plugin declares a `theme` template, and URL and page captures use it only for `light` or `dark`.

### Fixed

- Viewport dimensions must be positive safe integers, so `--size 0x0` is a
  usage error rather than a browser failure.
- Named authenticated captures now select Authstate entries with `--purpose`
  rather than the unsupported `--user` flag.
- Documented human Google/SSO login followed by passwordless session reuse.

## [1.0.0-alpha] - 2026-09-02

### Changed

- `browsershot` captures a web page to a PNG. Every run loads the page headless in the bundled Chromium headless shell.
- `browsershot <url-or-path>` with zero flags is the normal thing. Everything else is opt-in.
- One browser launch path. There is no Google Chrome fallback and no `--headed` mode.
- Capture defaults are hardcoded: viewport 1440x900 at 2x, wait event `load`, navigation timeout 30s.

### Added
- Element-only screenshots via `--element` and the saved `element` setting,
  with `--no-element` for one-run overrides.

- The `publish` profile key and bare `--publish`, which resolves the saved rclone destination. An explicit `--publish <dest>` value overrides it.

### Removed

- GIF recording and the `--gif` flag. `gifPath` is gone from the JSON contract and `--publish` embeds PNG only.
- Google Chrome as a launch target, headless or headed.
- The `--mock` flag and request interception.
- The `--html-class` theme forcing flag.
- The `--stdout` flag. Read the output path or use `--json`.
- The `--preset`, `--width` and `--height` flags. `--size WxH` is the only sizing form.
- The `--scale` flag. Captures are always 2x (retina).
- The `--wait` and `--timeout` flags.
- The `--cookies` flag. `authstate` through `--auth`, `--auth-user` and `--auth-credentials` is the single login path.
- Version history before this release.
