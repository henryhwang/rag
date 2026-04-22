// ============================================================
// OpenAI-compatible embedding provider
// Works with OpenAI, Ollama, vLLM, LiteLLM, etc.
// ============================================================

import { type EmbeddingProvider } from '../types/index.ts';
import { EmbeddingError } from '../errors/index.ts';
import { retryAsync } from '../utils/retry.ts';

export interface OpenAICompatibleEmbeddingsConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  dimensions?: number;
  encodingFormat?: string;
  timeout?: number;         // Request timeout in ms (default: 30000)
  maxRetries?: number;      // Max retry attempts (default: 3)
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
}

const DEFAULT_DIMENSIONS = 1024;
const DEFAULT_ENCODINGFORMAT = "float";
const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;

export class OpenAICompatibleEmbeddings implements EmbeddingProvider {
  readonly dimensions: number;
  readonly encodingFormat: string;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly fetchFn: (url: string, init?: RequestInit) => Promise<Response>;

  constructor(config: OpenAICompatibleEmbeddingsConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.baseURL = config.baseURL ?? DEFAULT_BASE_URL;
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.encodingFormat = config.encodingFormat ?? DEFAULT_ENCODINGFORMAT;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new EmbeddingError(
        `API key is required for embeddings.\n` +
        `Set via config.apiKey or OPENAI_API_KEY environment variable.\n` +
        `Current state: ${this.apiKey ? '✅ API key present' : '❌ API key missing'}\n` +
        `Endpoint: ${this.baseURL}\n` +
        `Model: ${this.model}`,
        { metadata: { model: this.model, endpoint: this.baseURL } }
      );
    }

    const url = `${this.baseURL.replace(/\/+$/, '')}/embeddings`;

    // Build request body — include dimensions when explicitly configured
    const body: Record<string, unknown> = {
      model: this.model,
      input: texts,
      dimensions: this.dimensions,
      encoding_format: this.encodingFormat
    };

    let response: Response;
    try {
      // Use AbortController for timeout support
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      try {
        // Wrap fetch in retry logic
        const result = await retryAsync(
          () => this.fetchWithTimeout(url, body, controller),
          { maxRetries: this.maxRetries }
        );
        clearTimeout(timeoutId);
        response = result.response;
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    } catch (err) {
      throw new EmbeddingError(
        `Network error calling embeddings API after ${this.maxRetries} retry attempt(s).\n` +
        `Endpoint: ${url}\n` +
        `Troubleshooting:\n` +
        `  1. Check network connectivity to ${this.baseURL}\n` +
        `  2. Verify firewall/proxy settings allow outbound HTTPS\n` +
        `  3. Check if API service is available\n` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
        {
          cause: err as Error,
          metadata: {
            endpoint: url,
            numItems: texts.length,
            model: this.model,
            timeout: this.timeout,
            maxRetries: this.maxRetries,
          },
        }
      );
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');

      // Parse rate limit info from headers if available
      const retryAfter = response.headers.get('Retry-After');

      let troubleshooting = [
        `Check API key validity`,
        `Verify sufficient quota/credits for model: ${this.model}`,
      ];

      if (response.status === 429) {
        troubleshooting.unshift(`Rate limit exceeded${retryAfter ? `. Retry after: ${retryAfter}s` : ''}`);
      } else if (response.status >= 500) {
        troubleshooting.push(`This may be a temporary server issue - try again later`);
      } else if (response.status === 401 || response.status === 403) {
        troubleshooting.unshift(`Authentication failed - verify API key is correct and has required permissions`);
      }

      throw new EmbeddingError(
        `Embeddings API returned HTTP ${response.status}${bodyText ? ':\n' + bodyText.substring(0, 200) : ''}.\n` +
        `Endpoint: ${url}\n` +
        `Troubleshooting:\n` +
        `  \n`.split('\n').map((t) => t.startsWith('Troubleshoot') ? t : `  ${t}`).join('\n'),
        {
          metadata: {
            endpoint: url,
            status: response.status,
            numItems: texts.length,
            model: this.model,
            ...(retryAfter && { retryAfter: Number(retryAfter) }),
          },
        }
      );
    }

    const json = (await response.json()) as { data: Array<{ embedding: number[] }> };

    // M6: Validate response length matches input
    if (json.data.length !== texts.length) {
      throw new EmbeddingError(
        `Embedding API returned ${json.data.length} embeddings for ${texts.length} texts`,
        {
          metadata: {
            endpoint: url,
            numItems: texts.length,
            received: json.data.length,
            model: this.model,
          },
        }
      );
    }

    return json.data.map((d) => d.embedding);
  }

  /** Fetch with timeout support - called by retryAsync */
  private async fetchWithTimeout(
    url: string,
    body: object,
    controller: AbortController
  ): Promise<{ response: Response }> {
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    return { response };
  }
}
