// ============================================================
// OpenAI-compatible reranker — uses an LLM to score relevance.
// Sends a prompt per document asking for a 0–100 relevance score.
// ============================================================

import { Reranker } from '../types/index.ts';
import { RerankError } from '../errors/index.ts';

export interface OpenAICompatibleRerankerConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Batch size for processing. Default: 10. */
  batchSize?: number;
}

const DEFAULT_CONFIG: Required<OpenAICompatibleRerankerConfig> = {
  apiKey: '',
  baseUrl: '',
  model: 'gpt-4o-mini',
  batchSize: 10,
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

  constructor(config?: OpenAICompatibleRerankerConfig) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.apiKey = merged.apiKey;
    this.baseUrl = merged.baseUrl;
    this.model = merged.model;
    this.batchSize = merged.batchSize;
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
        batch.map(async (doc) => {
          const prompt = RERANK_PROMPT.replace('{query}', query).replace(
            '{document}',
            doc.slice(0, 2000), // Truncate very long documents
          );

          try {
            const score = await this.callLLM(prompt);
            return score;
          } catch (err) {
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
    const url = this.baseUrl
      ? `${this.baseUrl.replace(/\/$/, '')}/chat/completions`
      : 'https://api.openai.com/v1/chat/completions';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
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

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new RerankError(
        `LLM API error ${response.status}: ${text}`,
      );
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content?.trim() ?? '';
    const score = parseInt(content, 10);

    if (isNaN(score) || score < 0 || score > 100) {
      throw new RerankError(
        `LLM returned invalid score: "${content}" (expected 0-100)`,
      );
    }

    // Normalize to 0-1 range
    return score / 100;
  }
}
