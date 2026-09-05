import type { ElementHandle, Page } from "playwright";

/**
 * A short list of steps browsershot runs on the page before it shoots.
 *
 * Some states only exist after the user does something: a menu that is open, a panel that has
 * keyboard focus inside it, a row that is selected. A URL cannot express those. This keeps the
 * steps declarative and tiny so the shot stays reproducible from the command line alone.
 */

export type ActionKind = "focus" | "click" | "hover" | "press" | "type" | "wait";

export interface Action {
  kind: ActionKind;
  value: string;
}

export type HoverElementHandle = ElementHandle<HTMLElement | SVGElement>;

const KINDS: ActionKind[] = ["focus", "click", "hover", "press", "type", "wait"];
const STEP_SEPARATOR = ";";
const DEFAULT_STEP_SETTLE_MS = 400;

export function parseActions(raw: string): Action[] {
  const parts = raw.split(STEP_SEPARATOR).map((part) => part.trim());
  const steps = parts.filter((part) => part.length > 0);
  if (steps.length === 0) {
    throw new Error("--act needs at least one step, e.g. focus:button.menu;press:Enter");
  }
  const actions: Action[] = [];
  for (const step of steps) {
    const at = step.indexOf(":");
    if (at < 1) {
      throw new Error(`--act step "${step}" needs a kind and a value, e.g. press:Enter`);
    }
    const kind = step.slice(0, at).trim() as ActionKind;
    const value = step.slice(at + 1).trim();
    if (!KINDS.includes(kind)) {
      throw new Error(`--act step "${step}" has an unknown kind; use one of ${KINDS.join(", ")}`);
    }
    if (value.length === 0) {
      throw new Error(`--act step "${step}" needs a value after the colon`);
    }
    if ("wait" === kind && !/^\d+$/.test(value)) {
      throw new Error(`--act step "${step}" needs a whole number of milliseconds`);
    }
    actions.push({ kind, value });
  }
  return actions;
}

export async function runActions(page: Page, actions: Action[], timeoutMs: number, onStep?: (message: string) => void): Promise<HoverElementHandle | null> {
  let finalHoverTarget: HoverElementHandle | null = null;
  for (const [index, action] of actions.entries()) {
    onStep?.(`act: ${action.kind}:${action.value}`);
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
    const target = page.locator(action.value).first();
    await target.waitFor({ state: "attached", timeout: timeoutMs });
    if ("focus" === action.kind) {
      await target.evaluate((node) => (node as HTMLElement).focus());
    } else if ("hover" === action.kind) {
      if (index === actions.length - 1) {
        finalHoverTarget = await target.elementHandle({ timeout: timeoutMs });
      }
      await target.hover({ timeout: timeoutMs });
    } else {
      await target.click({ timeout: timeoutMs });
    }
    await page.waitForTimeout(DEFAULT_STEP_SETTLE_MS);
  }
  return finalHoverTarget;
}
