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
  [key: string]: string | number | boolean | null | undefined;
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

export type ChunkingStrategy = 'fixed' | 'recursive' | 'semantic';

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
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  topK: 5,
  scoreThreshold: 0,
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
}

export interface QueryResult {
  question: string;
  context: SearchResult[];
}

export interface QueryWithAnswer {
  answer: string;
  context: SearchResult[];
  question: string;
}

// -- LLM --------------------------------------------------------------

export interface LLMProvider {
  generate(prompt: string, options?: LLMOptions): Promise<string>;
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
