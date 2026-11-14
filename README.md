# Browsershot

Capture a page and see what happened in the browser, from your terminal. Browsershot gives developers and coding agents screenshots, element details, and browser errors to work with.

## Get started

You need [Bun](https://bun.sh) and Git. On macOS or Linux:

```sh
git clone https://github.com/fayez-nazzal/browsershot.git
cd browsershot
bun install --frozen-lockfile
bunx playwright install chromium
bun run build
export PATH="$PWD/dist:$PATH"
browsershot https://example.com
```

The command prints the screenshot's absolute path. Captures are saved under `.browsershot/captures/` in the directory where you run it. The PATH change lasts for the current terminal; add the checkout's absolute `dist` directory to your shell PATH to keep it.

On Linux, use `bunx playwright install --with-deps chromium` if browser system dependencies are missing.

## Try it on your app

Start your app, then run these commands from its directory:

```sh
browsershot config set baseUrl http://localhost:3000
browsershot /pricing --full-page
browsershot /dashboard --act 'click:#menu' --inspect '#menu' --with-errors --json
```

Replace the routes and selector with those from your app. The last command captures the page after opening the menu and returns inspection details and browser errors as JSON.

Browsershot can also capture individual elements, authenticated pages, HTML, and video. See the [guide](docs/guide.md) for examples and the full reference, or run `browsershot --help`.

## Contributing

Run `bun test` from the checkout. See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

[MIT license](LICENSE)
