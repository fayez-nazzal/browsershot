import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Playwright storageState shape, reduced to the parts that are merged.
export interface StoredCookie {
  name: string;
  domain: string;
  path: string;
}

export interface StoredOrigin {
  origin: string;
  localStorage?: { name: string; value: string }[];
}

export interface StorageStateLike {
  cookies?: StoredCookie[];
  origins?: StoredOrigin[];
}

// Snapshot of the headed `open` profile, taken when its window closes. Captures
// stay isolated headless contexts; this file is how settings made by hand (theme,
// sign-ins) reach them.
export function openStatePath(workspace: string): string {
  return join(workspace, "open-state.json");
}

export function writeOpenState(path: string, state: StorageStateLike): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`);
  renameSync(temporary, path);
}

export function readOpenState(path: string): StorageStateLike | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StorageStateLike;
  } catch (error) {
    throw new Error(`could not read open-window state ${path}: ${(error as Error).message}; delete it or run browsershot open again`);
  }
}

// `overlay` wins: cookies are keyed by name+domain+path, localStorage by
// origin+name. Used with the open snapshot as base and the authstate jar as
// overlay, so a refreshed login is never shadowed by a stale snapshot.
export function mergeStorageState(base: StorageStateLike, overlay: StorageStateLike): StorageStateLike {
  const cookies = new Map<string, StoredCookie>();
  for (const cookie of [...(base.cookies ?? []), ...(overlay.cookies ?? [])]) {
    cookies.set(`${cookie.name}\u0000${cookie.domain}\u0000${cookie.path}`, cookie);
  }
  const origins = new Map<string, StoredOrigin>();
  for (const origin of [...(base.origins ?? []), ...(overlay.origins ?? [])]) {
    const known = origins.get(origin.origin);
    if (known === undefined) {
      origins.set(origin.origin, { ...origin, localStorage: [...(origin.localStorage ?? [])] });
      continue;
    }
    const items = new Map((known.localStorage ?? []).map((item) => [item.name, item] as const));
    for (const item of origin.localStorage ?? []) items.set(item.name, item);
    origins.set(origin.origin, { ...known, ...origin, localStorage: [...items.values()] });
  }
  return { cookies: [...cookies.values()], origins: [...origins.values()] };
}
