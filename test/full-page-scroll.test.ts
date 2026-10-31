import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { capture } from "../src/capture.ts";

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const png = Buffer.from(bytes);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function capturePage(
  html: string,
  fullPage: boolean,
): Promise<Uint8Array> {
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(html, { headers: { "content-type": "text/html" } }),
  });
  try {
    const result = await capture({
      url: `http://127.0.0.1:${server.port}/`,
      fullPage,
      delayMs: 0,
      allowBlank: false,
    });
    if (result.artifact.kind !== "png") throw new Error("expected PNG capture");
    return result.artifact.png;
  } finally {
    server.stop(true);
  }
}

async function readPixel(
  bytes: Uint8Array,
  x: number,
  y: number,
): Promise<number[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<img src="data:image/png;base64,${Buffer.from(bytes).toString("base64")}">`,
    );
    return await page.locator("img").evaluate(
      async (element, point) => {
        const image = element as HTMLImageElement;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (context == null) throw new Error("canvas context unavailable");
        context.drawImage(image, 0, 0);
        return Array.from(context.getImageData(point.x, point.y, 1, 1).data);
      },
      { x, y },
    );
  } finally {
    await browser.close();
  }
}

test("full-page capture expands the internal scroller without changing viewport width", async () => {
  const html = `<!doctype html><style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
    main { height: 100%; overflow: auto; }
    section { position: relative; height: 1600px; background: red; }
    .bottom { position: absolute; inset: auto 0 0; height: 100px; background: blue; }
  </style><main><section><div class="bottom">Bottom of internal content</div></section></main>`;
  const viewport = await capturePage(html, false);
  const fullPage = await capturePage(html, true);
  const viewportSize = pngSize(viewport);
  const fullPageSize = pngSize(fullPage);

  expect(fullPageSize.width).toBe(viewportSize.width);
  expect(fullPageSize.height).toBeGreaterThan(viewportSize.height);
  expect(await readPixel(fullPage, 20, fullPageSize.height - 20)).toEqual([
    0, 0, 255, 255,
  ]);
}, 30000);

test("full-page expansion retains the right edge when a document scrollbar appears", async () => {
  const html = `<!doctype html><style>
    html, body { margin: 0; width: 100%; height: 100%; }
    main { height: 100%; overflow: auto; }
    section { position: relative; height: 1600px; background: red; }
    .edge { position: absolute; right: 0; bottom: 0; width: 10px; height: 40px; background: blue; }
  </style><main><section>${"<span>Scrollable content</span>".repeat(16)}<div class="edge"></div></section></main>`;
  const viewport = await capturePage(html, false);
  const fullPage = await capturePage(html, true);
  const size = pngSize(fullPage);

  expect(size.width).toBe(pngSize(viewport).width);
  expect(await readPixel(fullPage, size.width - 4, size.height - 20)).toEqual([
    0, 0, 255, 255,
  ]);
}, 30000);

test("full-page capture keeps document scrolling behavior", async () => {
  const html = `<!doctype html><style>body { margin: 0; height: 1600px; }</style><p>Document scrolling content that is visible</p>`;
  const viewport = await capturePage(html, false);
  const fullPage = await capturePage(html, true);

  expect(pngSize(fullPage).height).toBeGreaterThan(pngSize(viewport).height);
}, 30000);
