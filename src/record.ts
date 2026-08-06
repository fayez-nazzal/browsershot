export interface Frame {
  data: string;
  timestamp: number;
}

export const MIN_DELAY_SECONDS = 0.02;
export const MAX_DELAY_SECONDS = 10;

function clampDelay(seconds: number): number {
  let result = seconds;
  if (result < MIN_DELAY_SECONDS) {
    result = MIN_DELAY_SECONDS;
  }
  if (result > MAX_DELAY_SECONDS) {
    result = MAX_DELAY_SECONDS;
  }
  return result;
}

export function frameDelaysSeconds(frames: Frame[], tailSeconds: number): number[] {
  const delays: number[] = [];
  for (let index = 0; index < frames.length; index = index + 1) {
    const next = frames[index + 1];
    let delay = tailSeconds;
    if (next != null) {
      delay = next.timestamp - frames[index]!.timestamp;
    }
    delays.push(clampDelay(delay));
  }
  return delays;
}

export interface Mark {
  kind: "start" | "stop";
  at: number;
}

export interface RecordWindow {
  from: number;
  to: number;
}

export function buildWindows(marks: Mark[]): RecordWindow[] {
  const windows: RecordWindow[] = [];
  let open: number | null = null;
  for (const mark of marks) {
    if ("start" === mark.kind) {
      open = mark.at;
    }
    if ("stop" === mark.kind) {
      let from = -Infinity;
      if (open !== null) {
        from = open;
      }
      windows.push({ from, to: mark.at });
      open = null;
    }
  }
  if (open !== null) {
    windows.push({ from: open, to: Infinity });
  }
  if (windows.length === 0) {
    windows.push({ from: -Infinity, to: Infinity });
  }
  return windows;
}

function isInsideAnyWindow(at: number, windows: RecordWindow[]): boolean {
  let result = false;
  for (const window of windows) {
    if (at >= window.from && at <= window.to) {
      result = true;
    }
  }
  return result;
}

export function sliceFrames(frames: Frame[], marks: Mark[]): Frame[] {
  const windows = buildWindows(marks);
  const kept: Frame[] = [];
  for (const frame of frames) {
    const inside = isInsideAnyWindow(frame.timestamp, windows);
    if (inside) {
      kept.push(frame);
    }
  }
  return kept;
}
