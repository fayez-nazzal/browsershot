---
name: browsershot
description: Use when a real browser capture is needed for a page or route and the target application has a browsershot project profile.
license: MIT
compatibility: Needs the `browsershot` binary on `PATH` and a target application repository with `.browsershot/config.json`.
metadata:
  author: Fayez Nazzal
  version: "2.0.0"
---

# browsershot

Use the project profile and the quick capture CLI. The source repository is
`~/repos/tools/browsershot`.

## Capture

Run from the target application repository. It must contain the nearest
`.browsershot/config.json`.

```sh
cd /path/to/application
browsershot /route
```

The route is appended to the saved base URL. The PNG is written under
`.browsershot/captures` unless the project profile sets another output path.

Use the exact route supplied by the user. Add `--json` when a script needs the
result. Read the JSON output for `outputPath`, `sha256` and `inspectJsonPath`.

## Rules

- Check the current directory before running the command.
- Do not run quick capture from `~/repos/tools/browsershot` unless it is the target application repository.
- Do not guess or substitute a base URL.
- If `.browsershot/config.json` is missing, locate the target application repository or ask for it.
- Use `browsershot --help` and the source at `~/repos/tools/browsershot` for CLI details.
- Assert on text or the inspect sidecar before trusting a capture.
- Report the capture path and what the final frame proves.
