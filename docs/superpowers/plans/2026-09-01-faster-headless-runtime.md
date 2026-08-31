# Faster Headless Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task by task.

**Goal:** Use the Chromium headless shell first for headless captures and preserve a full Chrome fallback.

**Architecture:** Isolate runtime selection at the browser launch boundary in `src/capture.ts`. Keep the existing Playwright page pipeline and capture contract unchanged.

**Tech Stack:** Bun. TypeScript. Playwright. Bun test.

**Spec:** `docs/superpowers/specs/2026-09-01-faster-headless-runtime-design.md`

## Global Constraints

- Keep authenticated storage state support through Playwright.
- Keep actions. Mocks. Inspection. Full-page screenshots. PNG output. And GIF recording.
- Retry only browser launch failures.
- Do not add a public runtime flag.
- Do not add a dependency.
- Do not use the regular Chrome user profile.

---

### Task 1. Define the launch result and test seams

**Files:**

- Modify `src/capture.ts`
- Test `test/capture-runtime.test.ts`

**Interfaces:**

- Produce a launch result with `browser` and `runtime`.
- Use runtime names `chromium-headless-shell` and `chrome`.
- Keep `Session` internal and add the selected runtime to it.

- [ ] Write a failing unit test that asserts a headless launch result names `chromium-headless-shell`.
- [ ] Run `bun test test/capture-runtime.test.ts` and verify the test fails because the runtime seam does not exist.
- [ ] Add the smallest injected launch dependency needed to test browser selection without starting Chrome.
- [ ] Run `bun test test/capture-runtime.test.ts` and verify it passes.
- [ ] Commit with `test: add headless runtime launch coverage`.

### Task 2. Prefer the headless shell and fall back to full Chrome

**Files:**

- Modify `src/capture.ts`
- Test `test/capture-runtime.test.ts`

**Interfaces:**

- Headless launch tries `chromium.launch({ headless })` first.
- Failed headless launch tries `chromium.launch({ headless, channel: "chrome" })` once.
- Headed launch keeps full Chrome as the first choice.
- Launch returns the runtime name with the browser.

- [ ] Write a failing test for headless shell success.
- [ ] Write a failing test for headless shell failure followed by full Chrome success.
- [ ] Write a failing test for two launch failures preserving the final error.
- [ ] Write a failing test that headed launch does not select the headless shell.
- [ ] Run the focused tests and verify the new tests fail for the expected missing selection behavior.
- [ ] Implement the launch order with one fallback and no page-level retry.
- [ ] Run `bun test test/capture-runtime.test.ts` and verify all runtime tests pass.
- [ ] Commit with `feat: prefer chromium headless shell for captures`.

### Task 3. Expose the selected runtime in logs

**Files:**

- Modify `src/capture.ts`
- Test `test/capture-runtime.test.ts`

**Interfaces:**

- The launch callback receives `runtime chromium-headless-shell` after shell selection.
- The launch callback receives `runtime chrome` after full Chrome selection.
- Existing launch messages remain readable.

- [ ] Write a failing test that records launch messages and expects the selected runtime.
- [ ] Run the focused test and verify it fails.
- [ ] Add the runtime log at the launch boundary.
- [ ] Run `bun test test/capture-runtime.test.ts` and verify it passes.
- [ ] Commit with `feat: report capture runtime`.

### Task 4. Prove the real capture behavior

**Files:**

- Modify `test/cli-e2e.test.ts` only if the existing fixture needs a runtime assertion.
- Modify `README.md` with the runtime behavior and fallback rule.

**Interfaces:**

- The normal quick capture command remains unchanged.
- Authenticated captures continue to accept the auth jar selected by `authstate`.

- [ ] Run `bun test test/cli-e2e.test.ts` with the bundled Chromium installation.
- [ ] Run the authenticated quick capture against the TaxClever route and record the wall time.
- [ ] Confirm the output PNG opens and keeps the existing dimensions and hash checks.
- [ ] Confirm a launch failure falls back to full Chrome in the focused unit tests.
- [ ] Document that headless shell is the default headless runtime and full Chrome is the fallback.
- [ ] Run `bun test`.
- [ ] Run `bun run build`.
- [ ] Commit with `docs: document headless runtime selection`.

### Task 5. Run the complete verification sweep

**Files:**

- No source changes unless a verification failure identifies a required fix.

- [ ] Run `bun test`.
- [ ] Run `bun run build`.
- [ ] Run the authenticated quick capture three times with the same route.
- [ ] Compare the median wall time with the recorded baseline of `3.36s`.
- [ ] Report the runtime. Median time. And any compatibility difference.
- [ ] If the median does not improve or a required feature differs then keep the fallback policy and record the result before proposing another runtime.
