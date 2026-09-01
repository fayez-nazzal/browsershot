# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versioning follows [SemVer](https://semver.org). Releases before this changelog are not documented here.

## [2.0.0] - 2026-09-02

### Added

- Quick capture profiles: save a base URL once with `config set url`, then capture any route with `browsershot /route`. Saved `auth-user`, `expect-text`, `output`, `json` and `auto-open` settings apply to every run.
- One-flag authenticated captures: `--auth` discovers `.testing-credentials.yaml`, asks `authstate` for the jar and captures signed in. `--auth-user` picks an account, `--auth-credentials` names the file explicitly.
- `--verbose` for detailed Playwright progress on stderr: phase timings, failed requests, console errors and mock hits.
- Headless captures run on the bundled Chromium headless shell first and report the selected runtime; installed Google Chrome stays as the fallback.
- `.browsershot/tmp/` as the home of all transient work: compare and evidence HTML, GIF video and frame files, annotation scratch PNGs. Each run gets its own directory, removed when the run exits. Run directories left behind by a killed process are swept on the next run once they are older than a day.
- A generated `.browsershot/.gitignore`, so git ignores the whole directory without browsershot ever touching `.git/info/exclude`.

### Changed

- `browsershot` is fully stateless. The working directory's `.browsershot/` folder is the only thing it reads and writes, and it is created on every invocation.
- Anchoring is the working directory. There is no walk-up to a Git root anymore, and every feature now works outside a Git repository.
- The default output is `.browsershot/captures/<timestamp>.png`. The old `~/browsershot` fallback is gone; captures never land in your home directory.

### Removed

- `findProjectRoot` and its `no project root found` error path.
- Every write to `.git/info/exclude`. An existing `.browsershot/` line there is harmless and can stay.
