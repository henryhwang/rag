// ============================================================
// OpenAI-compatible reranker — uses an LLM to score relevance.
// Sends a prompt per document asking for a 0–100 relevance score.
// With retry, timeout support and enhanced error messages
// ============================================================

import { Reranker } from '../types/index.ts';
import { RerankError } from '../errors/index.ts';
import { retryAsync } from '../utils/retry.ts';

export interface OpenAICompatibleRerankerConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Batch size for processing. Default: 10. */
  batchSize?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
}

const DEFAULT_CONFIG: Required<Omit<OpenAICompatibleRerankerConfig, 'apiKey'>> & { apiKey: '' } = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  batchSize: 10,
  timeout: 30000,
  maxRetries: 3,
};

const RERANK_PROMPT = `Score the relevance of this document to the query on a scale of 0-100. Return ONLY the number, nothing else.

Query: {query}
Document: {document}

Score:`;

export class OpenAICompatibleReranker implements Reranker {
  readonly name = 'OpenAICompatibleReranker';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly batchSize: number;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(config?: OpenAICompatibleRerankerConfig) {
    // Merge defaults with user config
    const merged = { ...DEFAULT_CONFIG, ...config };
    
    // For apiKey: use exactly what's provided, don't auto-fallback to env var
    // This allows testing without env vars and works with free/localhost APIs
    this.apiKey = config?.apiKey ?? '';
    
    this.baseUrl = merged.baseUrl;
    this.model = merged.model;
    this.batchSize = merged.batchSize;
    this.timeout = merged.timeout;
    this.maxRetries = merged.maxRetries;
  }

  async rerank(query: string, documents: string[]): Promise<number[]> {
    if (!query.trim()) {
      throw new RerankError('Query cannot be empty');
    }
    if (documents.length === 0) {
      return [];
    }

    const scores: number[] = new Array(documents.length).fill(0);

    // Process in batches
    for (let start = 0; start < documents.length; start += this.batchSize) {
      const end = Math.min(start + this.batchSize, documents.length);
      const batch = documents.slice(start, end);

      const batchScores = await Promise.all(
        batch.map(async (doc, idx) => {
          const prompt = RERANK_PROMPT.replace('{query}', query).replace(
            '{document}',
            doc.slice(0, 2000), // Truncate very long documents
          );

          try {
            const score = await this.callLLM(prompt);
            return score;
          } catch (err) {
            // Log but don't fail - use default score of 0
            console.warn(
              `[Reranker] Failed to score document at index ${start + idx}:`,
              err instanceof Error ? err.message : String(err)
            );
            return 0; // Default score on failure
          }
        }),
      );

      for (let i = 0; i < batch.length; i++) {
        scores[start + i] = batchScores[i];
      }
    }

    return scores;
  }

  private async callLLM(prompt: string): Promise<number> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // Only include Authorization header if apiKey is non-empty
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body = {
      model: this.model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0,
      max_tokens: 10,
    };

    let response: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        const result = await retryAsync(
          () => fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          }),
          { maxRetries: this.maxRetries }
        );
        clearTimeout(timeoutId);
        response = result;
      } catch (err) {
        clearTimeout(timeoutId);
        throw new RerankError(
          `Network error calling reranking API after ${this.maxRetries} attempt(s).\n` +
          `Endpoint: ${url}\n` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`,
          {
            cause: err as Error,
            metadata: { endpoint: url, model: this.model, timeout: this.timeout },
          }
        );
      }
    } catch (err) {
      // Re-throw if it's already our custom error
      if (err instanceof RerankError) throw err;
      throw new RerankError(
        `Network error calling reranking API: ${url}\n` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
        {
          cause: err as Error,
          metadata: { endpoint: url, model: this.model },
        }
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const retryAfter = response.headers.get('Retry-After');
      
      const troubleshooting = [
        'Check API key validity' + (this.apiKey ? '' : ' (no key provided)'),
        `Verify quota/credits for model: ${this.model}`,
      ];
      
      if (response.status === 429) {
        troubleshooting.push(`Rate limit exceeded${retryAfter ? `. Retry after: ${retryAfter}s` : ''}`);
      }
      
      throw new RerankError(
        `Reranking API returned HTTP ${response.status}${text ? ': ' + text.substring(0, 150) : ''}.\n` +
        `Endpoint: ${url}\n` +
        `Troubleshooting:\n` +
        troubleshooting.map(t => `  ${t}`).join('\n'),
        {
          metadata: {
            endpoint: url,
            status: response.status,
            model: this.model,
            ...(retryAfter && { retryAfter: Number(retryAfter) }),
          },
        }
      );
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content?.trim() ?? '';
    const score = parseInt(content, 10);

    if (isNaN(score) || score < 0 || score > 100) {
      throw new RerankError(
        `LLM returned invalid score: "${content}" (expected 0-100).\n` +
        `Prompt: ${prompt.substring(0, 100)}...`,
        { metadata: { endpoint: url, model: this.model, received: content } }
      );
    }

    // Normalize to 0-1 range
    return score / 100;
  }
}
