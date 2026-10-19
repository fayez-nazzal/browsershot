import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { snapshotHtml } from "../src/html-snapshot.ts";

const PAGE = `<!doctype html>
<html class="dark" data-theme="midnight">
<head>
<link rel="stylesheet" href="/css/app.css">
<link rel="stylesheet" href="http://127.0.0.1:__OTHER__/x.css">
<style>.inline-used { padding: 4px; } .inline-unused { padding: 9px; }</style>
<script>window.ran = true;</script>
</head>
<body>
<div class="page">
  <section class="card"><h2>First card</h2><input id="q" type="text"><button class="btn">Go</button></section>
  <section class="other"><h2 class="inline-used">Sibling card</h2></section>
</div>
</body>
</html>`;

const APP_CSS = `
.card { background: url(../img/bg.png); font-family: "Brand Sans"; }
.page .card { border: 1px solid red; }
.page .other { border: 1px solid blue; }
.btn:hover { color: green; }
.unused { color: pink; }
@media (prefers-color-scheme: dark) { .card { color: #eee; } }
@media (prefers-color-scheme: light) { .card { color: #111; } }
@media print { .card { color: black; } }
@font-face { font-family: "Brand Sans"; src: url(/fonts/brand.woff2); }
@font-face { font-family: "Never Used"; src: url(/fonts/never.woff2); }
@keyframes spin { to { transform: rotate(1turn); } }
@keyframes unused-anim { to { opacity: 0; } }
.btn { animation: spin 1s paused; }
`;

let browser: Browser;
let main: Bun.Server<undefined>;
let other: Bun.Server<undefined>;
let snapshotBody = "";

beforeAll(async () => {
  other = Bun.serve({ port: 0, fetch: () => new Response(".remote { color: teal; }", { headers: { "content-type": "text/css" } }) });
  main = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/page") return new Response(PAGE.replace("__OTHER__", String(other.port)), { headers: { "content-type": "text/html" } });
      if (pathname === "/snap") return new Response(snapshotBody, { headers: { "content-type": "text/html" } });
      if (pathname === "/css/app.css") return new Response(APP_CSS, { headers: { "content-type": "text/css" } });
      return new Response("not found", { status: 404 });
    },
  });
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  main?.stop(true);
  other?.stop(true);
});

