// ============================================================
// RAG — Main entry point combining all modules
// ============================================================

import type {
  RAGConfig,
  ChunkOptions,
  DocumentInfo,
  QueryResult,
  QueryWithAnswer,
  QueryOptions,
  Logger,
} from '../types/index.ts';
import { DEFAULT_CHUNK_OPTIONS } from '../types/index.ts';
import { resolveParser } from '../parsers/index.ts';
import { chunkText } from '../chunking/index.ts';
import { QueryEngine, type QueryEngineConfig } from '../query/index.ts';
import { createDocumentInfo } from './utils.ts';
import { NoopLogger } from '../logger/index.ts';
import { RAGError } from '../errors/index.ts';
import { type SparseSearchProvider } from '../search/index.ts';
import * as path from 'node:path';

export class RAG {
  private readonly config: RAGConfig;
  private readonly chunkOptions: ChunkOptions;
  private readonly logger: Logger;
  private readonly documents: Map<string, DocumentInfo> = new Map();
  /** Track document ID -> chunk IDs for proper cleanup on removal. */
  private readonly docChunks: Map<string, string[]> = new Map();
  /** Track file paths to detect duplicates. */
  private readonly filePaths: Set<string> = new Set();
  /** Sparse search provier for keyword/hybrid search. */
  private readonly sparseSearch?: SparseSearchProvider;
  private queryEngine: QueryEngine;

  constructor(config: RAGConfig) {
    this.config = config;
    this.chunkOptions = { ...DEFAULT_CHUNK_OPTIONS, ...config.chunking };
    this.logger = config.logger ?? new NoopLogger();
    this.sparseSearch = config.sparseSearch;
    this.queryEngine = this.createQueryEngine(config);
  }

  // -- Document management -------------------------------------------

  /**
   * Parse a file, chunk it, and store embeddings in the vector store.
   */
  async addDocument(
    file: string | { path: string; content?: Buffer },
  ): Promise<DocumentInfo> {
    const pathStr = typeof file === 'string' ? file : file.path;

    if (this.filePaths.has(pathStr)) {
      this.logger.debug('Skipping duplicate document: %s', pathStr);
      // Return the existing document
      for (const [, doc] of this.documents) {
        // Match by pathStr or by fileName (for cases where path differs)
        if (doc.fileName === pathStr) return doc;
        // Also match by checking if the basename is the same
        const base = path.basename(pathStr);
        if (doc.fileName === base) return doc;
      }
    }

    this.logger.debug('Adding document: %s', pathStr);

    // Parse
    const parser = resolveParser(pathStr);
    const parsed = await parser.parse(file);

    // Create document info
    const docInfo = createDocumentInfo(
      parsed.metadata.fileName as string ?? pathStr,
      parsed.content,
      parsed.metadata,
    );

    // Chunk
    const chunks = chunkText(parsed.content, docInfo.id, this.chunkOptions);
    this.logger.debug(
      'Split %s into %d chunks',
      pathStr,
      chunks.length,
    );

    // Embed & store — pass chunk IDs so they can be tracked
    const texts = chunks.map((c) => c.content);
    const embeddings = await this.config.embeddings.embed(texts);
    const metadatas = chunks.map((c) => ({
      ...c.metadata,
      content: c.content,
      documentId: c.documentId,
      chunkIndex: c.index,
    }));
    const chunkIds = chunks.map((c) => c.id);

    await this.config.vectorStore.add(embeddings, metadatas, chunkIds);

    // Also index for sparse search if available
    if (this.sparseSearch) {
      const sparseSearchDocs = chunks.map((c) => ({
        id: c.id,
        content: c.content,
        metadata: {
          ...c.metadata,
          documentId: c.documentId,
          chunkIndex: c.index,
        },
      }));
      this.sparseSearch.addDocuments(sparseSearchDocs);
    }

    // Track only after successful ingest
    this.documents.set(docInfo.id, docInfo);
    this.docChunks.set(docInfo.id, chunkIds);
    this.filePaths.add(pathStr);

    return docInfo;
  }

  /**
   * Add multiple files at once.
   */
  async addDocuments(
    files: (string | { path: string; content?: Buffer })[],
  ): Promise<DocumentInfo[]> {
    const results: DocumentInfo[] = [];
    for (const file of files) {
      results.push(await this.addDocument(file));
    }
    return results;
  }

  /**
   * Remove a document and its chunks from the vector store and sparse search index.
   */
  async removeDocument(id: string): Promise<void> {
    if (!this.documents.has(id)) {
      throw new RAGError(`Document not found: ${id}`);
    }
    const chunkIds = this.docChunks.get(id) ?? [];
    if (chunkIds.length > 0) {
      await this.config.vectorStore.delete(chunkIds);
      // Also remove from sparse search
      this.sparseSearch?.removeDocuments(chunkIds);
    }
    const doc = this.documents.get(id);
    if (doc?.fileName) this.filePaths.delete(doc.fileName);
    this.documents.delete(id);
    this.docChunks.delete(id);
    this.logger.debug('Removed document: %s (%d chunks)', id, chunkIds.length);
  }

  /**
   * List all ingested documents.
   */
  listDocuments(): DocumentInfo[] {
    return Array.from(this.documents.values());
  }

  // -- Query operations -----------------------------------------------

  /**
   * Retrieve relevant chunks for a question.
   */
  async query(question: string, options?: QueryOptions): Promise<QueryResult> {
    return this.queryEngine.query(question, options);
  }

