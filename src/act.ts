import { viewportCenter } from "./scroll.ts";
import { performance } from "node:perf_hooks";
import type { ElementHandle, Page } from "playwright";

/**
 * A short list of steps browsershot runs on the page before it shoots.
 *
 * Some states only exist after the user does something: a menu that is open, a panel that has
 * keyboard focus inside it, a row that is selected. A URL cannot express those. This keeps the
 * steps declarative and tiny so the shot stays reproducible from the command line alone.
 */

export type ActionKind = "focus" | "click" | "hover" | "press" | "type" | "wait" | "scroll" | "reload";

export interface Action {
  kind: ActionKind;
  value: string;
}

export type HoverElementHandle = ElementHandle<HTMLElement | SVGElement>;

const KINDS: ActionKind[] = ["focus", "click", "hover", "press", "type", "wait", "scroll", "reload"];
const STEP_SEPARATOR = ";";
const DEFAULT_STEP_SETTLE_MS = 400;
export const DEFAULT_SCROLL_SPEED = 1000;
const SCROLL_TICK_MS = 50;

type ScrollDirection = "up" | "down" | "left" | "right";
interface DirectionalScroll {
  direction: ScrollDirection;
  amount: number;
  unit: "px" | "%";
}

function parseDirectionalScroll(value: string): DirectionalScroll | null {
  const expression = /^([a-z]+)\(([^()]*)\)$/i.exec(value);
  if (expression == null) {
    if (/^(up|down|left|right)\(/i.test(value)) {
      throw new Error("--act scroll needs a positive pixel or percentage distance, e.g. scroll:down(500px)");
    }
    return null;
  }
  const direction = expression[1]!.toLowerCase();
  if (!["up", "down", "left", "right"].includes(direction)) {
    throw new Error(`unknown scroll direction "${expression[1]}"; use up, down, left, or right`);
  }
  const distance = /^(\d+(?:\.\d+)?)(px|%)$/i.exec(expression[2]!);
  const amount = distance == null ? Number.NaN : Number(distance[1]);
  if (distance == null || !Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER) {
    throw new Error("--act scroll needs a positive pixel or percentage distance, e.g. scroll:down(500px)");
  }
  return { direction: direction as ScrollDirection, amount, unit: distance[2]!.toLowerCase() as "px" | "%" };
}

export function parseActions(raw: string): Action[] {
  const parts = raw.split(STEP_SEPARATOR).map((part) => part.trim());
  const steps = parts.filter((part) => part.length > 0);
  if (steps.length === 0) {
    throw new Error("--act needs at least one step, e.g. focus:button.menu;press:Enter");
  }
  const actions: Action[] = [];
  for (const step of steps) {
    if (step === "reload") {
      actions.push({ kind: "reload", value: "" });
      continue;
    }
    const at = step.indexOf(":");
    if (at < 1) {
      throw new Error(`--act step "${step}" needs a kind and a value, e.g. press:Enter`);
    }
    const kind = step.slice(0, at).trim() as ActionKind;
    const value = step.slice(at + 1).trim();
    if (!KINDS.includes(kind)) {
      throw new Error(`--act step "${step}" has an unknown kind; use one of ${KINDS.join(", ")}`);
    }
    if (kind === "reload") {
      throw new Error(`--act reload takes no value`);
    }
    if (value.length === 0) {
      throw new Error(`--act step "${step}" needs a value after the colon`);
    }
    if ("wait" === kind && !/^\d+$/.test(value)) {
      throw new Error(`--act step "${step}" needs a whole number of milliseconds`);
    }
    if ("scroll" === kind) parseDirectionalScroll(value);
    actions.push({ kind, value });
  }
  return actions;
}

export async function runActions(
  page: Page,
  actions: Action[],
  timeoutMs: number,
  onStep?: (message: string) => void,
  scrollSpeed = DEFAULT_SCROLL_SPEED,
): Promise<HoverElementHandle | null> {
  let finalHoverTarget: HoverElementHandle | null = null;
  for (const [index, action] of actions.entries()) {
    onStep?.(`act: ${action.kind}:${action.value}`);
    if ("reload" === action.kind) {
      await page.reload({ waitUntil: "load", timeout: timeoutMs });
      continue;
    }
    if ("wait" === action.kind) {
      await page.waitForTimeout(Number(action.value));
      continue;
    }
    if ("press" === action.kind) {
      await page.keyboard.press(action.value);
      await page.waitForTimeout(DEFAULT_STEP_SETTLE_MS);
      continue;
    }
    if ("type" === action.kind) {
      await page.keyboard.type(action.value);
      await page.waitForTimeout(DEFAULT_STEP_SETTLE_MS);
      continue;
    }
    if ("scroll" === action.kind) {
      const scroll = parseDirectionalScroll(action.value);
      if (scroll != null) {
        const viewport = page.viewportSize();
        if (viewport == null) throw new Error("directional scrolling requires a page viewport");
        const center = viewportCenter(page);
        let amount = scroll.amount;
        if (scroll.unit === "%") {
          amount = amount / 100 * (scroll.direction === "left" || scroll.direction === "right" ? viewport.width : viewport.height);
        }
        const deltaX = scroll.direction === "left" ? -amount : scroll.direction === "right" ? amount : 0;
        const deltaY = scroll.direction === "up" ? -amount : scroll.direction === "down" ? amount : 0;
        const durationMs = amount / scrollSpeed * 1000;
        const ticks = Math.max(1, Math.ceil(durationMs / SCROLL_TICK_MS));
        const tickMs = durationMs / ticks;
        await page.mouse.move(center.x, center.y);
        const scrollStartedAt = performance.now();
        for (let tick = 0; tick < ticks; tick += 1) {
          await page.mouse.wheel(deltaX / ticks, deltaY / ticks);
          const tickDeadline = scrollStartedAt + (tick + 1) * tickMs;
          const waitMs = tickDeadline - performance.now();
          if (waitMs > 0) await page.waitForTimeout(waitMs);
        }
        await page.waitForTimeout(DEFAULT_STEP_SETTLE_MS);
        continue;
      }
    }
    const target = page.locator(action.value).first();
    await target.waitFor({ state: "attached", timeout: timeoutMs });
    if ("focus" === action.kind) {
      await target.evaluate((node) => (node as HTMLElement).focus());
    } else if ("hover" === action.kind) {
      if (index === actions.length - 1) {
        finalHoverTarget = await target.elementHandle({ timeout: timeoutMs });
      }
      await target.hover({ timeout: timeoutMs });
    } else if ("scroll" === action.kind) {
      await target.scrollIntoViewIfNeeded({ timeout: timeoutMs });
    } else {
      await target.click({ timeout: timeoutMs });
    }
    await page.waitForTimeout(DEFAULT_STEP_SETTLE_MS);
  }
  return finalHoverTarget;
}
