# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versioning follows [SemVer](https://semver.org). Releases before this changelog are not documented here.

## [1.0.0] - 2026-09-02

### Changed

- `browsershot` captures a web page to a PNG. Every run loads the page headless in the bundled Chromium headless shell.
- `browsershot <url-or-path>` with zero flags is the normal thing. Everything else is opt-in.
- One browser launch path. There is no Google Chrome fallback and no `--headed` mode.
- Capture defaults are hardcoded: viewport 1440x900 at 2x, wait event `load`, navigation timeout 30s.

### Added

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
