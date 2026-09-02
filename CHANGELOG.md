# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versioning follows [SemVer](https://semver.org). Releases before this changelog are not documented here.

## [1.0.0] - 2026-09-02

### Changed

- `browsershot` captures a web page to a PNG. Every run loads the page headless in the bundled Chromium headless shell.
- One browser launch path. There is no Google Chrome fallback and no `--headed` mode.

### Removed

- GIF recording and the `--gif` flag. `gifPath` is gone from the JSON contract and `--publish` embeds PNG only.
- Google Chrome as a launch target, headless or headed.
- Version history before this release.
