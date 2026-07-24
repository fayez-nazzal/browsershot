# browsershot

Capture a web page to a PNG via headless Chrome (Playwright). A browser sibling
to [termshot](../termshot): same flag style, same `~/<tool>/<timestamp>.png`
output, but it shoots a **URL's viewport** instead of an OS window.

- Drives your **installed Google Chrome** (Playwright channel `chrome`) headless
  by default, so captures match what you see in your real browser and never
  steal focus. Falls back to bundled Chromium with a stderr warning when Chrome
  is unavailable. Use `--headed` to watch it.
- **Retina by default** (`--scale 2`), matching CleanShot-quality output.
- Captures the **viewport** by default (not the whole scrolled page). `--full-page`
  for the entire page.
- Output defaults to `~/browsershot/<timestamp>.png`.
- Cross-platform (anywhere Playwright runs), unlike termshot (macOS only).
  `--annotate` and `--copy` are macOS only.

## Install

```sh
bun install                      # deps
bun playwright install chromium  # one-time bundled Chromium download (fallback engine)
bun link                         # global `browsershot` command (symlinks into ~/.bun/bin)
```

Requires [Bun](https://bun.sh). Ensure `~/.bun/bin` is on `PATH`:

```sh
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

## Usage

```sh
browsershot example.com                       # -> ~/browsershot/<timestamp>.png (retina)
browsershot https://example.com -o shot.png   # custom path
browsershot example.com --preset phone        # 390x844 viewport
browsershot example.com --size 1920x1080      # custom viewport
browsershot example.com --full-page           # whole page
browsershot example.com --gif 5               # 5s recording -> shot.gif next to the PNG path
browsershot example.com --box 950,245,870,100 --marker 1855,294   # draw on the PNG
browsershot example.com --marker 100,200,#00ff00                  # green marker
browsershot example.com --annotate            # open the result in CleanShot
browsershot example.com --copy                # put the PNG on the clipboard
browsershot example.com --headed              # watch it run in a real window
browsershot example.com --wait networkidle --delay 500
browsershot example.com --stdout > shot.png
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <path>` | Output PNG path | `~/browsershot/<timestamp>.png` |
| `--width <px>` | Viewport width | `1440` |
| `--height <px>` | Viewport height | `900` |
| `--size <WxH>` | Shorthand for both (overrides all sizing flags) | — |
| `--preset <name>` | Viewport preset: `desktop` 1920x1080, `laptop` 1440x900, `phone` 390x844 | — |
| `--full-page` | Capture whole scrollable page | viewport only |
| `--headed` | Visible window | headless |
| `--scale <n>` | deviceScaleFactor (2 = retina) | `2` |
| `--wait <event>` | `load` \| `domcontentloaded` \| `networkidle` \| `commit` | `load` |
| `--delay <ms>` | Extra wait after load before capture | `0` |
| `--timeout <ms>` | Navigation timeout | `30000` |
| `--gif <seconds>` | Record the page for that long, write a `.gif` next to the normal output path (Playwright video + bundled ffmpeg) | — |
| `--box <x,y,w,h[,color]>` | Draw a rectangle outline on the PNG at those pixel coordinates (top-left origin, post-scale); repeatable (macOS) | color `red`, 4px stroke |
| `--marker <x,y[,color]>` | Draw a point marker (filled dot, 12px radius, 3px white outline) on the PNG at that pixel coordinate (top-left origin, post-scale); repeatable (macOS) | color `red` |
| `--annotate` | Open the written file in CleanShot (`cleanshot://open-annotate`, macOS) | off |
| `--copy` | Put the written PNG on the clipboard via osascript (macOS) | off |
| `--stdout` | Write PNG bytes to stdout | off |
| `-h, --help` | Show help | — |
| `-v, --version` | Show version | — |

Sizing precedence: `--size` wins, then explicit `--width`/`--height`, then
`--preset`, then the defaults. Bare hosts (`example.com`) get `https://`
prepended automatically.

`--gif` records instead of screenshotting: the `.gif` lands at the normal
output path with its extension swapped (`-o demo.png --gif 5` writes
`demo.gif`). `--annotate` and `--copy` apply to PNG output only, and neither
combines with `--stdout`.

`--box` and `--marker` draw directly on the captured PNG before it is written
(or sent to `--stdout`), so the output needs no annotation tool. Both are
repeatable and take pixel coordinates in the **final output image** with the
origin at the top-left. That is post-scale: at the default `--scale 2` a
1440x900 viewport produces a 2880x1800 PNG, so double any CSS pixel value.
`color` is a name (`red`, `green`, `blue`, `yellow`, `orange`, `purple`,
`black`, `white`) or `#RRGGBB`, defaulting to `red`. Boxes are stroked 4px
wide; markers are filled dots of 12px radius with a 3px white outline. Drawing
uses macOS ImageIO/CoreGraphics via osascript (macOS only, like `--annotate`
and `--copy`), and applies to PNG output only, not `--gif`.

## Dev

```sh
bun test                         # pure-logic unit tests (no network)
bun run src/cli.ts --help
```

## Notes

- Success output is a single stderr line: `browsershot: wrote <path> (<n> bytes)`.
  stdout stays clean unless `--stdout` is used.
- The Chromium fallback needs `bun playwright install chromium` once; otherwise
  you get a clear "Chromium not found" error telling you to run it.
- GIF conversion uses the ffmpeg binary Playwright ships in
  `~/Library/Caches/ms-playwright/ffmpeg-*/ffmpeg-mac` to extract frames
  (that build has no GIF muxer), then assembles the animated GIF with macOS
  ImageIO via osascript. No extra installs.
