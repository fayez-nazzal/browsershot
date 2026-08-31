import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type CredentialsDiscovery =
  | { ok: true; path: string; stopDir: string }
  | { ok: false; reason: string };

const walkUp = (startDir: string): { found: string | null; stopDir: string | null } => {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, ".testing-credentials.yaml");
    if (existsSync(candidate)) {
      return { found: candidate, stopDir: null };
    }
    if (existsSync(join(dir, ".git"))) {
      return { found: null, stopDir: dir };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return { found: null, stopDir: null };
    }
    dir = parent;
  }
};

export const discoverCredentialsFile = (cwd: string): CredentialsDiscovery => {
  const startDir = resolve(cwd);
  const walk = walkUp(startDir);
  if (walk.found !== null) {
    return { ok: true, path: walk.found, stopDir: startDir };
  }
  const stopText = walk.stopDir !== null ? walk.stopDir : "the filesystem root";
  return {
    ok: false,
    reason: `no .testing-credentials.yaml found from ${startDir} up to ${stopText} — pass --credentials <path>`,
  };
};
