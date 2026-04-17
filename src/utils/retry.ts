// ============================================================
// Retry Logic with Exponential Backoff
// ============================================================

import { RAGError } from '../errors/index.ts';

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;
  /** Max delay cap in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Whether to add jitter (random variation) to delays (default: true) */
  jitter?: boolean;
  /** HTTP status codes that should trigger a retry */
  retryableStatuses?: number[];
}

export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  retryableStatuses: [429, 500, 502, 503, 504],
};

export class RetryError extends RAGError {
  constructor(
    message: string,
    private readonly lastError: Error,
    private readonly attempts: number,
  ) {
    super(message);
    this.name = 'RetryError';
    this.cause = lastError;
  }

  getFinalError(): Error {
    return this.lastError;
  }
}

/** Calculate delay with exponential backoff and optional jitter */
function calculateDelay(
  attempt: number,
  config: Required<RetryConfig>,
): number {
  const exponentialDelay =
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  if (config.jitter) {
    // Add up to 30% random variation
    const jitterRange = cappedDelay * 0.3;
    return cappedDelay + (Math.random() - 0.5) * 2 * jitterRange;
  }

  return cappedDelay;
}

/** Check if an error or response should trigger a retry */
function isRetryable(error: unknown, config: Required<RetryConfig>): boolean {
  // Network errors
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }

  // Timeout errors
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }

  // HTTP-like errors with status codes
  if (error instanceof RAGError && 'status' in error) {
    const status = (error as any).status as number;
    return config.retryableStatuses.includes(status);
  }

  return false;
}

/** Sleep for specified milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff
 * @param fn The async function to execute
 * @param config Retry configuration
 * @returns Result of the function on success
 * @throws RetryError if all retries are exhausted
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {},
): Promise<T> {
  const resolvedConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error;

  for (let attempt = 0; attempt <= resolvedConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if not retryable or we've exhausted retries
      const remainingAttempts = resolvedConfig.maxRetries - attempt;
      if (!isRetryable(error, resolvedConfig) || remainingAttempts === 0) {
        throw new RetryError(
          `Operation failed after ${attempt + 1} attempt(s): ${lastError.message}`,
          lastError,
          attempt + 1,
        );
      }

      // Calculate and apply delay
      const delay = calculateDelay(attempt, resolvedConfig);
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error('Unreachable');
}
