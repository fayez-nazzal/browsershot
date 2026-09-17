import type { Page, Request, Response, WebSocket } from "playwright";

export type NetworkCategory = "resources" | "api" | "websockets";
export type HttpOutcome = "completed" | "failed" | "aborted" | "pending";

export interface RedactedValue {
  value: string;
  redacted?: boolean;
  truncated?: boolean;
}
export interface NetworkCollectionDiagnostic { kind: "collection" | "serialization"; message: string; count?: number }
export interface NetworkRequestRecord {
  kind: "http";
  method: RedactedValue;
  url: RedactedValue;
  query: { key: RedactedValue; value: RedactedValue }[];
  queryRaw: RedactedValue;
  requestHeaders: Record<string, RedactedValue>;
  requestBody?: RedactedValue;
  frame?: { url?: RedactedValue; name?: RedactedValue };
  resourceType: string;
  timing: { startedAtMs: number; endedAtMs?: number; durationMs?: number; startedAt: string; endedAt?: string };
  response?: { status?: number; statusText?: RedactedValue; reference?: RedactedValue };
  failure?: RedactedValue;
  deliverySource: "network" | "cache" | "service-worker" | "unknown";
  outcome: HttpOutcome;
  redactionApplied: boolean;
  truncated?: boolean;
}
export interface WebSocketMessageRecord { direction: "sent" | "received"; type: "text" | "binary" | "unknown"; size: number; elapsedMs: number; at: string }
export interface WebSocketRecord {
  kind: "websocket"; url: RedactedValue; startedAtMs: number; startedAt: string; endedAtMs?: number; endedAt?: string;
  outcome: "open" | "closed" | "failed" | "pending"; messages: WebSocketMessageRecord[]; messagesTruncated?: number; redactionApplied: boolean;
}
export interface NetworkAttempt { attempt: number; startedAt: string; cutoffAt: string; cutoffElapsedMs: number; captureInitiatedAt: string; resources?: NetworkRequestRecord[]; api?: NetworkRequestRecord[]; websockets?: WebSocketRecord[]; diagnostics?: NetworkCollectionDiagnostic[]; recordsTruncated?: { resources?: number; api?: number; websockets?: number }; redactionNotice: string }

