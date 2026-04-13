// ============================================================
// Custom error hierarchy for clear, actionable feedback
// ============================================================

export class RAGError extends Error {
  declare cause?: Error;

  constructor(message: string, options?: { cause?: Error }) {
    super(message);
    this.name = 'RAGError';
    this.cause = options?.cause;
  }
}

export class ParseError extends RAGError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'ParseError';
  }
}

export class ChunkingError extends RAGError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'ChunkingError';
  }
}

export class EmbeddingError extends RAGError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'EmbeddingError';
  }
}

export class VectorStoreError extends RAGError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'VectorStoreError';
  }
}

export class LLMError extends RAGError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'LLMError';
  }
}

export class QueryError extends RAGError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'QueryError';
  }
}
