import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { profilePaths } from "./profile.ts";

const STALE_RUN_AGE_MS = 24 * 60 * 60 * 1000;

export function ensureWorkspace(root = process.cwd()): string {
  const directory = profilePaths(root).directory;
  mkdirSync(directory, { recursive: true });
  const gitignore = join(directory, ".gitignore");
  if (!existsSync(gitignore)) {
    writeFileSync(gitignore, "*\n");
  }
  sweepStaleRuns(directory);
  return directory;
}

export function createRunTmpDir(root = process.cwd()): string {
  const tmp = join(profilePaths(root).directory, "tmp");
  mkdirSync(tmp, { recursive: true });
  return mkdtempSync(join(tmp, "run-"));
}

export function removeRunTmpDir(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

function sweepStaleRuns(directory: string): void {
  const tmp = join(directory, "tmp");
  let entries: string[] = [];
  if (existsSync(tmp)) {
    entries = readdirSync(tmp);
  }
  const now = Date.now();
  for (const entry of entries) {
    const run = join(tmp, entry);
    if (existsSync(run)) {
      const stats = statSync(run);
      if (now - stats.mtimeMs > STALE_RUN_AGE_MS) {
        rmSync(run, { recursive: true, force: true });
      }
    }
  }
}
