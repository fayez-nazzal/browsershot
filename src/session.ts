export interface Closeable {
  close(): Promise<void> | void;
}

export interface Scope {
  use<C extends Closeable>(closeable: C): C;
}

export async function withScope<T>(body: (scope: Scope) => Promise<T>): Promise<T> {
  const closeables: Closeable[] = [];
  const scope: Scope = {
    use<C extends Closeable>(closeable: C): C {
      closeables.push(closeable);
      return closeable;
    },
  };
  let result: T;
  try {
    result = await body(scope);
  } finally {
    for (let index = closeables.length - 1; index >= 0; index = index - 1) {
      try {
        await closeables[index]!.close();
      } catch {
        // Swallow release errors so the body's original error still propagates.
      }
    }
  }
  return result;
}
