import { expect, test } from "bun:test";
import { frameDelaysSeconds, MIN_DELAY_SECONDS, MAX_DELAY_SECONDS } from "../src/record.ts";

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
