import type { Action } from "./act.ts";

export type CaptureIdentity =
  | { kind: "url" }
  | { kind: "page"; page: string; element?: string | null; setup?: string | null }
  | { kind: "library"; library: string; entry: string };

export interface CaptureTarget {
  url: string;
  element?: string;
  expectElement?: string;
  expectText?: string;
  actions?: Action[];
  authUser?: string;
  authRedirect?: string;
  viewport?: { width: number; height: number };
  identity: CaptureIdentity;
}