  /**
   * Retrieve context and generate an answer.
   */
  async queryAndAnswer(
    question: string,
    options?: QueryOptions,
  ): Promise<QueryWithAnswer> {
    const llm = options?.llm;
    if (!llm) {
      throw new RAGError(
        'An LLM provider is required for queryAndAnswer. Pass it via options.llm.',
      );
    }
    return this.queryEngine.queryAndAnswer(question, llm, options);
  }

  // -- Configuration --------------------------------------------------

  updateConfig(partial: Partial<RAGConfig>): void {
    if (partial.embeddings !== undefined) {
      this.config.embeddings = partial.embeddings;
    }
    if (partial.vectorStore !== undefined) {
      this.config.vectorStore = partial.vectorStore;
    }
    if (partial.chunking) {
      Object.assign(this.chunkOptions, partial.chunking);
    }
    if (partial.logger !== undefined) {
      this.config.logger = partial.logger;
    }
    // Rebuild queryEngine if embeddings or vectorStore changed
    if (partial.embeddings !== undefined || partial.vectorStore !== undefined) {
      this.queryEngine = this.createQueryEngine();
    }
  }

  /**
   * Validate that configured EmbeddingProvider matches what's in the vector store.
   * Call this after loading a persisted store to catch configuration drift early.
   */
  async validateConfiguration(): Promise<{
    isValid: boolean;
    warning?: string;
    error?: string;
  }> {
    const storeMeta = this.config.vectorStore.metadata;
    const providerDim = this.config.embeddings.dimensions;

    if (!storeMeta) {
      return {
        isValid: true,
        warning: 'Vector store has no metadata (empty or legacy). Configuration cannot be validated.',
      };
    }

    if (storeMeta.embeddingDimension === 0) {
      return {
        isValid: true,
        warning: 'Vector store dimension not yet set (first add will initialize).',
      };
    }

    if (providerDim !== storeMeta.embeddingDimension) {
      return {
        isValid: false,
        error: `
Embedding configuration mismatch!

  Stored vectors:     ${storeMeta.embeddingDimension}D (${storeMeta.embeddingModel || 'unknown'})
  Current provider:   ${providerDim}D
  Difference:         ${Math.abs(providerDim - storeMeta.embeddingDimension)}D

This will cause search to fail! To fix:
  1. Reconfigure your EmbeddingProvider to match stored vectors, OR
  2. Delete all documents and re-index with current configuration` .trim(),
      };
    }

    // Optional warning if model name is known and differs
    if (
      storeMeta.embeddingModel &&
      storeMeta.embeddingModel !== 'auto-detected' &&
      storeMeta.embeddingModel !== 'unknown'
    ) {
      // Note: We can't reliably detect provider model name without extra metadata on provider
      // This would require EmbeddingProvider to expose a .model property
      this.logger.debug(
        'Store was created with model: %s (dimensional match confirmed)',
        storeMeta.embeddingModel,
      );
    }

    return { isValid: true };
  }

  /**
   * Convenience method: Load store with automatic validation.
   * Throws RAGError if configuration is incompatible.
   */
  async loadAndValidate(storePath: string): Promise<void> {
    await this.config.vectorStore.load(storePath);

    const result = await this.validateConfiguration();

    if (!result.isValid) {
      throw new RAGError(result.error!);
    }

    if (result.warning) {
      this.logger.warn(result.warning);
    } else {
      const meta = this.config.vectorStore.metadata;
      const sizeHint = this.config.vectorStore.size;
      this.logger.info(
        '✓ Configuration validated: %dD vectors (%s), %d records',
        meta?.embeddingDimension ?? 0,
        meta?.embeddingModel ?? 'unknown',
        sizeHint ?? 'unknown',
      );
    }
  }

  /**
   * Get summary information about the knowledge base.
   */
  getKnowledgeBaseInfo() {
    const meta = this.config.vectorStore.metadata;
    const docs = this.listDocuments();
    const sizeHint = this.config.vectorStore.size;

    return {
      recordCount: sizeHint ?? (this.chunkOptions.size ? docs.length * 10 : undefined),
      documentCount: docs.length,
      embeddingDimension: meta?.embeddingDimension ?? 0,
      embeddingModel: meta?.embeddingModel,
      chunkStrategy: this.chunkOptions.strategy,
      chunkSize: this.chunkOptions.size,
      createdAt: meta?.createdAt,
      updatedAt: meta?.updatedAt,
    };
  }

  /**
   * Initialize the vector store if it supports explicit initialization.
   * Useful for SQLiteVectorStore to load data before querying.
   * No-op for stores that don't require initialization (e.g., InMemoryVectorStore).
   */
  async initialize(): Promise<void> {
    const init = this.config.vectorStore.init;
    if (typeof init === 'function') {
      await init.call(this.config.vectorStore);
      this.logger.debug('Vector store initialized');
    }
  }

  /**
   * Close the vector store and release resources.
   * For SQLiteVectorStore, this closes database connections.
   * No-op for stores without cleanup requirements.
   */
  close(): void {
    const close = this.config.vectorStore.close;
    if (typeof close === 'function') {
      close.call(this.config.vectorStore);
      this.logger.debug('Vector store closed');
    }
  }

  // -- Private helpers ------------------------------------------------

  private createQueryEngine(config?: RAGConfig): QueryEngine {
    const opts: QueryEngineConfig = {
      embeddings: this.config.embeddings,
      vectorStore: this.config.vectorStore,
      logger: this.logger,
      sparseSearch: this.sparseSearch,
      reranker: config?.reranker,
      queryRewriter: config?.queryRewriter,
    };
    return new QueryEngine(opts);
  }
}
