import type { Page } from "playwright";

// Directional wheel actions and full-page capture use the same point in the viewport.
export function viewportCenter(page: Page): { x: number; y: number } {
  const viewport = page.viewportSize();
  if (viewport == null) throw new Error("scrolling requires a page viewport");
  return { x: viewport.width / 2, y: viewport.height / 2 };
}

export async function captureFullPage(page: Page): Promise<Uint8Array> {
  const changes = await page.evaluateHandle(({ x, y }) => {
    let node = document.elementFromPoint(x, y);
    while (
      node != null &&
      node !== document.body &&
      node !== document.documentElement
    ) {
      const style = getComputedStyle(node);
      if (
        /(auto|scroll|overlay)/.test(style.overflowY) &&
        node.scrollHeight > node.clientHeight
      )
        break;
      node = node.parentElement;
    }
    const saved: {
      element: HTMLElement;
      style: string | null;
      scrollTop: number;
    }[] = [];
    if (
      !(node instanceof HTMLElement) ||
      node === document.body ||
      node === document.documentElement
    )
      return saved;
    for (
      let element: HTMLElement | null = node;
      element != null;
      element = element.parentElement
    ) {
      saved.push({
        element,
        style: element.getAttribute("style"),
        scrollTop: element.scrollTop,
      });
      element.style.setProperty("height", "auto", "important");
      element.style.setProperty("max-height", "none", "important");
      element.style.setProperty("flex", "0 0 auto", "important");
      if (element === node) {
        element.style.setProperty("overflow-x", "visible", "important");
        element.style.setProperty("overflow-y", "visible", "important");
      }
      if (element === document.documentElement || element === document.body) {
        element.style.setProperty("scrollbar-width", "none", "important");
      }
      element.scrollTop = 0;
    }
    return saved;
  }, viewportCenter(page));
  try {
    if ((await changes.evaluate((saved) => saved.length)) > 0) {
      await page.evaluate(() => {
        const { promise, resolve } = Promise.withResolvers<void>();
        requestAnimationFrame(() => requestAnimationFrame(resolve));
        return promise;
      });
    }
    return await page.screenshot({ fullPage: true });
  } finally {
    try {
      await changes.evaluate((saved) => {
        for (const { element, style, scrollTop } of saved) {
          if (style === null) element.removeAttribute("style");
          else element.setAttribute("style", style);
          element.scrollTop = scrollTop;
        }
      });
    } finally {
      await changes.dispose();
    }
  }
}
