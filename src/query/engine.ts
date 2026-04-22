// ============================================================
// Query engine — embeds a question, searches the vector store,
// and optionally assembles an answer via an LLM.
// Supports dense, sparse (BM25), and hybrid search modes,
// plus optional reranking and query rewriting.
// ============================================================

import type {
  EmbeddingProvider,
  VectorStore,
  SearchResult,
  SearchOptions,
  QueryOptions,
  QueryResult,
  QueryWithAnswer,
  LLMProvider,
  Logger,
  Reranker,
  QueryRewriter,
  Metadata,
  SparseSearchProvider,
  SparseDocument,
} from '../types/index.ts';
import { DEFAULT_SEARCH_OPTIONS } from '../types/index.ts';
import { QueryError, RerankError } from '../errors/index.ts';
import {
  fuseResults,
  DEFAULT_HYBRID_CONFIG as SEARCH_DEFAULT_HYBRID_CONFIG,
} from '../search/index.ts';

export interface QueryEngineConfig {
  embeddings: EmbeddingProvider;
  vectorStore: VectorStore;
  logger: Logger;
  sparseSearch?: SparseSearchProvider;
  reranker?: Reranker;
  queryRewriter?: QueryRewriter;
}

export class QueryEngine {
  private readonly embeddings: EmbeddingProvider;
  private readonly vectorStore: VectorStore;
  private readonly logger: Logger;
  private readonly sparseSearch?: SparseSearchProvider;
  private readonly reranker?: Reranker;
  private readonly queryRewriter?: QueryRewriter;

  constructor(opts: QueryEngineConfig) {
    this.embeddings = opts.embeddings;
    this.vectorStore = opts.vectorStore;
    this.logger = opts.logger;
    this.sparseSearch = opts.sparseSearch;
    this.reranker = opts.reranker;
    this.queryRewriter = opts.queryRewriter;
  }

  // -- Public API -----------------------------------------------------

  /**
   * Sync sparse search ith documents. Call this after adding documents
   * to the vector store if you want hybrid/sparse search to work.
   */
  syncSparseSearch(documents: SparseDocument[]): void {
    this.sparseSearch?.addDocuments(documents);
  }

  /**
   * Retrieve relevant chunks for a question.
   */
  async query(question: string, options?: QueryOptions): Promise<QueryResult> {
    const opts = { ...DEFAULT_SEARCH_OPTIONS, ...options };
    const searchMode = opts.searchMode ?? 'dense';

    // Apply query rewriting if configured
    const queries = await this.getQueries(question, opts);

    // Execute search based on mode
    let results: SearchResult[];

    if (searchMode === 'sparse') {
      results = await this.executeSparseSearch(queries, opts);
    } else if (searchMode === 'hybrid') {
      results = await this.hybridSearch(queries, opts);
    } else {
      results = await this.denseSearch(queries, opts);
    }

    // Apply reranking if configured
    if (opts.rerank && this.reranker && results.length > 1) {
      results = await this.rerankResults(question, results, opts);
    }

    this.logger.debug(
      'Retrieved %d results (mode=%s, after threshold)',
      results.length,
      searchMode,
    );
    return { question, context: results, searchMode };
  }

