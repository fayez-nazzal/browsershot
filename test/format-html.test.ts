import { expect, test } from "bun:test";
import { formatHtml } from "../src/format-html.ts";

const MINIFIED = "<!doctype html><html><head><style>.a{color:red}.b{margin:0}</style></head><body><div><p>hi</p></div></body></html>";

test("formatHtml indents the document and splits embedded CSS rules", async () => {
  const formatted = await formatHtml(MINIFIED);
  expect(formatted).toContain("\n  <head>\n    <style>\n      .a {");
  expect(formatted).toContain("\n  <body>\n    <div><p>hi</p></div>\n  </body>");
  expect(formatted).toContain(".a {\n        color: red;\n      }");
  expect(formatted).toContain(".b {");
});

test("formatHtml is idempotent", async () => {
  const once = await formatHtml(MINIFIED);
  expect(await formatHtml(once)).toBe(once);
});
