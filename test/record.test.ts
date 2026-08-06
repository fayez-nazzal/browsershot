import { expect, test } from "bun:test";
import { frameDelaysSeconds, MIN_DELAY_SECONDS, MAX_DELAY_SECONDS, buildWindows, sliceFrames } from "../src/record.ts";

test("frameDelaysSeconds measures the gap to the next frame", () => {
  const frames = [
    { data: "a", timestamp: 100 },
    { data: "b", timestamp: 100.033 },
    { data: "c", timestamp: 100.066 },
  ];
  const delays = frameDelaysSeconds(frames, 1);
  expect(delays[0]).toBeCloseTo(0.033, 3);
  expect(delays[1]).toBeCloseTo(0.033, 3);
});

test("frameDelaysSeconds gives the last frame the tail hold", () => {
  const frames = [
    { data: "a", timestamp: 100 },
    { data: "b", timestamp: 100.5 },
  ];
  const delays = frameDelaysSeconds(frames, 2);
  expect(delays[1]).toBe(2);
});

test("frameDelaysSeconds floors a tiny gap so browsers do not clamp it", () => {
  const frames = [
    { data: "a", timestamp: 100 },
    { data: "b", timestamp: 100.005 },
  ];
  const delays = frameDelaysSeconds(frames, 1);
  expect(delays[0]).toBe(MIN_DELAY_SECONDS);
});

test("frameDelaysSeconds caps a long pause", () => {
  const frames = [
    { data: "a", timestamp: 100 },
    { data: "b", timestamp: 160 },
  ];
  const delays = frameDelaysSeconds(frames, 1);
  expect(delays[0]).toBe(MAX_DELAY_SECONDS);
});

test("frameDelaysSeconds floors the tail too", () => {
  const frames = [{ data: "a", timestamp: 100 }];
  const delays = frameDelaysSeconds(frames, 0);
  expect(delays).toEqual([MIN_DELAY_SECONDS]);
});

test("frameDelaysSeconds returns nothing for no frames", () => {
  expect(frameDelaysSeconds([], 1)).toEqual([]);
});

const FRAMES = [
  { data: "a", timestamp: 1 },
  { data: "b", timestamp: 3 },
  { data: "c", timestamp: 6 },
  { data: "d", timestamp: 9 },
];

test("buildWindows keeps everything when there are no marks", () => {
  expect(buildWindows([])).toEqual([{ from: -Infinity, to: Infinity }]);
});

test("buildWindows treats a leading stop as a window from the beginning", () => {
  const windows = buildWindows([{ kind: "stop", at: 5 }]);
  expect(windows).toEqual([{ from: -Infinity, to: 5 }]);
});

test("buildWindows runs an unclosed start to the end", () => {
  const windows = buildWindows([{ kind: "start", at: 4 }]);
  expect(windows).toEqual([{ from: 4, to: Infinity }]);
});

test("buildWindows cuts a slow middle section out", () => {
  const marks = [
    { kind: "stop" as const, at: 4 },
    { kind: "start" as const, at: 8 },
  ];
  expect(buildWindows(marks)).toEqual([
    { from: -Infinity, to: 4 },
    { from: 8, to: Infinity },
  ]);
});

test("sliceFrames keeps every frame when there are no marks", () => {
  expect(sliceFrames(FRAMES, [])).toEqual(FRAMES);
});

test("sliceFrames drops frames outside the window", () => {
  const kept = sliceFrames(FRAMES, [{ kind: "start", at: 5 }]);
  expect(kept.map((frame) => frame.data)).toEqual(["c", "d"]);
});

test("sliceFrames keeps both sides of a cut middle", () => {
  const marks = [
    { kind: "stop" as const, at: 4 },
    { kind: "start" as const, at: 8 },
  ];
  const kept = sliceFrames(FRAMES, marks);
  expect(kept.map((frame) => frame.data)).toEqual(["a", "b", "d"]);
});
