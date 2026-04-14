// ============================================================
// Query engine — embeds a question, searches the vector store,
// and optionally assembles an answer via an LLM.
// ============================================================

import {
  EmbeddingProvider,
  VectorStore,
  SearchResult,
  SearchOptions,
  QueryResult,
  QueryWithAnswer,
  LLMProvider,
  Logger,
} from '../types/index.ts';
import { DEFAULT_SEARCH_OPTIONS } from '../types/index.ts';
import { QueryError } from '../errors/index.ts';

export class QueryEngine {
  private readonly embeddings: EmbeddingProvider;
  private readonly vectorStore: VectorStore;
  private readonly logger: Logger;

  constructor(opts: {
    embeddings: EmbeddingProvider;
    vectorStore: VectorStore;
    logger: Logger;
  }) {
    this.embeddings = opts.embeddings;
    this.vectorStore = opts.vectorStore;
    this.logger = opts.logger;
  }

  /**
   * Retrieve relevant chunks for a question.
   */
  async query(question: string, options?: SearchOptions): Promise<QueryResult> {
    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };

    this.logger.debug('Embedding query: %s', question);
    const embeddings = await this.embeddings.embed([question]);
    const embedding = embeddings[0];

    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      this.logger.warn('Embedding provider returned empty result for: %s', question);
      return { question, context: [] };
    }

    this.logger.debug(
      'Searching vector store (topK=%d, threshold=%d)',
      opts.topK,
      opts.scoreThreshold,
    );
    const results = await this.vectorStore.search(embedding, opts.topK ?? 5, opts.filter);

    // Apply score threshold
    const filtered = results.filter((r) => r.score >= (opts.scoreThreshold ?? 0));

    this.logger.debug('Retrieved %d results (after threshold)', filtered.length);
    return { question, context: filtered };
  }

  /**
   * Retrieve + generate an answer using an LLM.
   */
  async queryAndAnswer(
    question: string,
    llm: LLMProvider,
    options?: SearchOptions & { systemPrompt?: string },
  ): Promise<QueryWithAnswer> {
    const result = await this.query(question, options);

    if (result.context.length === 0) {
      return {
        answer: 'No relevant context was found to answer this question.',
        context: [],
        question,
      };
    }

    const contextText = result.context
      .map((c, i) => `--- Context ${i + 1} ---\n${c.content}`)
      .join('\n\n');

    const systemPrompt =
      options?.systemPrompt ??
      'You are a helpful assistant. Answer the question based ONLY on the provided context. If the context does not contain enough information, say so clearly.';

    const userPrompt = `Context:\n${contextText}\n\nQuestion: ${question}`;
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    this.logger.debug('Generating answer with LLM');
    const answer = await llm.generate(fullPrompt);

    return {
      answer,
      context: result.context,
      question,
    };
  }
}
