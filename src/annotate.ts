// Draw box and marker annotations onto PNG bytes via macOS Cocoa/CoreGraphics
// through JXA (osascript), no extra dependencies.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

export interface RGB { red: number; green: number; blue: number }
export interface BoxAnnotation { x: number; y: number; w: number; h: number; color: RGB }
export interface MarkerAnnotation { x: number; y: number; color: RGB }

export const BOX_STROKE_WIDTH = 4;
export const MARKER_RADIUS = 12;
export const MARKER_OUTLINE_WIDTH = 3;
export const DEFAULT_ANNOTATION_COLOR = "red";

export const NAMED_COLORS: Record<string, string> = {};
NAMED_COLORS.red = "#ff0000";
NAMED_COLORS.green = "#008000";
NAMED_COLORS.blue = "#0000ff";
NAMED_COLORS.yellow = "#ffff00";
NAMED_COLORS.orange = "#ffa500";
NAMED_COLORS.purple = "#800080";
NAMED_COLORS.black = "#000000";
NAMED_COLORS.white = "#ffffff";

// NSColor.set/setFill/setStroke and NSBezierPath.stroke/fill do not resolve
// through the JXA bridge (same class of gap as the $.kCG* constants), so all
// drawing goes through scalar CoreGraphics calls bound explicitly. The source
// PNG is composited into a fresh 8-bit RGBA bitmap before drawing because
// graphicsContextWithBitmapImageRep rejects the rep formats screencapture
// produces (16-bit / Display P3). Annotation coordinates are top-left origin;
// CoreGraphics is bottom-left, hence the height - y flips.
const DRAW_ANNOTATIONS_JXA = `
  ObjC.import('Cocoa');
  ObjC.bindFunction('CGContextSetRGBStrokeColor', ['void', ['void*', 'double', 'double', 'double', 'double']]);
  ObjC.bindFunction('CGContextSetRGBFillColor', ['void', ['void*', 'double', 'double', 'double', 'double']]);
  ObjC.bindFunction('CGContextSetLineWidth', ['void', ['void*', 'double']]);
  ObjC.bindFunction('CGContextBeginPath', ['void', ['void*']]);
  ObjC.bindFunction('CGContextMoveToPoint', ['void', ['void*', 'double', 'double']]);
  ObjC.bindFunction('CGContextAddLineToPoint', ['void', ['void*', 'double', 'double']]);
  ObjC.bindFunction('CGContextClosePath', ['void', ['void*']]);
  ObjC.bindFunction('CGContextStrokePath', ['void', ['void*']]);
  ObjC.bindFunction('CGContextFillPath', ['void', ['void*']]);
  ObjC.bindFunction('CGContextAddArc', ['void', ['void*', 'double', 'double', 'double', 'double', 'double', 'int']]);
  ObjC.bindFunction('CGContextFlush', ['void', ['void*']]);
  function addRect(cg, x, y, w, h) {
    $.CGContextBeginPath(cg);
    $.CGContextMoveToPoint(cg, x, y);
    $.CGContextAddLineToPoint(cg, x + w, y);
    $.CGContextAddLineToPoint(cg, x + w, y + h);
    $.CGContextAddLineToPoint(cg, x, y + h);
    $.CGContextClosePath(cg);
  }
  function addCircle(cg, x, y, radius) {
    $.CGContextBeginPath(cg);
    $.CGContextAddArc(cg, x, y, radius, 0, Math.PI * 2, 0);
    $.CGContextClosePath(cg);
  }
  function run(argv) {
    var srcPath = argv[0];
    var dstPath = argv[1];
    var spec = JSON.parse(argv[2]);
    var data = $.NSData.dataWithContentsOfFile(srcPath);
    var src = $.NSBitmapImageRep.imageRepWithData(data);
    if (src.isNil()) { throw new Error('could not read PNG at ' + srcPath); }
    var width = src.pixelsWide;
    var height = src.pixelsHigh;
    var rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel($(), width, height, 8, 4, true, false, $.NSDeviceRGBColorSpace, width * 4, 32);
    if (rep.isNil()) { throw new Error('could not allocate drawing bitmap'); }
    var ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
    if (ctx.isNil()) { throw new Error('could not create drawing context'); }
    $.NSGraphicsContext.setCurrentContext(ctx);
    var img = $.NSImage.alloc.initWithData(data);
    if (img.isNil()) { throw new Error('could not decode PNG at ' + srcPath); }
    img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, width, height), $.NSMakeRect(0, 0, 0, 0), 1, 1);
    var cg = ctx.CGContext;
    spec.boxes.forEach(function (b) {
      $.CGContextSetRGBStrokeColor(cg, b.red, b.green, b.blue, 1);
      $.CGContextSetLineWidth(cg, spec.boxStroke);
      addRect(cg, b.x, height - b.y - b.h, b.w, b.h);
      $.CGContextStrokePath(cg);
    });
    spec.markers.forEach(function (m) {
      var cy = height - m.y;
      $.CGContextSetRGBFillColor(cg, m.red, m.green, m.blue, 1);
      addCircle(cg, m.x, cy, spec.markerRadius);
      $.CGContextFillPath(cg);
      $.CGContextSetRGBStrokeColor(cg, 1, 1, 1, 1);
      $.CGContextSetLineWidth(cg, spec.markerOutline);
      addCircle(cg, m.x, cy, spec.markerRadius);
      $.CGContextStrokePath(cg);
    });
    $.CGContextFlush(cg);
    var out = rep.representationUsingTypeProperties(4, $());
    if (out.isNil()) { throw new Error('could not encode PNG'); }
    if (!out.writeToFileAtomically(dstPath, true)) { throw new Error('could not write PNG to ' + dstPath); }
    return 'ok';
  }
`;

