import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const CLI = join(REPO_ROOT, "src", "cli.ts");
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-e2e-test-"));
}

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

test("captures a sample HTML page and validates viewport and full page screenshots", () => {
  const dir = scratch();
  const html = join(dir, "sample.html");
  const viewportOutput = join(dir, "viewport.png");
  const fullPageOutput = join(dir, "full-page.png");
  const inspectOutput = join(dir, "viewport.json");
  writeFileSync(
    html,
    `<!doctype html>
<html>
  <body style="margin: 0; font-family: sans-serif; background: #e8f0ff;">
    <main style="width: 640px; min-height: 900px; padding: 32px; box-sizing: border-box;">
      <h1>Quick Capture Sample</h1>
      <p>This page proves that the CLI captured rendered HTML.</p>
    </main>
  </body>
</html>`,
  );

  const viewport = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--size", "640x480", "--expect-text", "Quick Capture Sample", "--inspect", "h1", "--inspect-json", inspectOutput, "--output", viewportOutput, "--json"],
    { cwd: dir },
  );
  const fullPage = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--size", "640x480", "--full-page", "--expect-text", "Quick Capture Sample", "--output", fullPageOutput, "--json"],
    { cwd: dir },
  );

  expect(viewport.exitCode).toBe(0);
  expect(fullPage.exitCode).toBe(0);
  expect(existsSync(viewportOutput)).toBe(true);
  expect(existsSync(fullPageOutput)).toBe(true);
  expect(existsSync(inspectOutput)).toBe(true);

  const viewportResult = JSON.parse(viewport.stdout.toString());
  const fullPageResult = JSON.parse(fullPage.stdout.toString());
  expect(viewportResult.outputPath).toBe(viewportOutput);
  expect(viewportResult.bytes).toBe(readFileSync(viewportOutput).length);
  expect(viewportResult.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(viewportResult.inspected.name).toBe("Quick Capture Sample");
  expect(JSON.parse(readFileSync(inspectOutput, "utf8")).name).toBe("Quick Capture Sample");
  expect(pngSize(viewportOutput)).toEqual({ width: 1280, height: 960 });
  expect(pngSize(fullPageOutput).width).toBe(1280);
  expect(pngSize(fullPageOutput).height).toBeGreaterThan(960);
  expect(fullPageResult.sha256).not.toBe(viewportResult.sha256);
});

test("bare --publish without a saved destination exits 2 before capturing", () => {
  const dir = scratch();
  const html = join(dir, "sample.html");
  const out = join(dir, "shot.png");
  writeFileSync(html, "<!doctype html><html><body><h1>Publish Sample</h1></body></html>");

  const proc = Bun.spawnSync(["bun", CLI, `file://${html}`, "--output", out, "--publish"], { cwd: dir });

  expect(proc.exitCode).toBe(2);
  expect(proc.stderr.toString()).toContain("config set publish");
  expect(existsSync(out)).toBe(false);
});

test("hover runs before inspection and screenshot capture, and actions preserve order", () => {
  const dir = scratch();
  const html = join(dir, "hover.html");
  const output = join(dir, "hover.png");
  const inspectOutput = join(dir, "hover.json");
  writeFileSync(
    html,
    `<!doctype html>
<html>
  <body>
    <button id="menu" style="width: 180px; height: 60px;">Closed</button>
    <script>
      const menu = document.querySelector("#menu");
      menu.addEventListener("mouseover", () => {
        menu.dataset.hovered = "true";
        menu.textContent = "Hovered";
      });
      menu.addEventListener("click", () => {
        if (menu.dataset.hovered === "true") menu.dataset.clicked = "true";
      });
    </script>
  </body>
</html>`,
  );

  const proc = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--allow-blank", "--act", "hover:button#menu;click:button#menu", "--inspect", "#menu", "--inspect-json", inspectOutput, "--output", output, "--json"],
    { cwd: dir },
  );

  expect(proc.exitCode).toBe(0);
  expect(existsSync(output)).toBe(true);
  const result = JSON.parse(proc.stdout.toString());
  const inspected = JSON.parse(readFileSync(inspectOutput, "utf8"));
  expect(result.outputPath).toBe(output);
  expect(inspected.attributes["data-hovered"]).toBe("true");
  expect(inspected.attributes["data-clicked"]).toBe("true");
  expect(inspected.displayHTML).toContain("Hovered");
});

