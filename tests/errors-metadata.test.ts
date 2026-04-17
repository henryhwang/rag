// ============================================================
// Error Metadata Tests
// 
// Tests structured error metadata in all error types
// ============================================================

import { describe, it, expect } from 'bun:test';
import {
  RAGError,
  ParseError,
  EmbeddingError,
  VectorStoreError,
  LLMError,
  QueryError,
  SearchError,
  RerankError,
} from '../src/errors/index.ts';

describe('Error Metadata', () => {
  describe('RAGError with metadata', () => {
    it('should accept metadata in constructor', () => {
      const error = new RAGError('test error', {
        cause: new Error('original'),
        metadata: {
          endpoint: 'https://api.example.com/v1',
          status: 429,
          model: 'text-embedding-3-small',
          numItems: 10,
        },
      });

      expect(error.message).toBe('test error');
      expect(error.cause?.message).toBe('original');
      expect(error.metadata?.endpoint).toBe('https://api.example.com/v1');
      expect(error.metadata?.status).toBe(429);
      expect(error.metadata?.model).toBe('text-embedding-3-small');
      expect(error.metadata?.numItems).toBe(10);
    });

    it('should work without metadata', () => {
      const error = new RAGError('simple error');
      
      expect(error.message).toBe('simple error');
      expect(error.metadata).toBeUndefined();
    });

    it('should preserve custom properties in metadata', () => {
      const error = new RAGError('error', {
        metadata: {
          customField: 'custom value',
          anotherNumber: 42,
        },
      });

      expect(error.metadata?.customField).toBe('custom value');
      expect(error.metadata?.anotherNumber).toBe(42);
    });
  });

  describe('ParseError with metadata', () => {
    it('should include file path in metadata', () => {
      const error = new ParseError('Failed to parse document', {
        metadata: {
          fileName: 'document.pdf',
          fileSize: 1024 * 1024, // 1MB
        },
      });

      expect(error.name).toBe('ParseError');
      expect(error.metadata?.fileName).toBe('document.pdf');
    });
  });

  describe('EmbeddingError with metadata', () => {
    it('should include API details in metadata', () => {
      const error = new EmbeddingError('Rate limit exceeded', {
        metadata: {
          endpoint: 'https://api.openai.com/v1/embeddings',
          status: 429,
          numItems: 50,
          model: 'text-embedding-ada-002',
          attempt: 3,
        },
      });

      expect(error.name).toBe('EmbeddingError');
      expect(error.metadata?.endpoint).toContain('embeddings');
      expect(error.metadata?.status).toBe(429);
    });

    it('should chain with cause error', () => {
      const networkError = new TypeError('Network failure');
      const error = new EmbeddingError('Request failed', {
        cause: networkError,
        metadata: { timeout: 30000 },
      });

      expect(error.cause).toBe(networkError);
      expect(error.metadata?.timeout).toBe(30000);
    });
  });

  describe('VectorStoreError with metadata', () => {
    it('should include dimension mismatch details', () => {
      const error = new VectorStoreError('Dimension mismatch', {
        metadata: {
          expected: 1536,
          received: 768,
          operation: 'add',
        },
      });

      expect(error.name).toBe('VectorStoreError');
      expect(error.metadata?.expected).toBe(1536);
      expect(error.metadata?.received).toBe(768);
    });
  });

  describe('LLMError with metadata', () => {
    it('should include prompt context in metadata', () => {
      const error = new LLMError('Generation timeout', {
        metadata: {
          model: 'gpt-4-turbo',
          promptLength: 2500,
          maxTokens: 1000,
        },
      });

      expect(error.metadata?.model).toBe('gpt-4-turbo');
    });
  });

  describe('QueryError with metadata', () => {
    it('should include search parameters in metadata', () => {
      const error = new QueryError('No results found', {
        metadata: {
          query: 'search terms',
          topK: 5,
          scoreThreshold: 0.7,
        },
      });

      expect(error.metadata?.query).toBe('search terms');
      expect(error.metadata?.topK).toBe(5);
    });
  });

  describe('SearchError with metadata', () => {
    it('should include search mode in metadata', () => {
      const error = new SearchError('BM25 not configured', {
        metadata: {
          requestedMode: 'hybrid',
          fallbackTo: 'dense',
        },
      });

      expect(error.metadata?.requestedMode).toBe('hybrid');
    });
  });

  describe('RerankError with metadata', () => {
    it('should include reranking context in metadata', () => {
      const error = new RerankError('Reranking failed', {
        metadata: {
          numDocuments: 20,
          query: 'test query',
          model: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
        },
      });

      expect(error.metadata?.numDocuments).toBe(20);
    });
  });

  describe('Backward compatibility', () => {
    it('should work with only cause (old signature)', () => {
      const oldStyleError = new RAGError('error', {
        cause: new Error('cause'),
      });

      expect(oldStyleError.cause).toBeDefined();
      expect(oldStyleError.metadata).toBeUndefined();
    });

    it('should work with neither cause nor metadata', () => {
      const simpleError = new RAGError('bare message');
      
      expect(simpleError.message).toBe('bare message');
      expect(simpleError.cause).toBeUndefined();
      expect(simpleError.metadata).toBeUndefined();
    });
  });

  describe('Error serialization', () => {
    it('metadata should be serializable to JSON', () => {
      const error = new EmbeddingError('API error', {
        metadata: {
          endpoint: 'https://api.example.com',
          status: 500,
          retryCount: 3,
        },
      });

      // Should not throw
      const json = JSON.stringify({
        message: error.message,
        name: error.name,
        metadata: error.metadata,
      });

      expect(json).toContain('endpoint');
      expect(json).toContain('500');
    });
  });
});
