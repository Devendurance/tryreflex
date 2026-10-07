export interface Limiter {
  tryAcquire(): (() => void) | null;
  inFlight(): number;
}

export function createLimiter(max: number): Limiter {
  let count = 0;
  return {
    tryAcquire() {
      if (count >= max) return null;
      count += 1;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          count -= 1;
        }
      };
    },
    inFlight() {
      return count;
    },
  };
}

export const marketContextLimiter = createLimiter(4);