const MAX_RECORDS = 1000;
const MAX_MESSAGES = 200;
const MAX_FIELD = 8192;
const SENSITIVE = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|api-key|token|access-token|refresh-token|secret|password|passwd|client-secret|private-key)$/i;
const SENSITIVE_URL = /(?:token|key|secret|password|passwd|auth|credential|session)[^=&?#]*/i;

function value(input: unknown, state: { redacted: boolean; truncated?: boolean }): RedactedValue {
  let text = typeof input === "string" ? input : String(input ?? "");
  if (text.length > MAX_FIELD) { text = `${text.slice(0, MAX_FIELD)}…`; state.truncated = true; }
  return { value: text, ...(state.redacted ? { redacted: true } : {}), ...(state.truncated ? { truncated: true } : {}) };
}
function redact(input: unknown, sensitive = false, state = { redacted: false, truncated: false }): RedactedValue {
  if (sensitive) { state.redacted = true; return value("[REDACTED]", state); }
  return value(input, state);
}
function safeUrl(raw: string, state: { redacted: boolean; truncated?: boolean }): RedactedValue {
  try {
    const parsed = new URL(raw);
    for (const key of [...parsed.searchParams.keys()]) if (SENSITIVE_URL.test(key)) { parsed.searchParams.set(key, "[REDACTED]"); state.redacted = true; }
    return value(parsed.toString(), state);
  } catch { return redact(raw, false, state); }
}
function headerRecord(headers: Record<string, string>, state: { redacted: boolean; truncated?: boolean }): Record<string, RedactedValue> {
  const result: Record<string, RedactedValue> = {};
  for (const [key, item] of Object.entries(headers)) result[key] = redact(item, SENSITIVE.test(key), state);
  return result;
}
function frameContext(request: Request, state: { redacted: boolean; truncated?: boolean }) {
  const frame = request.frame();
  if (frame == null) return undefined;
  return { url: safeUrl(frame.url(), state), ...(frame.name() ? { name: redact(frame.name(), false, state) } : {}) };
}
function nowIso() { return new Date().toISOString(); }
function classify(type: string): NetworkCategory { return type === "xhr" || type === "fetch" ? "api" : "resources"; }

type DeliverySource = "network" | "cache" | "service-worker" | "unknown";
type DeliveryProbe = { fromServiceWorker?: () => boolean; fromCache?: () => boolean };

function resolveDeliverySource(response: unknown): DeliverySource {
  const probe = response as DeliveryProbe;
  try {
    if (typeof probe.fromServiceWorker === "function" && probe.fromServiceWorker()) return "service-worker";
    if (typeof probe.fromCache === "function") return probe.fromCache() ? "cache" : "network";
  } catch {
    return "unknown";
  }
  return "unknown";
}
function safeQuery(raw: string, state: { redacted: boolean; truncated?: boolean }): RedactedValue {
  try {
    const safe = safeUrl(raw, state).value;
    return redact(new URL(safe).search, false, state);
  } catch {
    return redact("", false, state);
  }
}

export function createNetworkCollector(page: Page, categories: readonly NetworkCategory[], attempt = 1) {
  const enabled = new Set(categories);
  const startedWall = new Date(); const started = Date.now();
  const requests = new Map<Request, NetworkRequestRecord>();
  const websockets: WebSocketRecord[] = []; const diagnostics: NetworkCollectionDiagnostic[] = [];
  const trunc: { resources?: number; api?: number; websockets?: number } = {};
  const add = (category: "resources" | "api", record: NetworkRequestRecord) => {
    const list = category === "api" ? api : resources;
    if (list.length >= MAX_RECORDS) { trunc[category] = (trunc[category] ?? 0) + 1; return; }
    list.push(record);
  };
  const resources: NetworkRequestRecord[] = []; const api: NetworkRequestRecord[] = [];
  const onRequest = (request: Request) => {
    const category = classify(request.resourceType()); if (!enabled.has(category)) return;
    const list = category === "api" ? api : resources;
    if (list.length >= MAX_RECORDS) { trunc[category] = (trunc[category] ?? 0) + 1; return; }
    try {
      const state = { redacted: false, truncated: false }; const raw = request.url(); const parsed = new URL(raw);
      const query = [...parsed.searchParams.entries()].map(([key, item]) => ({ key: redact(key, SENSITIVE_URL.test(key), state), value: redact(item, SENSITIVE_URL.test(key), state) }));
      const record: NetworkRequestRecord = { kind: "http", method: redact(request.method(), false, state), url: safeUrl(raw, state), query, queryRaw: safeQuery(raw, state), requestHeaders: headerRecord(request.headers(), state), requestBody: request.postData() == null ? undefined : redact(request.postData(), /password|token|secret|key/i.test(request.postData() ?? ""), state), frame: frameContext(request, state), resourceType: request.resourceType(), timing: { startedAtMs: Date.now() - started, startedAt: nowIso() }, deliverySource: "unknown", outcome: "pending", redactionApplied: state.redacted, ...(state.truncated ? { truncated: true } : {}) };
      requests.set(request, record); add(category, record);
    } catch (error) { diagnostics.push({ kind: "collection", message: `request observation failed: ${(error as Error).message}` }); }
  };
  const finish = (request: Request, outcome: HttpOutcome, response?: Response) => { const record = requests.get(request); if (!record) return; const end = Date.now(); record.outcome = outcome; record.timing.endedAtMs = end - started; record.timing.durationMs = record.timing.endedAtMs - record.timing.startedAtMs; record.timing.endedAt = nowIso(); if (response) { const state = { redacted: false, truncated: false }; record.response = { status: response.status(), statusText: redact(response.statusText(), false, state), reference: safeUrl(response.url(), state) }; record.deliverySource = resolveDeliverySource(response); record.redactionApplied = record.redactionApplied || state.redacted; } else if (outcome === "failed") record.failure = redact(request.failure()?.errorText ?? "unknown"); };
  if (enabled.has("resources") || enabled.has("api")) { page.on("request", onRequest); page.on("response", response => finish(response.request(), "completed", response)); page.on("requestfailed", request => finish(request, request.failure()?.errorText?.toLowerCase().includes("abort") ? "aborted" : "failed")); }
  if (enabled.has("websockets")) page.on("websocket", (socket: WebSocket) => {
    if (websockets.length >= MAX_RECORDS) { trunc.websockets = (trunc.websockets ?? 0) + 1; return; }
    const state = { redacted: false, truncated: false };
    const record: WebSocketRecord = { kind: "websocket", url: safeUrl(socket.url(), state), startedAtMs: Date.now() - started, startedAt: nowIso(), outcome: "open", messages: [], redactionApplied: state.redacted };
    websockets.push(record);
    const message = (direction: "sent" | "received") => (payload: string | Buffer) => {
      if (record.messages.length >= MAX_MESSAGES) { record.messagesTruncated = (record.messagesTruncated ?? 0) + 1; return; }
      const size = typeof payload === "string" ? payload.length : payload.byteLength;
      record.messages.push({ direction, type: typeof payload === "string" ? "text" : "binary", size, elapsedMs: Date.now() - started, at: nowIso() });
    };
    socket.on("framesent", message("sent")); socket.on("framereceived", message("received"));
    socket.on("close", () => { record.outcome = "closed"; record.endedAtMs = Date.now() - started; record.endedAt = nowIso(); });
    socket.on("socketerror", () => { record.outcome = "failed"; });
  });
  let captureMarker: { cutoffElapsedMs: number; captureInitiatedAt: string } | undefined;
  return { markCaptureInitiated() { captureMarker ??= { cutoffElapsedMs: Date.now() - started, captureInitiatedAt: nowIso() }; return captureMarker; }, finish(): NetworkAttempt { const marker = captureMarker ?? this.markCaptureInitiated(); return { attempt, startedAt: startedWall.toISOString(), cutoffAt: marker.captureInitiatedAt, ...marker, ...(enabled.has("resources") ? { resources } : {}), ...(enabled.has("api") ? { api } : {}), ...(enabled.has("websockets") ? { websockets } : {}), ...(diagnostics.length ? { diagnostics } : {}), ...(Object.keys(trunc).length ? { recordsTruncated: trunc } : {}), redactionNotice: "Known-sensitive values are redacted; redaction does not detect every secret." }; } };
}
