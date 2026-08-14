// Upload a captured file to a Google Drive rclone remote, make it public, and
// build the PR-ready embed. Duplicated verbatim in the termshot sibling, like
// annotate.ts. Operates on the file path and URLs only and never reads the
// image bytes: rclone moves the file by path, curl checks a URL header.

export const DEFAULT_EMBED_WIDTH = 2560;

export interface PublishOptions {
  filePath: string;
  dest: string;
  isGif: boolean;
  size: number;
  label: string;
}

export interface PublishResult {
  markdown: string;
  url: string;
  fileId: string | null;
}

export function remoteName(dest: string): string {
  const idx = dest.indexOf(":");
  let result = "";
  if (idx > 0) {
    result = dest.slice(0, idx);
  }
  return result;
}

export function normalizeDest(dest: string): string {
  let result = dest;
  if (!dest.endsWith("/")) {
    result = `${dest}/`;
  }
  return result;
}

export function basename(filePath: string): string {
  const parts = filePath.split("/");
  let result = filePath;
  if (parts.length > 0) {
    result = parts[parts.length - 1]!;
  }
  return result;
}

export function labelFromPath(filePath: string): string {
  const base = basename(filePath);
  let result = base;
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    result = base.slice(0, dot);
  }
  return result;
}

export function extractDriveFileId(link: string): string | null {
  let result: string | null = null;
  const m = /(?:\/d\/|[?&]id=)([A-Za-z0-9_-]+)/.exec(link);
  if (m) {
    result = m[1]!;
  }
  return result;
}

// The lh3.googleusercontent.com/d/<id> host serves the image directly (no
// cross-domain redirect), so GitHub camo and Azure DevOps render it reliably
// where the drive.google.com/thumbnail redirect gets dropped. =w<px> caps the
// long edge at high resolution; =s0 would serve the untouched original.
export function embedUrl(fileId: string, size: number): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=w${size}`;
}

export function pngMarkdown(label: string, url: string): string {
  return `![${label}](${url})`;
}

export function gifInstruction(localPath: string, archiveUrl: string): string {
  return `GIF: drag ${localPath} into the PR description editor to embed the animation; Drive archive: ${archiveUrl}.`;
}

export function rcloneRemoteConfigured(remote: string, listRemotesOutput: string): boolean {
  const target = `${remote}:`;
  const lines = listRemotesOutput.split("\n");
  let result = false;
  for (const line of lines) {
    if (line.trim() === target) {
      result = true;
    }
  }
  return result;
}

// curl -sIL concatenates a header block per hop; keep only the last status and
// content-type seen, so the final response is the one that must be a 200 image.
export function imageHeadersOk(headOutput: string): boolean {
  const lines = headOutput.split("\n");
  let lastStatusOk = false;
  let lastTypeImage = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^HTTP\//i.test(trimmed)) {
      lastStatusOk = / 200(\s|$)/.test(trimmed);
    }
    if (/^content-type:/i.test(trimmed)) {
      lastTypeImage = /content-type:\s*image\//i.test(trimmed);
    }
  }
  return lastStatusOk && lastTypeImage;
}

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function runCommand(cmd: string[]): CommandResult {
  const proc = Bun.spawnSync(cmd);
  const stdout = new TextDecoder().decode(proc.stdout);
  const stderr = new TextDecoder().decode(proc.stderr);
  return { ok: proc.success, stdout, stderr };
}

function requireRclone(remote: string): void {
  const found = Bun.spawnSync(["which", "rclone"]);
  if (!found.success) {
    throw new Error(`rclone not installed. One-time setup: brew install rclone, then rclone config to create a Google Drive remote named "${remote}".`);
  }
  const listed = runCommand(["rclone", "listremotes"]);
  if (!rcloneRemoteConfigured(remote, listed.stdout)) {
    throw new Error(`rclone remote "${remote}:" not configured. One-time setup: rclone config to create a Google Drive remote named "${remote}".`);
  }
}

function driveShareUrl(remotePath: string): string {
  const linked = runCommand(["rclone", "link", remotePath]);
  if (!linked.ok) {
    const detail = linked.stderr.trim() || `exit ${linked.stdout.trim()}`;
    throw new Error(`rclone link failed: ${detail}`);
  }
  return linked.stdout.trim();
}

export function publish(opts: PublishOptions): PublishResult {
  const remote = remoteName(opts.dest);
  if (remote === "") {
    throw new Error(`--publish dest must look like remote:path, got "${opts.dest}"`);
  }
  requireRclone(remote);

  const dest = normalizeDest(opts.dest);
  const copied = runCommand(["rclone", "copy", opts.filePath, dest]);
  if (!copied.ok) {
    const detail = copied.stderr.trim() || `exit`;
    throw new Error(`rclone copy failed: ${detail}`);
  }

  const remotePath = `${dest}${basename(opts.filePath)}`;
  const shareUrl = driveShareUrl(remotePath);

  let result: PublishResult;
  if (opts.isGif) {
    result = { markdown: gifInstruction(opts.filePath, shareUrl), url: shareUrl, fileId: extractDriveFileId(shareUrl) };
  } else {
    let attempt = 0;
    let verified = false;
    let url = "";
    let fileId = extractDriveFileId(shareUrl);
    while (attempt < 2 && !verified) {
      if (attempt > 0) {
        fileId = extractDriveFileId(driveShareUrl(remotePath));
      }
      if (fileId === null) {
        throw new Error(`could not extract a Drive file id from the share url`);
      }
      url = embedUrl(fileId, opts.size);
      const head = runCommand(["curl", "-sIL", url]);
      verified = imageHeadersOk(head.stdout);
      attempt = attempt + 1;
    }
    if (!verified) {
      throw new Error(`embed url did not verify as a 200 image for ${url}`);
    }
    result = { markdown: pngMarkdown(opts.label, url), url, fileId };
  }
  return result;
}
