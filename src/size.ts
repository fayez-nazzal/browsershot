export interface ViewportSize {
  width: number;
  height: number;
}

export function parseSize(value: string): ViewportSize | null {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (match === null) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    return null;
  }
  return { width, height };
}
