import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "browsershot-quick-capture-test-"));
}

async function run(root: string, ...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", CLI, ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const [exitCode, out, err] = await Promise.all([proc.exited, stdout, stderr]);
  return { exitCode, stdout: out, stderr: err };
}

test("quick routes and complete URLs capture with the same actions and inspection without changing config", async () => {
  const root = scratch();
  const html = `<!doctype html><html><body><header id="header">Example Header</header><p>This fixture has enough rendered text for the blank guard.</p><button id="menu" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true')">Menu</button></body></html>`;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(html, { headers: { "content-type": "text/html" } }) });
  try {
    const configDir = join(root, ".browsershot");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir, { recursive: true });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    await Bun.write(configPath, JSON.stringify({ baseUrl, expectElement: "#header", json: true }));
    const before = readFileSync(configPath, "utf8");
    const common = ["--expect-element", "#header", "--act", "click:#menu", "--inspect", "#menu", "--inspect-attr", "aria-expanded", "--json"];
    const quickOutput = join(root, "quick.png");
    const fullOutput = join(root, "full.png");
    const quick = await run(root, "/pricing", ...common, "--output", quickOutput);
    const full = await run(root, `${baseUrl}/pricing`, ...common, "--output", fullOutput);
    const after = readFileSync(configPath, "utf8");
    expect(after).toBe(before);
    const captures = [{ result: quick, output: quickOutput }, { result: full, output: fullOutput }];
    for (const capture of captures) {
      expect(capture.result.exitCode).toBe(0);
      const summary = JSON.parse(capture.result.stdout);
      expect(summary.outputPath).toBe(capture.output);
      expect(summary.bytes).toBeGreaterThan(0);
      expect(summary.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(summary.inspected.attributes["aria-expanded"]).toBe("true");
      expect(existsSync(summary.inspectJsonPath)).toBe(true);
    }
  } finally {
    server.stop(true);
  }
}, 30_000);
