// ============================================================
// Core types for the RAG library
// ============================================================

// -- Document & Chunk ------------------------------------------------

export interface DocumentInfo {
  id: string;
  fileName: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface Chunk {
  id: string;
  content: string;
  documentId: string;
  metadata: Metadata;
  index: number;
}

// -- Metadata & Filtering --------------------------------------------

export interface Metadata {
  [key: string]: string | number | boolean | null;
}

export type Filter = Record<string, string | number | boolean>;

// -- Embedding --------------------------------------------------------

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

// -- Vector Store -----------------------------------------------------

export interface VectorStore {
  add(
    embeddings: number[][],
    metadatas: Metadata[],
    ids?: string[],
  ): Promise<void>;
  search(
    query: number[],
    limit: number,
    filter?: Filter,
  ): Promise<SearchResult[]>;
  delete(ids: string[]): Promise<void>;
  save(path: string): Promise<void>;
  load(path: string): Promise<void>;
}

// -- Parser -----------------------------------------------------------

export interface DocumentParser<T = string> {
  supportedExtensions: string[];
  parse(file: FileInput): Promise<ParsedDocument>;
}

export type FileInput = string | Buffer | { path: string; content?: Buffer };

export interface ParsedDocument {
  content: string;
  metadata: Record<string, unknown>;
}

// -- Chunking ---------------------------------------------------------

export type ChunkingStrategy = 'fixed' | 'recursive' | 'markdown';

export interface ChunkOptions {
  strategy: ChunkingStrategy;
  size: number;
  overlap: number;
  maxTokens?: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  strategy: 'fixed',
  size: 500,
  overlap: 50,
};

// -- Search & Query ---------------------------------------------------

export interface SearchOptions {
  topK?: number;
  scoreThreshold?: number;
  filter?: Filter;
  /** Search mode: 'dense' (vector only), 'sparse' (BM25 only), 'hybrid' (combined). */
  searchMode?: 'dense' | 'sparse' | 'hybrid';
  /** Weight for dense search in hybrid mode (0–1). Default: 0.5. */
  denseWeight?: number;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  topK: 5,
  scoreThreshold: 0,
  searchMode: 'dense',
  denseWeight: 0.5,
};

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  metadata: Metadata;
  documentId?: string;
}

export interface QueryOptions extends SearchOptions {
  llm?: LLMProvider;
  systemPrompt?: string;
  /** Whether to apply reranking after search. Default: false. */
  rerank?: boolean;
  /** Top-k after reranking. Defaults to same as topK. */
  rerankTopK?: number;
  /** Whether to apply query rewriting. Default: false. */
  rewriteQuery?: boolean;
}

export interface QueryResult {
  question: string;
  context: SearchResult[];
  /** Search mode that was actually used. */
  searchMode?: 'dense' | 'sparse' | 'hybrid';
}

export interface QueryWithAnswer {
  answer: string;
  context: SearchResult[];
  question: string;
}

// -- Reranker ---------------------------------------------------------

/**
 * Reranker interface for re-ranking search results by relevance.
 * Implementations can use cross-encoders, LLM-based scoring, etc.
 */
export interface Reranker {
  /**
   * Rerank a list of (query, document) pairs.
   * Returns an array of scores in the same order as inputs.
   */
  rerank(query: string, documents: string[]): Promise<number[]>;
  /** Human-readable name for debugging/logging. */
  name?: string;
}

export interface RerankResult {
  scores: number[];
}

// -- Query Rewriting --------------------------------------------------

/**
 * Query rewriter interface for expanding or rewriting queries
 * before embedding/search.
 */
export interface QueryRewriter {
  /**
   * Rewrite a query into one or more queries for better recall.
   * Returns an array of query strings. The first should be the
   * original or a close variant.
   */
  rewrite(query: string): Promise<string[]>;
  /** Human-readable name for debugging/logging. */
  name?: string;
}

// -- Hybrid Search Config ---------------------------------------------

export interface HybridSearchConfig {
  /** Weight for dense (vector) results, 0–1. Sparse weight = 1 - this. */
  denseWeight: number;
  /** k parameter for BM25 (tuning constant). Default: 1.5. */
  bm25K1: number;
  /** b parameter for BM25 (length normalization). Default: 0.75. */
  bm25B: number;
}

export const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  denseWeight: 0.5,
  bm25K1: 1.5,
  bm25B: 0.75,
};

// -- LLM --------------------------------------------------------------

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMProvider {
  generate(prompt: string, options?: LLMOptions): Promise<string>;
  /** Generate from a list of structured messages. */
  generateMessages?(messages: LLMMessage[], options?: LLMOptions): Promise<string>;
  stream(
    prompt: string,
    options?: LLMOptions,
  ): AsyncIterable<string>;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  [key: string]: unknown;
}

// -- RAG Config -------------------------------------------------------

export interface RAGConfig {
  embeddings: EmbeddingProvider;
  vectorStore: VectorStore;
  chunking?: Partial<ChunkOptions>;
  logger?: Logger;
}

// -- Logger -----------------------------------------------------------

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}
