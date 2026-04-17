// ============================================================
// Concurrent Rate Limiter (Semaphore Pattern)
// ============================================================

/** Configuration for concurrent rate limiter */
export interface RateLimiterConfig {
  /** Maximum number of concurrent requests allowed */
  maxConcurrency: number;
}

/**
 * A simple semaphore-based rate limiter that controls concurrency
 * across async operations.
 */
export class RateLimiter {
  private readonly maxConcurrency: number;
  private activeSlots = 0;
  private waitQueue: Array<() => void> = [];

  constructor(config: RateLimiterConfig) {
    this.maxConcurrency = config.maxConcurrency;
  }

  /** Get current number of active requests */
  getActiveCount(): number {
    return this.activeSlots;
  }

  /** Check if we have available slots */
  hasCapacity(): boolean {
    return this.activeSlots < this.maxConcurrency;
  }

  /** Wait until a slot becomes available */
  private acquire(): Promise<void> {
    if (this.hasCapacity()) {
      this.activeSlots++;
      return Promise.resolve();
    }

    // Queue up a resolver
    return new Promise(resolve => {
      this.waitQueue.push(resolve);
    });
  }

  /** Release a slot and wake up a waiter if any */
  private release(): void {
    this.activeSlots--;

    // Wake up next waiter if queue is not empty
    if (this.waitQueue.length > 0 && this.activeSlots < this.maxConcurrency) {
      const nextResolver = this.waitQueue.shift();
      if (nextResolver) {
        this.activeSlots++;
        nextResolver();
      }
    }
  }

  /**
   * Run an async function under rate limiting
   * @param fn The async function to execute
   * @returns Result of the function
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Create a batch processor that respects concurrency limits
   * @param items Items to process
   * @param processor Async function to process each item
   * @returns Results array maintaining input order
   */
  async map<T, U>(
    items: T[],
    processor: (item: T) => Promise<U>,
  ): Promise<U[]> {
    const results: Array<{ index: number; value: U }> = new Array(items.length);
    
    const promises = items.map(async (item, index) => {
      const result = await this.run(() => processor(item));
      results[index] = { index, value: result };
    });

    await Promise.all(promises);
    
    // Sort by original index to maintain order
    return results.sort((a, b) => a.index - b.index).map(r => r.value);
  }
}