test("an invalid hover target returns a useful non-zero failure", () => {
  const dir = scratch();
  const html = join(dir, "hover-missing.html");
  writeFileSync(html, "<!doctype html><html><body><p>Rendered page</p></body></html>");

  const proc = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--allow-blank", "--act", "hover:[", "--output", join(dir, "missing.png")],
    { cwd: dir },
  );

  expect(proc.exitCode).toBe(1);
  expect(proc.stderr.toString()).toMatch(/hover|selector|locator/i);
});

test("a rendered cursor appears only when hover is the final action", () => {
  const dir = scratch();
  const html = join(dir, "hover-cursor.html");
  writeFileSync(
    html,
    `<!doctype html>
<html>
  <body style="margin:0;background:#f4f5f7;">
    <button id="target" style="margin:100px;width:220px;height:80px;cursor:pointer;border:0;border-radius:16px;background:#20242b;color:white;">Premium hover</button>
    <style>
      #target:hover { background: #394150; }
      svg { display: none !important; }
      svg * { fill: red !important; stroke: red !important; }
    </style>
  </body>
</html>`,
  );

  const finalHover = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--allow-blank", "--act", "hover:#target", "--output", join(dir, "final-hover.png"), "--json"],
    { cwd: dir },
  );
  const followedByWait = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--allow-blank", "--act", "hover:#target;wait:1", "--output", join(dir, "hover-then-wait.png"), "--json"],
    { cwd: dir },
  );

  expect(finalHover.exitCode).toBe(0);
  expect(followedByWait.exitCode).toBe(0);
  expect(JSON.parse(finalHover.stdout.toString()).sha256).not.toBe(JSON.parse(followedByWait.stdout.toString()).sha256);
});

test("hover cursor survives a handler changing the target selector", () => {
  const dir = scratch();
  const html = join(dir, "hover-selector-change.html");
  writeFileSync(
    html,
    `<!doctype html><html><body><button id="target" style="margin:80px;width:180px;height:80px;cursor:pointer;">Hover</button><script>document.querySelector("#target").addEventListener("mouseenter", event => { event.currentTarget.id = "changed"; });</script></body></html>`,
  );

  const finalHover = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--allow-blank", "--act", "hover:#target", "--output", join(dir, "changed-final.png"), "--json"],
    { cwd: dir },
  );
  const followedByWait = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--allow-blank", "--act", "hover:#target;wait:1", "--output", join(dir, "changed-wait.png"), "--json"],
    { cwd: dir },
  );

  expect(finalHover.exitCode).toBe(0);
  expect(followedByWait.exitCode).toBe(0);
  expect(JSON.parse(finalHover.stdout.toString()).sha256).not.toBe(JSON.parse(followedByWait.stdout.toString()).sha256);
});

test("cursor none does not add a hover cursor to the capture", () => {
  const dir = scratch();
  const html = join(dir, "hover-cursor-none.html");
  writeFileSync(
    html,
    `<!doctype html><html><body><div id="target" style="margin:80px;width:180px;height:80px;cursor:none;background:#4968db;">No cursor</div></body></html>`,
  );

  const finalHover = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--allow-blank", "--act", "hover:#target", "--output", join(dir, "none-hover.png"), "--json"],
    { cwd: dir },
  );
  const followedByWait = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--allow-blank", "--act", "hover:#target;wait:1", "--output", join(dir, "none-wait.png"), "--json"],
    { cwd: dir },
  );

  expect(finalHover.exitCode).toBe(0);
  expect(followedByWait.exitCode).toBe(0);
  expect(JSON.parse(finalHover.stdout.toString()).sha256).toBe(JSON.parse(followedByWait.stdout.toString()).sha256);
});

