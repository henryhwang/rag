// ============================================================
// Dedicated Reranker — uses /v1/rerank endpoint (Jina/Cohere compatible)
// Fast, cheap, and purpose-built for reranking (much better than chat/completions)
// ============================================================
import { type Reranker } from '../types/index.ts';
import { RerankError } from '../errors/index.ts';
import { retryAsync } from '../utils/retry.ts';
import { getBatchIndices, estimateTokens } from './batching.ts';

export interface DedicatedRerankerConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Maximum number of documents per request */
  batchSize?: number;
  /** Maximum total content length (characters) per batch */
  maxContentLengthPerBatch?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Whether to return normalized scores (0–1). Default: true */
  normalizeScores?: boolean;
  /** Custom fetch function (useful for testing) */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
}

const DEFAULT_CONFIG: Required<Omit<DedicatedRerankerConfig, 'apiKey' | 'fetchFn'>> & { apiKey: '' } = {
  apiKey: '',
  baseUrl: 'https://api.siliconflow.cn/v1',
  model: 'BAAI/bge-reranker-v2-m3',
  batchSize: 100,
  maxContentLengthPerBatch: Infinity, // No limit by default
  timeout: 30000,
  maxRetries: 3,
  normalizeScores: true,
};

export class DedicatedReranker implements Reranker {
  readonly name = 'DedicatedReranker';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly batchSize: number;
  private readonly maxContentLengthPerBatch: number;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly normalizeScores: boolean;
  private readonly fetchFn: (url: string, init?: RequestInit) => Promise<Response>;

  constructor(config: DedicatedRerankerConfig = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };

    this.apiKey = config.apiKey ?? process.env.RERANKER_API_KEY ?? '';
    this.baseUrl = merged.baseUrl.replace(/\/$/, '');
    this.model = merged.model;
    this.batchSize = merged.batchSize;
    this.maxContentLengthPerBatch = merged.maxContentLengthPerBatch;
    this.timeout = merged.timeout;
    this.maxRetries = merged.maxRetries;
    this.normalizeScores = merged.normalizeScores;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  async rerank(query: string, documents: string[]): Promise<number[]> {
    if (!this.apiKey) {
      throw new RerankError('API key is required for DedicatedReranker');
    }
    if (!query?.trim()) {
      throw new RerankError('Query cannot be empty');
    }
    if (documents.length === 0) {
      return [];
    }

    const scores: number[] = new Array(documents.length).fill(0);

    // Precompute document sizes (character count as proxy for tokens)
    const docSizes = documents.map(d => d.length);

    for (const [start, end] of getBatchIndices(
      documents.length,
      docSizes,
      this.batchSize,
      this.maxContentLengthPerBatch
    )) {
      const batch = documents.slice(start, end);

      const batchScores = await this.callRerankEndpoint(query, batch);
      for (let i = 0; i < batchScores.length; i++) {
        scores[start + i] = batchScores[i];
      }
    }

    return scores;
  }

  private async callRerankEndpoint(query: string, documents: string[]): Promise<number[]> {
    const url = `${this.baseUrl}/v1/rerank`;

    const body = {
      model: this.model,
      query: query,
      documents: documents,           // array of strings
      // top_n is optional — we want scores for ALL documents in original order
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await retryAsync(
        () =>
          this.fetchFn(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          }),
        { maxRetries: this.maxRetries }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new RerankError(
          `Rerank endpoint returned HTTP ${response.status}: ${text.substring(0, 200)}`,
          {
            metadata: { status: response.status, model: this.model, endpoint: url },
          }
        );
      }

      const data = (await response.json()) as any;

      // Jina-style response: { results: [{ index: number, document: string, relevance_score: number }, ...] }
      if (data.results && Array.isArray(data.results)) {
        const scoreMap = new Map<number, number>();

        for (const item of data.results) {
          if (typeof item.index === 'number' && typeof item.relevance_score === 'number') {
            scoreMap.set(item.index, item.relevance_score);
          }
        }

        // Return scores in original document order
        return documents.map((_, idx) => {
          const score = scoreMap.get(idx) ?? 0;
          return this.normalizeScores ? Math.max(0, Math.min(1, score)) : score;
        });
      }

      // Some endpoints (Cohere-style) return differently — add support if needed
      throw new RerankError('Unexpected response format from rerank endpoint', {
        metadata: { receivedKeys: Object.keys(data) },
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof RerankError) throw err;

      throw new RerankError(`Failed to call rerank endpoint: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err as Error,
      });
    }
  }
}

// Export for testing purposes
export { getBatchIndices, estimateTokens };
