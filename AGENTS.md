# Browsershot

Use one command to capture and verify a page.

For a complete URL, run directly from the application repository:

```sh
browsershot https://example.com/pricing --expect-text Pricing --json
```

For a quick route, use a saved base in the current directory:

```sh
browsershot config set baseUrl https://example.com
browsershot /pricing --expect-element '#header' --json
```

Add only the flags needed for this run. Actions and inspection fit in the same capture:

```sh
browsershot /dashboard \
  --act 'click:#menu' \
  --inspect '#menu' --inspect-attr aria-expanded --json
```

Use `--auth`, `--auth-user`, or `--auth-credentials` for a session. Use `--no-auth` or `--no-expect` to disable saved settings for one capture. Use `--output` for a temporary destination. Complete URLs do not require a profile; quick paths require a saved `baseUrl` (legacy `url` is accepted).

Check `--json` stdout. It contains the absolute `outputPath`, byte count, `sha256`, and any `inspected` element. With `--inspect`, the sidecar path is in `inspectJsonPath`. Report the absolute output path, what text or element was verified, and the exit code when the run fails. Never read PNG files into agent context.

See [`README.md`](README.md) for all flags, saved settings, exit codes, auth, and publish details.
