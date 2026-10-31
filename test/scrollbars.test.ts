import { expect, test } from "bun:test";
import { capture } from "../src/capture.ts";

// Explicit scrollbar sizes make the result independent of OS overlay preferences.
const PAGE = `<!doctype html><style>
#scroll { width: 200px; height: 100px; overflow: auto; }
#scroll > div { width: 400px; height: 200px; }
#scroll::-webkit-scrollbar { width: 16px; height: 16px; }
#scroll::-webkit-scrollbar-thumb { background: #666; }
</style><div id="scroll"><div>Scrollable capture content</div></div><script>
const node = document.querySelector('#scroll');
node.dataset.horizontalGutter = String(node.offsetHeight - node.clientHeight);
node.dataset.verticalGutter = String(node.offsetWidth - node.clientWidth);
</script>`;

test("captures preserve page-defined horizontal and vertical scrollbar gutters", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response(PAGE, { headers: { "content-type": "text/html" } }),
  });
  try {
    const result = await capture({
      url: `http://127.0.0.1:${server.port}/`,
      fullPage: false,
      delayMs: 0,
      allowBlank: false,
      artifact: "html",
      inspect: { selector: "#scroll", timeoutMs: 1000 },
    });
    expect(result.inspected?.attributes["data-horizontal-gutter"]).toBe("16");
    expect(result.inspected?.attributes["data-vertical-gutter"]).toBe("16");
  } finally {
    server.stop(true);
  }
}, 30000);