test("hovered links receive a readable URL preview", () => {
  const dir = scratch();
  const html = join(dir, "hover-link-preview.html");
  writeFileSync(
    html,
    `<!doctype html><html><body style="margin:120px;"><a id="target" href="/products/very-long-preview-path?campaign=summer&variant=premium" style="font:600 20px sans-serif;cursor:pointer;">Open product</a></body></html>`,
  );

  const finalHover = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--allow-blank", "--act", "hover:#target", "--output", join(dir, "link-final.png"), "--json"],
    { cwd: dir },
  );
  const followedByWait = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--allow-blank", "--act", "hover:#target;wait:1", "--output", join(dir, "link-wait.png"), "--json"],
    { cwd: dir },
  );

  expect(finalHover.exitCode).toBe(0);
  expect(followedByWait.exitCode).toBe(0);
  expect(JSON.parse(finalHover.stdout.toString()).sha256).not.toBe(JSON.parse(followedByWait.stdout.toString()).sha256);
});

test("hovered links keep their URL preview when the CSS cursor is none", () => {
  const dir = scratch();
  const html = join(dir, "hover-link-none.html");
  writeFileSync(html, `<!doctype html><html><body style="margin:120px;"><a id="target" href="/hidden-cursor" style="cursor:none;font:600 20px sans-serif;">Hidden cursor link</a></body></html>`);

  const finalHover = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--allow-blank", "--act", "hover:#target", "--output", join(dir, "link-none-final.png"), "--json"],
    { cwd: dir },
  );
  const followedByWait = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--allow-blank", "--act", "hover:#target;wait:1", "--output", join(dir, "link-none-wait.png"), "--json"],
    { cwd: dir },
  );

  expect(finalHover.exitCode).toBe(0);
  expect(followedByWait.exitCode).toBe(0);
  expect(JSON.parse(finalHover.stdout.toString()).sha256).not.toBe(JSON.parse(followedByWait.stdout.toString()).sha256);
});

test("bare --publish resolves the saved publish profile key", () => {
  const dir = scratch();
  const html = join(dir, "sample.html");
  writeFileSync(
    html,
    `<!doctype html>
<html>
  <body style="margin: 0; font-family: sans-serif;">
    <main style="padding: 32px;">
      <h1>Publish Sample</h1>
      <p>This page proves the CLI captured rendered HTML before the publish step ran.</p>
    </main>
  </body>
</html>`,
  );
  const out = join(dir, "shot.png");
  Bun.spawnSync(["bun", CLI, "config", "set", "publish", "browsershot-nonexistent-remote-bare:some/path/"], { cwd: dir });

  const proc = Bun.spawnSync(["bun", CLI, `file://${html}`, "--output", out, "--publish"], { cwd: dir });

  expect(proc.exitCode).toBe(5);
  expect(proc.stderr.toString()).toContain("browsershot-nonexistent-remote-bare");
  expect(existsSync(out)).toBe(true);
}, 120000);

test("an explicit --publish destination overrides the saved publish key", () => {
  const dir = scratch();
  const html = join(dir, "sample.html");
  writeFileSync(
    html,
    `<!doctype html>
<html>
  <body style="margin: 0; font-family: sans-serif;">
    <main style="padding: 32px;">
      <h1>Publish Sample</h1>
      <p>This page proves the CLI captured rendered HTML before the publish step ran.</p>
    </main>
  </body>
</html>`,
  );
  const out = join(dir, "shot.png");

  const proc = Bun.spawnSync(
    ["bun", CLI, `file://${html}`, "--output", out, "--publish", "browsershot-nonexistent-remote-explicit:other/path/"],
    { cwd: dir },
  );

  expect(proc.exitCode).toBe(5);
  expect(proc.stderr.toString()).toContain("browsershot-nonexistent-remote-explicit");
  expect(proc.stderr.toString()).not.toContain("browsershot-nonexistent-remote-bare");
}, 120000);
