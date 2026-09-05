import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

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

test("quick route captures actions and inspection without changing config", async () => {
  const root = scratch();
  const outputPath = join(root, "menu.png");
  const html = `<!doctype html><html><body><header id="header">Example Header</header><p>This fixture has enough rendered text for the blank guard.</p><button id="menu" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true')">Menu</button></body></html>`;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(html, { headers: { "content-type": "text/html" } }) });
  try {
    const configDir = join(root, ".browsershot");
    const configPath = join(configDir, "config.json");
    mkdirSync(configDir, { recursive: true });
    await Bun.write(configPath, JSON.stringify({ baseUrl: `http://127.0.0.1:${server.port}`, expectElement: "#header", json: true }));
    const before = readFileSync(configPath, "utf8");
    const result = await run(root, "/pricing", "--act", "click:#menu", "--inspect", "#menu", "--inspect-attr", "aria-expanded", "--output", outputPath);
    const after = readFileSync(configPath, "utf8");
    expect(result.exitCode).toBe(0);
    expect(after).toBe(before);
    const summary = JSON.parse(result.stdout);
    expect(summary.outputPath).toBe(outputPath);
    expect(summary.bytes).toBe(statSync(outputPath).size);
    expect(summary.sha256).toBe(createHash("sha256").update(readFileSync(outputPath)).digest("hex"));
    expect(summary.inspected.attributes["aria-expanded"]).toBe("true");
    expect(existsSync(summary.inspectJsonPath)).toBe(true);
    expect(JSON.parse(readFileSync(summary.inspectJsonPath, "utf8")).attributes["aria-expanded"]).toBe("true");
  } finally {
    server.stop(true);
  }
}, 30_000);
