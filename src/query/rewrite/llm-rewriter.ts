import type { LLMProvider, QueryRewriter } from '../../types/index.ts';

export interface LLMQueryRewriterConfig {
  llm: LLMProvider;
  /** Number of total queries including original. Default: 3. */
  numQueries?: number;
  model?: string;
}

const DEFAULT_NUM_QUERIES = 3;

export class LLMQueryRewriter implements QueryRewriter {
  readonly name = 'LLMQueryRewriter';
  private readonly llm: LLMProvider;
  private readonly numQueries: number;
  private readonly model?: string;

  constructor(config: LLMQueryRewriterConfig) {
    this.llm = config.llm;
    this.numQueries = config.numQueries ?? DEFAULT_NUM_QUERIES;
    this.model = config.model;

    if (this.numQueries < 1) {
      throw new Error('numQueries must be at least 1');
    }
  }

  async rewrite(query: string): Promise<string[]> {
    if (!query.trim()) {
      throw new Error('Query cannot be empty');
    }

    const additionalCount = Math.max(0, this.numQueries - 1);
    const prompt = `Given this search query, generate ${additionalCount} alternative formulations that might help retrieve relevant documents. Return each formulation on a separate line, starting with the original query.

Query: ${query}`;

    const options = this.model ? { model: this.model } : undefined;
    const response = await this.llm.generate(prompt, options);

    const lines = response
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // Strip leading numbering or bullet markers (e.g., "1. ", "- ")
      .map((line) => line.replace(/^\s*(?:\d+[\.\)]\s*|[-*]\s*)/, ''));

    // Ensure we include the original query, deduplicate, and cap at numQueries
    const uniqueLines = Array.from(new Set(lines));
    const results = [query, ...uniqueLines.filter((q) => q !== query)];
    return results.slice(0, this.numQueries);
  }
}
