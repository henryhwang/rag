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

export class RAG {
  private readonly chunkOptions: ChunkOptions;
  private readonly logger: Logger;
  private readonly documents: Map<string, DocumentInfo> = new Map();
  private readonly queryEngine: QueryEngine;

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

    this.documents.set(docInfo.id, docInfo);

    // Chunk
    const chunks = chunkText(parsed.content, docInfo.id, this.chunkOptions);
    this.logger.debug(
      'Split %s into %d chunks',
      pathStr,
      chunks.length,
    );

    // Embed & store
    const texts = chunks.map((c) => c.content);
    const embeddings = await this.config.embeddings.embed(texts);
    const metadatas = chunks.map((c) => ({
      ...c.metadata,
      content: c.content,
      documentId: c.documentId,
      chunkIndex: c.index,
    }));

    await this.config.vectorStore.add(embeddings, metadatas);

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
   * Note: InMemoryVectorStore doesn't support bulk delete by documentId
   * natively, so this is a no-op for the store in Phase 1.
   */
  async removeDocument(id: string): Promise<void> {
    if (!this.documents.has(id)) {
      throw new RAGError(`Document not found: ${id}`);
    }
    this.documents.delete(id);
    this.logger.debug('Removed document: %s', id);
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
    Object.assign(this.config, partial);
    if (partial.chunking) {
      Object.assign(this.chunkOptions, partial.chunking);
    }
    if (partial.logger) {
      // Note: queryEngine already holds a reference;
      // logger update affects future operations only.
    }
  }
}