  /**
   * Retrieve + generate an answer using an LLM.
   */
  async queryAndAnswer(
    question: string,
    llm: LLMProvider,
    options?: QueryOptions,
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

    // M3: Use structured messages with separate system/user roles
    if (llm.generateMessages) {
      this.logger.debug('Generating answer with LLM (structured messages)');
      const answer = await llm.generateMessages([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Context:\n<context>\n${contextText}\n</context>\n\nQuestion: ${question}` },
      ]);
      return { answer, context: result.context, question };
    }

    // Fallback: concatenate into single prompt (older providers)
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

  // -- Private search implementations ---------------------------------

  private async denseSearch(
    queries: string[],
    opts: SearchOptions,
  ): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];

    for (const q of queries) {
      this.logger.debug('Embedding query (dense): %s', q);
      const embeddings = await this.embeddings.embed([q]);
      const embedding = embeddings[0];

      if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
        this.logger.warn('Embedding provider returned empty result for: %s', q);
        continue;
      }

      const results = await this.vectorStore.search(
        embedding,
        opts.topK ?? 5,
        opts.filter,
      );
      allResults.push(...results);
    }

    // Deduplicate by id, keeping highest score
    return this.deduplicateResults(allResults).filter(
      (r) => r.score >= (opts.scoreThreshold ?? 0),
    );
  }

  private async executeSparseSearch(
    queries: string[],
    opts: SearchOptions,
  ): Promise<SearchResult[]> {
    if (!this.sparseSearch) {
      throw new QueryError(
        'Sparse search provider is required for sparse search. Configure it via QueryEngineConfig.sparseSearch.',
      );
    }

    const allResults: SearchResult[] = [];

    for (const q of queries) {
      this.logger.debug('Sparse search (sparse): %s', q);
      const results = this.sparseSearch.search(q, opts.topK ?? 5);

      for (const r of results) {
        allResults.push({
          id: r.id,
          content: r.content,
          score: r.score,
          metadata: r.metadata,
          documentId: (r.metadata.documentId as string) ?? undefined,
        });
      }
    }

    return this.deduplicateResults(allResults).filter(
      (r) => r.score >= (opts.scoreThreshold ?? 0),
    );
  }

  private async hybridSearch(
    queries: string[],
    opts: SearchOptions,
  ): Promise<SearchResult[]> {
    if (!this.sparseSearch) {
      throw new QueryError(
        'Sparse search provider is required for hybrid search. Configure it via QueryEngineConfig.sparseSearch.',
      );
    }

    const denseWeight = opts.denseWeight ?? SEARCH_DEFAULT_HYBRID_CONFIG.denseWeight;
    const allDense: SearchResult[] = [];
    const allSparse: ReturnType<typeof this.sparseSearch.search> = [];

    for (const q of queries) {
      // Dense path
      this.logger.debug('Embedding query (hybrid dense): %s', q);
      const embeddings = await this.embeddings.embed([q]);
      const embedding = embeddings[0];

      if (embedding && Array.isArray(embedding) && embedding.length > 0) {
        const denseResults = await this.vectorStore.search(
          embedding,
          opts.topK ?? 5,
          opts.filter,
        );
        allDense.push(...denseResults);
      }

      // Sparse path
      this.logger.debug('Sparse search (hybrid sparse): %s', q);
      const sparseResults = this.sparseSearch.search(q, opts.topK ?? 5);
      allSparse.push(...sparseResults);
    }

    // Deduplicate within each path before fusion
    const dedupedDense = this.deduplicateResults(allDense);
    const dedupedSparse = this.deduplicateSparseResults(allSparse);

    // Fuse results
    const fused = fuseResults(
      dedupedDense,
      dedupedSparse,
      { denseWeight },
      opts.topK ?? 5,
    );

    return fused.filter((r) => r.score >= (opts.scoreThreshold ?? 0));
  }

  // -- Reranking ------------------------------------------------------

  private async rerankResults(
    query: string,
    results: SearchResult[],
    opts: QueryOptions,
  ): Promise<SearchResult[]> {
    if (!this.reranker) return results;

    try {
      this.logger.debug('Reranking %d results', results.length);
      const documents = results.map((r) => r.content);
      const scores = await this.reranker.rerank(query, documents);

      if (scores.length !== results.length) {
        throw new RerankError(
          `Reranker returned ${scores.length} scores, expected ${results.length}`,
        );
      }

      // Apply scores and re-sort
      const reranked = results.map((r, i) => ({
        ...r,
        score: scores[i],
      }));

      reranked.sort((a, b) => b.score - a.score);

      // Apply rerankTopK limit
      const rerankTopK = opts.topK ?? results.length;
      return reranked.slice(0, rerankTopK);
    } catch (err) {
      if (err instanceof RerankError) throw err;
      throw new RerankError(`Reranking failed: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  // -- Query rewriting ------------------------------------------------

  private async getQueries(
    originalQuery: string,
    opts: QueryOptions,
  ): Promise<string[]> {
    if (opts.rewriteQuery && this.queryRewriter) {
      const rewritten = await this.queryRewriter.rewrite(originalQuery);
      this.logger.debug('Rewritten to %d queries: %j', rewritten.length, rewritten);
      return rewritten;
    }

    return [originalQuery];
  }

  // -- Helpers --------------------------------------------------------

  private deduplicateResults(results: SearchResult[]): SearchResult[] {
    const seen = new Map<string, SearchResult>();
    for (const r of results) {
      const existing = seen.get(r.id);
      if (!existing || r.score > existing.score) {
        seen.set(r.id, r);
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.score - a.score);
  }

  private deduplicateSparseResults(
    results: { id: string; content: string; score: number; metadata: Metadata }[],
  ): { id: string; content: string; score: number; metadata: Metadata }[] {
    const seen = new Map<string, { id: string; content: string; score: number; metadata: Metadata }>();
    for (const r of results) {
      const existing = seen.get(r.id);
      if (!existing || r.score > existing.score) {
        seen.set(r.id, r);
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.score - a.score);
  }
}
