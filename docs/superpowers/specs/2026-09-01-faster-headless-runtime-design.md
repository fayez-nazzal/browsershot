# Faster Headless Runtime Design

## Goal

Reduce fixed startup cost for headless captures while preserving authenticated quick capture and every existing capture feature.

## Decision

Use the Playwright Chromium headless shell as the first runtime for headless captures. Use full Chrome for headed captures. Fall back once to full Chrome when the headless shell cannot launch.

The existing page pipeline stays unchanged. The runtime choice belongs to the browser launch boundary in `src/capture.ts`.

## Invariants

- Auth jars remain loaded through Playwright storage state.
- Actions. Mocks. Inspection. Full-page screenshots. PNG output. And GIF recording keep their current behavior.
- A page failure never triggers a second capture.
- A browser launch failure may trigger one full Chrome retry.
- The default Chrome profile is never used.
- No credentials or auth jars are copied into a shared profile.
- The runtime used is visible in verbose logs.

## Failure behavior

Headless captures try the bundled headless shell first. If that launch fails then the capture retries with full Chrome. If both launches fail then the original launch error remains actionable.

The fallback does not apply after navigation. Render. Action. Inspection. Screenshot. Or GIF failures.

## Verification

Unit tests prove runtime selection and fallback. Existing end-to-end tests prove authenticated storage state. SPA rendering. Viewport dimensions. Full-page output. And output hashes. A real local benchmark compares the old full Chrome path with the new headless shell path.

## Out of scope

Project asset caching. Persistent browser data. Background browser processes. Batch capture. And a new public runtime flag.
