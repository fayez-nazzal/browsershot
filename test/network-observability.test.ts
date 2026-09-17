import { expect, test } from "bun:test";
import { createNetworkCollector } from "../src/network-observability.ts";

test("disabled categories install no listeners", () => {
  const events: string[] = [];
  const page = { on(name: string) { events.push(name); } } as never;
  const collector = createNetworkCollector(page, []);
  expect(events).toEqual([]);
  expect(collector.finish().resources).toBeUndefined();
});

test("HTTP resources and API preserve classification and cutoff", () => {
  const page = { on(name: string, handler: (value: unknown) => void) { handlers[name] = handler; } } as never;
  const handlers: Record<string, (value: unknown) => void> = {};
  const collector = createNetworkCollector(page, ["resources", "api"]);
  const request = (type: string) => ({ resourceType: () => type, url: () => `https://example.test/${type}?q=diagnostic&token=private`, method: () => "GET", headers: () => ({ "x-diagnostic": "visible", authorization: "secret" }), postData: () => null, frame: () => null, failure: () => null });
  const resource = request("script"); const api = request("fetch");
  handlers.request(resource); handlers.request(api); collector.markCaptureInitiated();
  handlers.response({ request: () => resource, status: () => 200, statusText: () => "OK", url: () => resource.url(), fromCache: () => false, fromServiceWorker: () => false });
  const result = collector.finish();
  expect(result.resources?.[0]?.outcome).toBe("completed");
  expect(result.api?.[0]?.resourceType).toBe("fetch");
  expect(result.api?.[0]?.url.value).not.toContain("private");
  expect(result.api?.[0]?.requestHeaders.authorization?.value).toBe("[REDACTED]");
  expect(result.cutoffElapsedMs).toBeGreaterThanOrEqual(0);
  expect(result.captureInitiatedAt).toMatch(/Z$/);
});
