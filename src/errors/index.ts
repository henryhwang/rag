// ============================================================
// Custom error hierarchy for clear, actionable feedback
// ============================================================

export interface ErrorMetadata {
  endpoint?: string;
  status?: number;
  attempt?: number;
  requestId?: string;
  numItems?: number;
  model?: string;
  [key: string]: unknown;
}

export class RAGError extends Error {
  declare cause?: Error;
  readonly metadata?: ErrorMetadata;

  constructor(
    message: string,
    options?: { cause?: Error; metadata?: ErrorMetadata }
  ) {
    super(message);
    this.name = 'RAGError';
    this.cause = options?.cause;
    this.metadata = options?.metadata;
  }
}

export class ParseError extends RAGError {
  constructor(
    message: string,
    options?: { cause?: Error; metadata?: ErrorMetadata }
  ) {
    super(message, options);
    this.name = 'ParseError';
  }
}

export class ChunkingError extends RAGError {
  constructor(
    message: string,
    options?: { cause?: Error; metadata?: ErrorMetadata }
  ) {
    super(message, options);
    this.name = 'ChunkingError';
  }
}

export class EmbeddingError extends RAGError {
  constructor(
    message: string,
    options?: { cause?: Error; metadata?: ErrorMetadata }
  ) {
    super(message, options);
    this.name = 'EmbeddingError';
  }
}

export class VectorStoreError extends RAGError {
  constructor(
    message: string,
    options?: { cause?: Error; metadata?: ErrorMetadata }
  ) {
    super(message, options);
    this.name = 'VectorStoreError';
  }
}

export class LLMError extends RAGError {
  constructor(
    message: string,
    options?: { cause?: Error; metadata?: ErrorMetadata }
  ) {
    super(message, options);
    this.name = 'LLMError';
  }
}

export class QueryError extends RAGError {
  constructor(
    message: string,
    options?: { cause?: Error; metadata?: ErrorMetadata }
  ) {
    super(message, options);
    this.name = 'QueryError';
  }
}

export class SearchError extends RAGError {
  constructor(
    message: string,
    options?: { cause?: Error; metadata?: ErrorMetadata }
  ) {
    super(message, options);
    this.name = 'SearchError';
  }
}

export class RerankError extends RAGError {
  constructor(
    message: string,
    options?: { cause?: Error; metadata?: ErrorMetadata }
  ) {
    super(message, options);
    this.name = 'RerankError';
  }
}
