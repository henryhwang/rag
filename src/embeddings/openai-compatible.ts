// ============================================================
// OpenAI-compatible embedding provider
// Works with OpenAI, Ollama, vLLM, LiteLLM, etc.
// ============================================================

import { EmbeddingProvider } from '../types/index.ts';
import { EmbeddingError } from '../errors/index.ts';

export interface OpenAICompatibleEmbeddingsConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  dimensions?: number;
}

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAICompatibleEmbeddings implements EmbeddingProvider {
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;

  constructor(config: OpenAICompatibleEmbeddingsConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.baseURL = config.baseURL ?? DEFAULT_BASE_URL;
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new EmbeddingError(
        'API key is required. Set it via config.apiKey or the OPENAI_API_KEY env var.',
      );
    }

    const url = `${this.baseURL.replace(/\/+$/, '')}/embeddings`;

    // Build request body — include dimensions when explicitly configured
    const body: Record<string, unknown> = {
      model: this.model,
      input: texts,
    };
    if (this.dimensions !== DEFAULT_DIMENSIONS) {
      body.dimensions = this.dimensions;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new EmbeddingError(`Network error calling embeddings API: ${url}`, {
        cause: err as Error,
      });
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new EmbeddingError(
        `Embeddings API error ${response.status}: ${bodyText}`,
      );
    }

    const json = (await response.json()) as { data: Array<{ embedding: number[] }> };

    // M6: Validate response length matches input
    if (json.data.length !== texts.length) {
      throw new EmbeddingError(
        `Embedding API returned ${json.data.length} embeddings for ${texts.length} texts`,
      );
    }

    return json.data.map((d) => d.embedding);
  }
}
