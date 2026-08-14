import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const SRC_DIR = resolve(import.meta.dir, "../src");
const ENTRY = "cli.ts";

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

function importedRelativePaths(filePath: string): string[] {
  const source = readFileSync(filePath, "utf8");
  const matches = source.matchAll(/from\s+["'](\.\/[^"']+|\.\.\/[^"']+)["']/g);
  const paths: string[] = [];
  for (const match of matches) {
    paths.push(resolve(dirname(filePath), match[1]!));
  }
  return paths;
}

function reachableFiles(entryPath: string): Set<string> {
  const visited = new Set<string>();
  const queue = [entryPath];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const importPath of importedRelativePaths(current)) {
      if (!visited.has(importPath)) {
        queue.push(importPath);
      }
    }
  }
  return visited;
}

test("every src module is reachable from the entry point", () => {
  const entryPath = join(SRC_DIR, ENTRY);
  const reachable = reachableFiles(entryPath);
  const allFiles = listSourceFiles(SRC_DIR);
  const orphans = allFiles.filter((file) => !reachable.has(file));
  expect(orphans).toEqual([]);
});
