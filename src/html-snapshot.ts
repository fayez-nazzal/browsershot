import type { Locator, Page } from "playwright";

// Runs inside the page: must stay self-contained (no imports, no outer references).
// Returns a complete HTML document for the element (or the page body when root is
// null/body/html): the sanitised markup, the html/body shell, and only the CSS
// rules that apply, with media queries resolved at the current viewport/colour scheme.
const SNAPSHOT = (root: Element | null): string => {
  interface Deferred { key: string; text: string }
  interface Bucket { styles: string[]; deferred: Deferred[] }
  type Part =
    | { kind: "link"; href: string }
    | { kind: "style"; source: string | null; styles: string[]; deferred: Deferred[] };

  const html = document.documentElement;
  const body = document.body;
  const wholePage = root === null || root === body || root === html;
  const target: Element = wholePage || root === null ? body : root;

  const scope: Element[] = [];
  if (wholePage) {
    scope.push(html, body);
  } else {
    for (let node: Element | null = target; node !== null; node = node.parentElement) scope.push(node);
  }
  const appliesTo = (selector: string): boolean =>
    scope.some((node) => node.matches(selector)) || target.querySelector(selector) !== null;
  const test = (selector: string): boolean | null => {
    try {
      return appliesTo(selector);
    } catch {
      return null;
    }
  };
  const RELAX = /::[\w-]+(?:\([^)]*\))?|:(?:before|after|first-line|first-letter|hover|active|focus|focus-visible|focus-within|visited|link|any-link|target)\b/g;
  const ruleApplies = (selectorText: string): boolean => {
    const result = test(selectorText);
    if (result !== false) return true;
    const relaxed = selectorText.replace(RELAX, "");
    if (relaxed === selectorText) return false;
    if (relaxed.trim() === "") return true;
    return test(relaxed) !== false;
  };

  const absolutizeUrls = (text: string, base: string | null): string => {
    if (base === null) return text;
    return text.replace(/url\("((?:[^"\\]|\\.)*)"\)/g, (match: string, raw: string) => {
      if (raw.startsWith("#") || raw.startsWith("data:")) return match;
      try {
        return `url("${new URL(raw, base).href}")`;
      } catch {
        return match;
      }
    });
  };

  const mediaMatches = (mediaText: string): boolean => mediaText === "" || matchMedia(mediaText).matches;

  const walk = (rules: CSSRuleList, base: string | null, out: Bucket, links: Part[]): void => {
    for (const rule of Array.from(rules)) {
      const kind = rule.constructor.name;
      if (kind === "CSSStyleRule") {
        if (ruleApplies((rule as CSSStyleRule).selectorText)) out.styles.push(absolutizeUrls(rule.cssText, base));
      } else if (kind === "CSSMediaRule") {
        const media = rule as CSSMediaRule;
        if (mediaMatches(media.media.mediaText)) walk(media.cssRules, base, out, links);
      } else if (kind === "CSSImportRule") {
        const imported = rule as CSSImportRule;
        if (!mediaMatches(imported.media.mediaText)) continue;
        const sheet = imported.styleSheet;
        try {
          if (sheet === null) throw new Error("import not loaded");
          walk(sheet.cssRules, sheet.href ?? base, out, links);
        } catch {
          links.push({ kind: "link", href: new URL(imported.href, base ?? document.baseURI).href });
        }
      } else if (kind === "CSSFontFaceRule") {
        const family = (rule as CSSFontFaceRule).style.getPropertyValue("font-family").replace(/["']/g, "").trim();
        out.deferred.push({ key: family, text: absolutizeUrls(rule.cssText, base) });
      } else if (kind === "CSSKeyframesRule" || kind === "CSSPropertyRule") {
        const name = "name" in rule && typeof rule.name === "string" ? rule.name : "";
        out.deferred.push({ key: name, text: absolutizeUrls(rule.cssText, base) });
      } else if (kind === "CSSPageRule" || kind === "CSSNamespaceRule") {
        continue;
      } else if (kind === "CSSLayerStatementRule") {
        out.styles.push(rule.cssText);
      } else if ("cssRules" in rule) {
        const inner: Bucket = { styles: [], deferred: [] };
        walk((rule as CSSGroupingRule).cssRules, base, inner, links);
        if (inner.styles.length > 0) {
          const header = rule.cssText.slice(0, rule.cssText.indexOf("{")).trim();
          out.styles.push(`${header} {\n${inner.styles.join("\n")}\n}`);
        }
        out.deferred.push(...inner.deferred);
      } else {
        out.styles.push(absolutizeUrls(rule.cssText, base));
      }
    }
  };

  const parts: Part[] = [];
  const sheets: CSSStyleSheet[] = [...Array.from(document.styleSheets), ...document.adoptedStyleSheets];
  for (const sheet of sheets) {
    if (sheet.disabled) continue;
    if (!mediaMatches(sheet.media.mediaText)) continue;
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      if (sheet.href !== null) parts.push({ kind: "link", href: sheet.href });
      continue;
    }
    const bucket: Bucket = { styles: [], deferred: [] };
    const importLinks: Part[] = [];
    walk(rules, sheet.href, bucket, importLinks);
    parts.push(...importLinks, { kind: "style", source: sheet.href, styles: bucket.styles, deferred: bucket.deferred });
  }

  // Clone, carrying live form state onto the clone as attributes.
  const clone = target.cloneNode(true) as Element;
  const liveNodes = [target, ...Array.from(target.querySelectorAll("*"))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll("*"))];
  liveNodes.forEach((live, index) => {
    const copy = cloneNodes[index];
    if (copy === undefined) return;
    if (live instanceof HTMLInputElement) {
      if (live.type === "checkbox" || live.type === "radio") copy.toggleAttribute("checked", live.checked);
      else if (live.type !== "password" && live.type !== "file") copy.setAttribute("value", live.value);
    } else if (live instanceof HTMLTextAreaElement) {
      copy.textContent = live.value;
    } else if (live instanceof HTMLOptionElement) {
      copy.toggleAttribute("selected", live.selected);
    }
  });
  clone.querySelectorAll('script, noscript, style, link[rel~="stylesheet" i], #browsershot-inspector').forEach((node) => node.remove());
  const snippet = wholePage ? clone.innerHTML : clone.outerHTML;

  const openTag = (element: Element): string => {
    const markup = (element.cloneNode(false) as Element).outerHTML;
    return markup.slice(0, markup.length - `</${element.localName}>`.length);
  };
  const htmlOpen = openTag(html);
  const bodyOpen = openTag(body);

  // Deferred at-rules (fonts, keyframes, @property) are kept only when referenced.
  const haystack = [
    ...parts.flatMap((part) => (part.kind === "style" ? part.styles : [])),
    snippet,
    htmlOpen,
    bodyOpen,
  ].join("\n");
  for (const part of parts) {
    if (part.kind !== "style") continue;
    for (const rule of part.deferred) {
      if (rule.key === "" || haystack.includes(rule.key)) part.styles.push(rule.text);
    }
  }

  const ancestors: Element[] = [];
  if (!wholePage) {
    for (let node = target.parentElement; node !== null && node !== body && node !== html; node = node.parentElement) {
      ancestors.unshift(node);
    }
  }
  const wrapperOpen = ancestors.map(openTag).join("");
  const wrapperClose = ancestors.map((node) => `</${node.localName}>`).reverse().join("");

  const escapeAttribute = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const safeCss = (css: string): string => css.replace(/<\/style/gi, "<\\/style");

  const head: string[] = ['<meta charset="utf-8">'];
  if (document.baseURI !== "about:blank") head.push(`<base href="${escapeAttribute(document.baseURI)}">`);
  for (const part of parts) {
    if (part.kind === "link") {
      head.push(`<link rel="stylesheet" href="${escapeAttribute(part.href)}">`);
    } else if (part.styles.length > 0) {
      const comment = part.source === null ? [] : [`/* ${part.source.replace(/\*\//g, "*%2F")} */`];
      head.push(`<style>\n${safeCss([...comment, ...part.styles].join("\n"))}\n</style>`);
    }
  }

  return [
    "<!doctype html>",
    htmlOpen,
    "<head>",
    ...head,
    "</head>",
    bodyOpen,
    `${wrapperOpen}${snippet}${wrapperClose}`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
};

export async function snapshotHtml(page: Page, element: Locator | null): Promise<string> {
  const handle = element === null ? null : await element.elementHandle();
  return page.evaluate(SNAPSHOT, handle);
}