async function snapshot(colorScheme: "light" | "dark", element?: string, setup?: (page: Page) => Promise<void>): Promise<string> {
  const context = await browser.newContext({ colorScheme });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${main.port}/page`);
    await setup?.(page);
    return await snapshotHtml(page, element === undefined ? null : page.locator(element));
  } finally {
    await context.close();
  }
}

test("whole page keeps the html shell, drops scripts and unused rules, and absolutises CSS urls", async () => {
  const out = await snapshot("light");
  expect(out.startsWith("<!doctype html>\n")).toBe(true);
  expect(out.endsWith("\n")).toBe(true);
  expect(out).toContain('<html class="dark" data-theme="midnight">');
  expect(out).not.toContain("<script");
  expect(out).toContain(`<base href="http://127.0.0.1:${main.port}/page">`);
  expect(out).toContain(".inline-used");
  expect(out).not.toContain(".inline-unused");
  expect(out).not.toContain(".unused {");
  expect(out).toContain(`url("http://127.0.0.1:${main.port}/img/bg.png")`);
});

test("media queries resolve at the capture colour scheme and print is dropped", async () => {
  const dark = await snapshot("dark");
  expect(dark).toContain("color: rgb(238, 238, 238)");
  expect(dark).not.toContain("@media");
  expect(dark).not.toContain("color: rgb(17, 17, 17)");
  expect(dark).not.toContain("color: black");
  const light = await snapshot("light");
  expect(light).toContain("color: rgb(17, 17, 17)");
  expect(light).not.toContain("color: rgb(238, 238, 238)");
});

test("element capture keeps only that element inside its empty ancestor wrapper", async () => {
  const out = await snapshot("light", ".card");
  expect(out).toContain("First card");
  expect(out).not.toContain("Sibling card");
  expect(out).toContain('<div class="page"><section class="card">');
  expect(out).toContain(".page .card");
  expect(out).not.toContain(".page .other");
});

test("fonts and keyframes are kept only when referenced", async () => {
  const out = await snapshot("light");
  expect(out).toContain("@font-face");
  expect(out).toContain("Brand Sans");
  expect(out).not.toContain("Never Used");
  expect(out).toContain("@keyframes spin");
  expect(out).not.toContain("unused-anim");
});

test("pseudo-state rules are kept while the state is inactive", async () => {
  expect(await snapshot("light")).toContain(".btn:hover");
});

test("typed form state is serialised into the snippet", async () => {
  const out = await snapshot("light", ".card", (page) => page.fill("#q", "typed"));
  expect(out).toContain('value="typed"');
});

test("cross-origin stylesheets are linked instead of inlined", async () => {
  const out = await snapshot("light");
  expect(out).toContain(`<link rel="stylesheet" href="http://127.0.0.1:${other.port}/x.css">`);
  expect(out).not.toContain(".remote");
});

async function snapshotContent(content: string, element?: string): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent(content);
    return await snapshotHtml(page, element === undefined ? null : page.locator(element));
  } finally {
    await context.close();
  }
}

test("grouping rules keep only matching children, and adopted sheets are included", async () => {
  const out = await snapshotContent(`<style>
@layer base, ui;
@layer ui { .btn { color: red; } .nope { color: blue; } }
@supports (display: grid) { .grid { display: grid; } .gone { display: grid; } }
@property --foo { syntax: "<number>"; inherits: false; initial-value: 0; }
@property --unused { syntax: "<number>"; inherits: false; initial-value: 0; }
.card { color: green; & .inner { color: purple; } }
::selection { background: yellow; }
</style>
<script>const s = new CSSStyleSheet(); s.replaceSync(".adopted { outline: 1px solid red; }"); document.adoptedStyleSheets = [s];<\/script>
<div class="card"><span class="inner btn">x</span></div><div class="grid adopted" style="--foo: 2"></div>`);
  expect(out).toContain("@layer base, ui;");
  expect(out).toMatch(/@layer ui \{\n\.btn \{ color: red; \}\n\}/);
  expect(out).not.toContain(".nope");
  expect(out).toMatch(/@supports \(display: grid\) \{\n\.grid \{ display: grid; \}\n\}/);
  expect(out).not.toContain(".gone");
  expect(out).toContain("@property --foo");
  expect(out).not.toContain("--unused");
  expect(out).toContain("& .inner");
  expect(out).toContain("::selection");
  expect(out).toContain(".adopted");
  expect(out).not.toContain("<base");
});

test("a closing style tag inside CSS text cannot terminate the emitted style element", async () => {
  const out = await snapshotContent(`<div class="txt">x</div>
<script>const s = new CSSStyleSheet(); s.replaceSync('.txt::after { content: "</style><b>pwn</b>"; }'); document.adoptedStyleSheets = [s];<\/script>`);
  expect(out).not.toContain("</style><b>");
  expect(out).toContain("<\\/style>");
});

test("password values typed into the page are not copied into the snapshot", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent('<input id="p" type="password"><input id="f" type="file"><input id="c" type="checkbox">');
    await page.fill("#p", "hunter2");
    await page.check("#c");
    const out = await snapshotHtml(page, null);
    expect(out).not.toContain("hunter2");
    expect(out).toMatch(/<input id="c" type="checkbox" checked="">/);
  } finally {
    await context.close();
  }
});

test("scripts, inline styles and the inspect overlay never reach the snippet", async () => {
  const out = await snapshotContent(`<style>.a{color:red}</style><div id="browsershot-inspector">overlay</div><div class="a">ok<script>1</script><noscript>n</noscript></div>`, ".a");
  expect(out).toContain('<div class="a">ok</div>');
  expect(out).not.toContain("overlay");
  expect(out).not.toContain("<script");
  expect(out).not.toContain("<noscript");
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`re-rendering the ${colorScheme} snapshot reproduces the original screenshot`, async () => {
    const context = await browser.newContext({ colorScheme, viewport: { width: 800, height: 600 } });
    try {
      const original = await context.newPage();
      await original.goto(`http://127.0.0.1:${main.port}/page`);
      snapshotBody = await snapshotHtml(original, null);
      const replay = await context.newPage();
      await replay.goto(`http://127.0.0.1:${main.port}/snap`);
      expect(Buffer.compare(await replay.screenshot(), await original.screenshot())).toBe(0);
    } finally {
      await context.close();
    }
  });
}
