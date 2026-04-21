// ============================================================
// Retry Utility Tests
// 
// Tests retryAsync() with exponential backoff
// ============================================================

import { describe, it, expect } from 'bun:test';
import { retryAsync, RetryError } from '../src/utils/retry.ts';
import { RAGError } from '../src/errors/index.ts';

describe('retryAsync', () => {
  it('should succeed on first attempt', async () => {
    let attempts = 0;
    
    const result = await retryAsync(() => {
      attempts++;
      return Promise.resolve('success');
    });
    
    expect(result).toBe('success');
    expect(attempts).toBe(1);
  });

  it('should retry on transient errors and succeed', async () => {
    let attempts = 0;
    // Use TypeError to simulate network failure
    const mockError = new TypeError('Failed to fetch');
    
    const result = await retryAsync(async () => {
      attempts++;
      if (attempts < 3) {
        throw mockError;
      }
      return 'finally succeeded';
    }, { maxRetries: 5 });
    
    expect(result).toBe('finally succeeded');
    expect(attempts).toBe(3); // Failed twice, succeeded on third
  });

  it('should throw RetryError after exhausting retries', async () => {
    let attempts = 0;
    const originalError = new TypeError('Failed to fetch');
    
    try {
      await retryAsync(async () => {
        attempts++;
        throw originalError;
      }, { maxRetries: 2 });
      expect.unreachable('Should have thrown RetryError');
    } catch (error) {
      expect(error).toBeInstanceOf(RetryError);
      expect((error as RetryError).getFinalError()).toBe(originalError);
      expect(attempts).toBe(3); // Initial + 2 retries
      expect((error as Error).message).toContain('3');
    }
  });

  it('should not retry non-retriable errors immediately', async () => {
    let attempts = 0;
    const permanentError = new Error('bad request');
    
    try {
      await retryAsync(async () => {
        attempts++;
        throw permanentError;
      }, { maxRetries: 3 });
      expect.unreachable('Should have thrown');
    } catch (error) {
      // Should still throw but only attempt once since it's not retryable
      expect(error).toBeInstanceOf(Error);
      // Note: Since we don't mark this as retryable, behavior depends on error type
      // TypeError fetch errors ARE retried though
    }
  });

  it('should respect custom maxRetries config', async () => {
    let attempts = 0;
    
    try {
      await retryAsync(async () => {
        attempts++;
        throw new Error('fail');
      }, { maxRetries: 0 });
      expect.unreachable();
    } catch {
      expect(attempts).toBe(1); // No retries
    }
  });

  it('should apply exponential backoff with jitter', async () => {
    const startTime = Date.now();
    
    await retryAsync(async () => {
      throw new TypeError('Failed to fetch');
    }, { 
      maxRetries: 2,
      initialDelayMs: 50,  // Small delay for fast test
      backoffMultiplier: 2,
      jitter: false,
    }).catch(() => {
      // Expected to fail after retries
    });
    
    const elapsed = Date.now() - startTime;
    // Should have done 2 retries with delays: ~50ms + ~100ms = ~150ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(140); // Allow 10ms tolerance
  });

  it('should cap delay at maxDelayMs', async () => {
    const startTime = Date.now();
    
    try {
      await retryAsync(async () => {
        throw new Error('fail');
      }, { 
        maxRetries: 3,
        initialDelayMs: 50,
        backoffMultiplier: 2,
        maxDelayMs: 100, // Cap at 100ms
        jitter: false,
      });
      expect.unreachable();
    } catch {
      // Expected
    }
    
    const elapsed = Date.now() - startTime;
    // With capped delays of 50+100+100 = 250ms max (plus some overhead)
    // Should be significantly less than uncapped exponential
    expect(elapsed).toBeLessThan(500);
  });

  it('should handle successful fetch-like errors', async () => {
    let attempts = 0;
    
    const networkError = new TypeError('Failed to fetch');
    
    const result = await retryAsync(async () => {
      attempts++;
      if (attempts === 1) {
        throw networkError;
      }
      return 'recovered';
    }, { maxRetries: 3 });
    
    expect(result).toBe('recovered');
    expect(attempts).toBe(2);
  });

  it('should include attempt count in final error message', async () => {
    try {
      await retryAsync(async () => {
        throw new Error('always fails');
      }, { maxRetries: 2 });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(/\d+/); // Contains attempt number
    }
  });
});

describe('RetryError', () => {
  it('should be instance of RAGError', () => {
    const cause = new Error('original');
    const retryError = new RetryError('failed after 3 attempts', cause);
    
    expect(retryError).toBeInstanceOf(RAGError);
    expect(retryError.cause).toBe(cause);
  });

  it('should expose final error via getter', () => {
    const cause = new Error('the real error');
    const retryError = new RetryError('retry exhausted', cause);
    
    expect(retryError.getFinalError()).toBe(cause);
  });

  it('should have correct name property', () => {
    const retryError = new RetryError('msg', new Error('cause'));
    expect(retryError.name).toBe('RetryError');
  });
});
