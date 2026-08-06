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
