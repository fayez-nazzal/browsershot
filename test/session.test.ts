import { expect, test } from "bun:test";
import { withScope } from "../src/session.ts";

test("withScope closes registered closeables in reverse order when the body throws", async () => {
  const closedOrder: string[] = [];
  const first = { close: () => { closedOrder.push("first"); } };
  const second = { close: () => { closedOrder.push("second"); } };
  const runBody = async () => {
    await withScope(async (scope) => {
      scope.use(first);
      scope.use(second);
      throw new Error("body failed");
    });
  };
  await expect(runBody()).rejects.toThrow("body failed");
  expect(closedOrder).toEqual(["second", "first"]);
});

test("withScope still closes the remaining closeable when an earlier close rejects", async () => {
  const closedOrder: string[] = [];
  const first = { close: () => { throw new Error("close blew up"); } };
  const second = { close: () => { closedOrder.push("second"); } };
  const runBody = async () => {
    await withScope(async (scope) => {
      scope.use(first);
      scope.use(second);
      throw new Error("body failed");
    });
  };
  await expect(runBody()).rejects.toThrow("body failed");
  expect(closedOrder).toEqual(["second"]);
});

test("withScope releases a registered temp path through an injected remover when the body throws", async () => {
  const removedPaths: string[] = [];
  const remover = (path: string) => { removedPaths.push(path); };
  const runBody = async () => {
    await withScope(async (scope) => {
      scope.use({ close: () => remover("/tmp/browsershot-video-xyz") });
      throw new Error("body failed");
    });
  };
  await expect(runBody()).rejects.toThrow("body failed");
  expect(removedPaths).toEqual(["/tmp/browsershot-video-xyz"]);
});
