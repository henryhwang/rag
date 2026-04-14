// ============================================================
// rag-typescript — Public API
// ============================================================

// Core
export { RAG } from './core/RAG.ts';

// Types
export type {
  RAGConfig,
  ChunkOptions,
  ChunkingStrategy,
  SearchOptions,
  QueryOptions,
  LLMOptions,
  DocumentInfo,
  Chunk,
  Metadata,
  Filter,
  SearchResult,
  QueryResult,
  QueryWithAnswer,
  EmbeddingProvider,
  VectorStore,
  LLMProvider,
  DocumentParser,
  FileInput,
  ParsedDocument,
  Logger,
} from './types/index.ts';

export { DEFAULT_CHUNK_OPTIONS, DEFAULT_SEARCH_OPTIONS } from './types/index.ts';

// Errors
export {
  RAGError,
  ParseError,
  ChunkingError,
  EmbeddingError,
  VectorStoreError,
  LLMError,
  QueryError,
  SearchError,
  RerankError,
} from './errors/index.ts';

// Logger
export { NoopLogger } from './logger/index.ts';

// Parsers
export {
  resolveParser,
  parseFile,
  TextParser,
  MarkdownParser,
  DocxParser,
  PdfParser,
  BaseDocumentParser,
} from './parsers/index.ts';

// Chunking
export { chunkText } from './chunking/index.ts';

// Embeddings
export {
  OpenAICompatibleEmbeddings,
} from './embeddings/index.ts';
export type { OpenAICompatibleEmbeddingsConfig } from './embeddings/index.ts';

// Storage
export { InMemoryVectorStore } from './storage/index.ts';
export {
  SQLiteVectorStore,
  type SQLiteVectorStoreConfig,
} from './storage/index.ts';

// LLM
export { OpenAICompatibleLLM } from './llm/index.ts';
export type { OpenAICompatibleLLMConfig } from './llm/index.ts';

// Query
export { QueryEngine } from './query/index.ts';

// Utils
export { generateDocId, createDocumentInfo } from './core/utils.ts';

// Phase 3: Search
export {
  BM25Index,
  fuseResults,
  reciprocalRankFusion,
  syncBM25WithStore,
  type BM25Document,
  type BM25SearchResult,
  type BM25Config,
  type HybridSearchConfig,
  DEFAULT_BM25_CONFIG,
  DEFAULT_HYBRID_CONFIG,
} from './search/index.ts';

// Phase 3: Reranker
export {
  OpenAICompatibleReranker,
  type OpenAICompatibleRerankerConfig,
} from './reranking/index.ts';

// Phase 3: Query Rewrite
export {
  LLMQueryRewriter,
  SimpleQueryRewriter,
  type LLMQueryRewriterConfig,
} from './query/rewrite/index.ts';

// Phase 3: RAG Phase 3 config
export { type RAGPhase3Config } from './core/RAG.ts';
