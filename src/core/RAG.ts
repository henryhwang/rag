// ============================================================
// RAG — Main entry point combining all modules
// ============================================================

import {
  RAGConfig,
  ChunkOptions,
  DocumentInfo,
  QueryResult,
  QueryWithAnswer,
  QueryOptions,
  SearchResult,
  Logger,
  LLMProvider,
} from '../types/index.ts';
import { DEFAULT_CHUNK_OPTIONS, DEFAULT_SEARCH_OPTIONS } from '../types/index.ts';
import { parseFile, resolveParser } from '../parsers/index.ts';
import { chunkText } from '../chunking/index.ts';
import { QueryEngine } from '../query/index.ts';
import { createDocumentInfo } from './utils.ts';
import { NoopLogger, Logger as LoggerType } from '../logger/index.ts';
import { RAGError } from '../errors/index.ts';
import * as path from 'node:path';

export class RAG {
  private readonly chunkOptions: ChunkOptions;
  private readonly logger: Logger;
  private readonly documents: Map<string, DocumentInfo> = new Map();
  /** Track document ID -> chunk IDs for proper cleanup on removal. */
  private readonly docChunks: Map<string, string[]> = new Map();
  /** Track file paths to detect duplicates. */
  private readonly filePaths: Set<string> = new Set();
  private queryEngine: QueryEngine;

  constructor(private readonly config: RAGConfig) {
    this.chunkOptions = { ...DEFAULT_CHUNK_OPTIONS, ...config.chunking };
    this.logger = config.logger ?? new NoopLogger();
    this.queryEngine = new QueryEngine({
      embeddings: config.embeddings,
      vectorStore: config.vectorStore,
      logger: this.logger,
    });
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
      for (const [id, doc] of this.documents) {
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
   * Remove a document and its chunks from the vector store.
   */
  async removeDocument(id: string): Promise<void> {
    if (!this.documents.has(id)) {
      throw new RAGError(`Document not found: ${id}`);
    }
    const chunkIds = this.docChunks.get(id) ?? [];
    if (chunkIds.length > 0) {
      await this.config.vectorStore.delete(chunkIds);
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
      // Note: queryEngine already holds a reference to the old logger;
      // this affects future operations on the RAG class only.
    }
    // Rebuild queryEngine if embeddings or vectorStore changed
    if (partial.embeddings !== undefined || partial.vectorStore !== undefined) {
      this.queryEngine = new QueryEngine({
        embeddings: this.config.embeddings,
        vectorStore: this.config.vectorStore,
        logger: this.config.logger ?? new NoopLogger(),
      });
    }
  }
}
