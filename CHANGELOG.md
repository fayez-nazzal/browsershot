# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versioning follows [SemVer](https://semver.org). Releases before this changelog are not documented here.

## [Unreleased]

### Added

- Quick routes support explicit hash-router paths such as `#/settings`, replacing
  the saved base URL's fragment route. Quote the route in shells so `#` is
  passed as an argument.
- Directional scroll actions automatically record one WebM from navigation through the final action, including when `--duration` is omitted. Positive `--duration <ms>` also selects WebM and adds an observation window after actions and inspection. `duration` is a positive-integer saved setting; an explicit `--duration 0` disables saved duration but not automatic scroll video. Generated outputs use `.webm`; explicit or saved exact output paths must end in `.webm`.
- `--act` accepts repeatable flags combined into one ordered serial chain; each action begins after page load/render readiness and finishes before the next. `scroll:<CSS selector>` scrolls the first attached match into view. Directional scrolls accept `up|down|left|right(<positive px or %>)`, send wheel input with the pointer at viewport center, and animate at configurable `scrollSpeed` (default 1000 CSS pixels per second). Save or override with `config set scrollSpeed <px/s>` or `--scroll-speed <px/s>`. Video supports `--inspect` as JSON element data without an image overlay and cannot be combined with image-only options.

- `--html` captures self-contained, minimal HTML instead of a PNG for URL, `page`, and `library` captures: the element (or page body), the `<html>`/`<body>` shell, and only the CSS rules that apply, with media queries resolved at the capture size and theme. `--format` pretty-prints it. The file is `<name>.html`, stdout is the HTML, and `--json` results carry a new `html` field (`null` for PNG or WebM captures). `html` and `format` are saved settings; `--no-html` and `--no-format` disable them for one run. `--html` cannot be combined with `--box`, `--marker`, `--inspect-note`, `--publish`, or `--full-page`.
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
- `--platform macos|windows|linux` emulates the desktop user agent and
  platform client hints for PNG, HTML, and video captures. It does not provide
  native desktop APIs or host capabilities.

### Fixed

- Full-page captures of internally scrolling layouts preserve document width when
  expansion introduces a vertical scrollbar, preventing content at the right edge
  from being clipped.

- Headless captures preserve horizontal and vertical scrollbars instead of hiding
  them with Playwright's default `--hide-scrollbars` flag.
- Viewport dimensions must be positive safe integers, so `--size 0x0` is a
  usage error rather than a browser failure.
- Named authenticated captures now select Authstate entries with `--purpose`
  rather than the unsupported `--user` flag.
- Documented human Google/SSO login followed by passwordless session reuse.

- `--act` always waits for the render guard, even when `--allow-blank` is set.

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
