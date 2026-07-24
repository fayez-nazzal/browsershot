import { expect, test } from "bun:test";
import { remoteName, normalizeDest, basename, labelFromPath, extractDriveFileId, embedUrl, pngMarkdown, gifInstruction, rcloneRemoteConfigured, imageHeadersOk, DEFAULT_EMBED_WIDTH } from "../src/publish.ts";

test("remoteName reads the segment before the first colon", () => {
  expect(remoteName("gdrive:PR-Shots/repo/branch/")).toBe("gdrive");
  expect(remoteName("gdrive:")).toBe("gdrive");
});

test("remoteName is empty for a dest with no remote", () => {
  expect(remoteName("PR-Shots/repo")).toBe("");
  expect(remoteName(":path")).toBe("");
});

test("normalizeDest guarantees a single trailing slash", () => {
  expect(normalizeDest("gdrive:PR-Shots/repo")).toBe("gdrive:PR-Shots/repo/");
  expect(normalizeDest("gdrive:PR-Shots/repo/")).toBe("gdrive:PR-Shots/repo/");
});

test("basename returns the last path segment", () => {
  expect(basename("/Users/x/browsershot/home.png")).toBe("home.png");
  expect(basename("home.png")).toBe("home.png");
});

test("labelFromPath drops the directory and extension", () => {
  expect(labelFromPath("/Users/x/browsershot/auth-after.png")).toBe("auth-after");
  expect(labelFromPath("home.gif")).toBe("home");
  expect(labelFromPath("noext")).toBe("noext");
});

test("extractDriveFileId reads the id from open and /d/ urls", () => {
  expect(extractDriveFileId("https://drive.google.com/open?id=1cH7vkbI8x5sUwG")).toBe("1cH7vkbI8x5sUwG");
  expect(extractDriveFileId("https://drive.google.com/file/d/1cH7vkbI8x5sUwG/view")).toBe("1cH7vkbI8x5sUwG");
});

test("extractDriveFileId returns null when there is no id", () => {
  expect(extractDriveFileId("https://example.com/nope")).toBeNull();
});

test("embedUrl builds the direct high-res googleusercontent form", () => {
  expect(embedUrl("ABC123", DEFAULT_EMBED_WIDTH)).toBe("https://lh3.googleusercontent.com/d/ABC123=w2560");
  expect(embedUrl("ABC123", 3840)).toBe("https://lh3.googleusercontent.com/d/ABC123=w3840");
});

test("pngMarkdown emits a single image line", () => {
  expect(pngMarkdown("home", "https://lh3.googleusercontent.com/d/ABC=w2560")).toBe("![home](https://lh3.googleusercontent.com/d/ABC=w2560)");
});

test("gifInstruction names the local file and the archive link", () => {
  const line = gifInstruction("/Users/x/browsershot/flow.gif", "https://drive.google.com/open?id=ABC");
  expect(line).toBe("GIF: drag /Users/x/browsershot/flow.gif into the PR description editor to embed the animation; Drive archive: https://drive.google.com/open?id=ABC.");
});

test("rcloneRemoteConfigured matches an exact remote line", () => {
  expect(rcloneRemoteConfigured("gdrive", "gdrive:\ndropbox:\n")).toBe(true);
  expect(rcloneRemoteConfigured("gdrive", "dropbox:\n")).toBe(false);
  expect(rcloneRemoteConfigured("gdrive", "gdrive2:\n")).toBe(false);
});

test("imageHeadersOk accepts a direct 200 image", () => {
  const direct200 = "HTTP/2 200 \ncontent-type: image/png\n";
  expect(imageHeadersOk(direct200)).toBe(true);
});

test("imageHeadersOk requires the final hop to be a 200 image", () => {
  const redirectThen200 = "HTTP/2 302 \ncontent-type: application/binary\nHTTP/2 200 \ncontent-type: image/png\n";
  expect(imageHeadersOk(redirectThen200)).toBe(true);
});

test("imageHeadersOk fails when the final status is not 200", () => {
  const redirectThen404 = "HTTP/2 302 \ncontent-type: application/binary\nHTTP/2 404 \ncontent-type: text/html\n";
  expect(imageHeadersOk(redirectThen404)).toBe(false);
});

test("imageHeadersOk fails when the final type is not an image", () => {
  const okStatusHtml = "HTTP/2 200 \ncontent-type: text/html\n";
  expect(imageHeadersOk(okStatusHtml)).toBe(false);
});