export function parseColor(raw: string): RGB {
  const trimmed = raw.trim().toLowerCase();
  let hex: string | undefined = NAMED_COLORS[trimmed];
  if (hex == null && /^#[0-9a-f]{6}$/.test(trimmed)) {
    hex = trimmed;
  }
  if (hex == null) {
    throw new Error(`color must be #RRGGBB or one of: ${Object.keys(NAMED_COLORS).join(", ")}, got "${raw}"`);
  }
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  return { red, green, blue };
}

function annotationInt(flag: string, part: string, raw: string, min: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`--${flag} ${part} must be an integer >= ${min}, got "${raw}"`);
  }
  return n;
}

export function parseBoxFlag(raw: string): BoxAnnotation {
  const parts = raw.split(",");
  if (parts.length < 4 || parts.length > 5) {
    throw new Error(`--box must look like x,y,w,h[,color], got "${raw}"`);
  }
  const x = annotationInt("box", "x", parts[0]!.trim(), 0);
  const y = annotationInt("box", "y", parts[1]!.trim(), 0);
  const w = annotationInt("box", "w", parts[2]!.trim(), 1);
  const h = annotationInt("box", "h", parts[3]!.trim(), 1);
  let color = parseColor(DEFAULT_ANNOTATION_COLOR);
  if (parts.length === 5) {
    color = parseColor(parts[4]!);
  }
  return { x, y, w, h, color };
}

export function parseMarkerFlag(raw: string): MarkerAnnotation {
  const parts = raw.split(",");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`--marker must look like x,y[,color], got "${raw}"`);
  }
  const x = annotationInt("marker", "x", parts[0]!.trim(), 0);
  const y = annotationInt("marker", "y", parts[1]!.trim(), 0);
  let color = parseColor(DEFAULT_ANNOTATION_COLOR);
  if (parts.length === 3) {
    color = parseColor(parts[2]!);
  }
  return { x, y, color };
}

export function annotationSpec(boxes: BoxAnnotation[], markers: MarkerAnnotation[]): string {
  const flatBoxes = [];
  for (const b of boxes) {
    flatBoxes.push({ x: b.x, y: b.y, w: b.w, h: b.h, red: b.color.red, green: b.color.green, blue: b.color.blue });
  }
  const flatMarkers = [];
  for (const m of markers) {
    flatMarkers.push({ x: m.x, y: m.y, red: m.color.red, green: m.color.green, blue: m.color.blue });
  }
  return JSON.stringify({ boxStroke: BOX_STROKE_WIDTH, markerRadius: MARKER_RADIUS, markerOutline: MARKER_OUTLINE_WIDTH, boxes: flatBoxes, markers: flatMarkers });
}

export function drawAnnotations(png: Uint8Array, boxes: BoxAnnotation[], markers: MarkerAnnotation[]): Uint8Array {
  let result = png;
  if (boxes.length > 0 || markers.length > 0) {
    const stamp = `${process.pid}-${Date.now()}`;
    const src = join(tmpdir(), `annotate-${stamp}-src.png`);
    const dst = join(tmpdir(), `annotate-${stamp}-dst.png`);
    writeFileSync(src, png);
    try {
      const proc = Bun.spawnSync(["osascript", "-l", "JavaScript", "-e", DRAW_ANNOTATIONS_JXA, src, dst, annotationSpec(boxes, markers)]);
      if (!proc.success) {
        const err = new TextDecoder().decode(proc.stderr).trim();
        const detail = err || `exit ${proc.exitCode}`;
        throw new Error(`annotation drawing failed: ${detail}`);
      }
      result = new Uint8Array(readFileSync(dst));
    } finally {
      for (const p of [src, dst]) {
        try {
          unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return result;
}
