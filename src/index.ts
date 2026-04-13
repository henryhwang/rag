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
} from './errors/index.ts';

// Logger
export { NoopLogger } from './logger/index.ts';

// Parsers
export {
  resolveParser,
  parseFile,
  TextParser,
  MarkdownParser,
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

// LLM
export { OpenAICompatibleLLM } from './llm/index.ts';
export type { OpenAICompatibleLLMConfig } from './llm/index.ts';

// Query
export { QueryEngine } from './query/index.ts';

// Utils
export { generateDocId, createDocumentInfo } from './core/utils.ts';
