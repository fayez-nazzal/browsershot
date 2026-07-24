import { expect, test } from "bun:test";
import { parseColor, parseBoxFlag, parseMarkerFlag, annotationSpec, BOX_STROKE_WIDTH, MARKER_RADIUS, MARKER_OUTLINE_WIDTH } from "../src/annotate.ts";

test("parseColor accepts named colors case-insensitively", () => {
  expect(parseColor("red")).toEqual({ red: 1, green: 0, blue: 0 });
  expect(parseColor("RED")).toEqual({ red: 1, green: 0, blue: 0 });
  expect(parseColor("white")).toEqual({ red: 1, green: 1, blue: 1 });
});

test("parseColor accepts #RRGGBB hex", () => {
  expect(parseColor("#ff0000")).toEqual({ red: 1, green: 0, blue: 0 });
  expect(parseColor("#00FF00")).toEqual({ red: 0, green: 1, blue: 0 });
});

test("parseColor rejects invalid input", () => {
  expect(() => parseColor("tealish")).toThrow(/color must be/);
  expect(() => parseColor("#ff00")).toThrow(/color must be/);
  expect(() => parseColor("")).toThrow(/color must be/);
});

test("parseBoxFlag parses x,y,w,h with the red default color", () => {
  expect(parseBoxFlag("10,20,300,400")).toEqual({ x: 10, y: 20, w: 300, h: 400, color: { red: 1, green: 0, blue: 0 } });
});

test("parseBoxFlag parses an explicit trailing color", () => {
  expect(parseBoxFlag("0,0,1,1,blue")).toEqual({ x: 0, y: 0, w: 1, h: 1, color: { red: 0, green: 0, blue: 1 } });
});

test("parseBoxFlag rejects wrong arity and bad numbers", () => {
  expect(() => parseBoxFlag("10,20,300")).toThrow(/--box must look like/);
  expect(() => parseBoxFlag("10,20,300,400,red,extra")).toThrow(/--box must look like/);
  expect(() => parseBoxFlag("-1,0,10,10")).toThrow(/--box x/);
  expect(() => parseBoxFlag("0,0,0,10")).toThrow(/--box w/);
  expect(() => parseBoxFlag("a,0,10,10")).toThrow(/--box x/);
});

test("parseMarkerFlag parses x,y with default and explicit colors", () => {
  expect(parseMarkerFlag("50,60")).toEqual({ x: 50, y: 60, color: { red: 1, green: 0, blue: 0 } });
  expect(parseMarkerFlag("50,60,#0000ff")).toEqual({ x: 50, y: 60, color: { red: 0, green: 0, blue: 1 } });
});

test("parseMarkerFlag rejects wrong arity and bad numbers", () => {
  expect(() => parseMarkerFlag("50")).toThrow(/--marker must look like/);
  expect(() => parseMarkerFlag("50,60,red,extra")).toThrow(/--marker must look like/);
  expect(() => parseMarkerFlag("50,-2")).toThrow(/--marker y/);
});

test("annotationSpec flattens shapes and pins the stroke defaults", () => {
  const spec = JSON.parse(annotationSpec([parseBoxFlag("1,2,3,4")], [parseMarkerFlag("5,6,white")]));
  expect(spec.boxStroke).toBe(BOX_STROKE_WIDTH);
  expect(spec.markerRadius).toBe(MARKER_RADIUS);
  expect(spec.markerOutline).toBe(MARKER_OUTLINE_WIDTH);
  expect(spec.boxes).toEqual([{ x: 1, y: 2, w: 3, h: 4, red: 1, green: 0, blue: 0 }]);
  expect(spec.markers).toEqual([{ x: 5, y: 6, red: 1, green: 1, blue: 1 }]);
});
