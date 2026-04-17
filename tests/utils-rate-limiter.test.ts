// ============================================================
// Rate Limiter Tests
// 
// Tests semaphore-based concurrent request limiting
// ============================================================

import { describe, it, expect, beforeEach } from 'bun:test';
import { RateLimiter } from '../src/utils/rate-limiter.ts';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ maxConcurrency: 3 });
  });

  it('should allow up to maxConcurrency requests simultaneously', async () => {
    let activeCount = 0;
    let peakActiveCount = 0;
    
    const tasks = Array.from({ length: 10 }, (_, i) => 
      limiter.run(async () => {
        activeCount++;
        peakActiveCount = Math.max(peakActiveCount, activeCount);
        
        // Wait briefly to simulate work
        await new Promise(resolve => setTimeout(resolve, 50));
        
        activeCount--;
        return i;
      })
    );
    
    const results = await Promise.all(tasks);
    
    expect(results.length).toBe(10);
    expect(peakActiveCount).toBeLessThanOrEqual(3); // Never exceed limit
    expect(peakActiveCount).toBeGreaterThanOrEqual(3); // Should reach limit
  });

  it('should maintain result order with map()', async () => {
    const inputs = [1, 2, 3, 4, 5];
    
    const results = await limiter.map(inputs, async (num) => {
      await new Promise(resolve => setTimeout(resolve, num * 10));
      return num * 2;
    });
    
    // Results should be in same order as inputs
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('should update active count correctly', async () => {
    expect(limiter.getActiveCount()).toBe(0);
    expect(limiter.hasCapacity()).toBe(true);
    
    const promise = limiter.run(async () => {
      expect(limiter.getActiveCount()).toBe(1);
      await new Promise(resolve => setTimeout(resolve, 10));
      return 'done';
    });
    
    await promise;
    expect(limiter.getActiveCount()).toBe(0);
  });

  it('hasCapacity() should reflect current state', async () => {
    const limiter2 = new RateLimiter({ maxConcurrency: 2 });
    
    expect(limiter2.hasCapacity()).toBe(true);
    
    // Fill up all slots
    const p1 = limiter2.run(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    
    const p2 = limiter2.run(async () => {
      expect(limiter2.hasCapacity()).toBe(false); // Full now
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    
    await Promise.all([p1, p2]);
    expect(limiter2.hasCapacity()).toBe(true); // Free again
  });

  it('should handle errors without leaking slots', async () => {
    const results: Array<'success' | 'error'> = [];
    
    const tasks = Array.from({ length: 5 }, (_, i) => 
      limiter.run(async () => {
        if (i % 2 === 1) { // Odd indices fail
          throw new Error(`task ${i} failed`);
        }
        results.push('success');
      }).catch(() => {
        results.push('error');
      })
    );
    
    await Promise.all(tasks);
    
    // All slots should be released even after errors
    expect(limiter.getActiveCount()).toBe(0);
    // indices 0, 2, 4 succeed; indices 1, 3 fail
    expect(results.filter(r => r === 'success')).toHaveLength(3);
    expect(results.filter(r => r === 'error')).toHaveLength(2);
  });

  it('should respect concurrency limit under load', async () => {
    const limiter3 = new RateLimiter({ maxConcurrency: 2 });
    let maxConcurrent = 0;
    let current = 0;
    
    const tasks = Array.from({ length: 20 }, () => 
      limiter3.run(async () => {
        current++;
        maxConcurrent = Math.max(maxConcurrent, current);
        
        await new Promise(resolve => setTimeout(resolve, 20));
        
        current--;
      })
    );
    
    await Promise.all(tasks);
    
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('map() should handle empty array', async () => {
    const results = await limiter.map([], async (_x) => {
      return 'never called';
    });
    
    expect(results).toEqual([]);
  });

  it('map() should preserve input order regardless of completion time', async () => {
    // Item at index 3 is fastest, item at index 0 is slowest
    const inputs = [0, 1, 2, 3, 4];
    
    const results = await limiter.map(inputs, async (index) => {
      // Reverse timing - higher index completes faster
      const delay = (5 - index) * 20;
      await new Promise(resolve => setTimeout(resolve, delay));
      return `result-${index}`;
    });
    
    // Output must match input order despite different completion times
    expect(results).toEqual([
      'result-0',
      'result-1',
      'result-2',
      'result-3',
      'result-4',
    ]);
  });

  it('should handle rapid sequential calls', async () => {
    const limiter4 = new RateLimiter({ maxConcurrency: 5 });
    const executionOrder: number[] = [];
    
    const tasks = Array.from({ length: 100 }, (_, i) => 
      limiter4.run(async () => {
        executionOrder.push(i);
        await new Promise(resolve => setTimeout(resolve, 1));
      })
    );
    
    await Promise.all(tasks);
    
    expect(executionOrder.length).toBe(100);
    // First batch should complete before second batch starts due to low concurrency
    expect(executionOrder[0]).toBeLessThan(5);
  });
});
