import { describe, it, expect, mock } from 'bun:test';
import { DedicatedReranker } from '../src/reranking/dedicatedReranker.js';
import { RerankError } from '../src/errors/index.js';
import { createMockFetch } from './helpers/mock-fetch.ts';

describe('DedicatedReranker', () => {
  describe('construction', () => {
    it('creates with default config', () => {
      const reranker = new DedicatedReranker({ apiKey: 'test-key' });
      expect(reranker.name).toBe('DedicatedReranker');
    });

    it('accepts custom config', () => {
      const reranker = new DedicatedReranker({
        apiKey: 'test-key',
        baseUrl: 'http://localhost:11434',
        model: 'jina-reranker-v3',
        batchSize: 50,
        timeout: 60000,
        maxRetries: 5,
        normalizeScores: false,
      });
      expect(reranker.name).toBe('DedicatedReranker');
    });

    it('uses Jina API base URL by default', () => {
      const reranker = new DedicatedReranker({ apiKey: 'test-key' });
      expect(reranker.name).toBe('DedicatedReranker');
    });
  });

  describe('rerank', () => {
    it('throws RerankError when apiKey is missing', async () => {
      const reranker = new DedicatedReranker({ apiKey: '' });
      expect(reranker.rerank('query', ['doc1', 'doc2'])).rejects.toThrow(RerankError);
      expect(reranker.rerank('query', ['doc1', 'doc2'])).rejects.toThrow('API key is required');
    });

    it('throws RerankError when apiKey is undefined', async () => {
      const reranker = new DedicatedReranker({});
      expect(reranker.rerank('query', ['doc1', 'doc2'])).rejects.toThrow(RerankError);
    });

    it('returns empty array for empty documents', async () => {
      const reranker = new DedicatedReranker({ apiKey: 'test-key' });
      const scores = await reranker.rerank('query', []);
      expect(scores).toEqual([]);
    });

    it('throws RerankError for empty query', async () => {
      const reranker = new DedicatedReranker({ apiKey: 'test-key' });
      expect(reranker.rerank('', ['doc'])).rejects.toThrow(RerankError);
      expect(reranker.rerank('   ', ['doc'])).rejects.toThrow('Query cannot be empty');
    });

    it('parses valid scores from Jina-style response', async () => {
      const mockFetch = mock(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.query).toBe('test query');
        expect(body.documents).toEqual(['doc1', 'doc2']);

        return new Response(
          JSON.stringify({
            results: [
              { index: 0, document: 'doc1', relevance_score: 0.85 },
              { index: 1, document: 'doc2', relevance_score: 0.42 },
            ],
          }),
          { status: 200 },
        );
      });

      const reranker = new DedicatedReranker({ apiKey: 'test-key', fetchFn: mockFetch });
      const scores = await reranker.rerank('test query', ['doc1', 'doc2']);

      expect(scores).toHaveLength(2);
      expect(scores[0]).toBe(0.85);
      expect(scores[1]).toBe(0.42);
    });

    it('normalizes scores to 0-1 range', async () => {
      const mockFetch = createMockFetch(200, {
        results: [
          { index: 0, document: 'doc1', relevance_score: 1.5 },
          { index: 1, document: 'doc2', relevance_score: -0.2 },
          { index: 2, document: 'doc3', relevance_score: 0.75 },
        ],
      });

      const reranker = new DedicatedReranker({ apiKey: 'test-key', normalizeScores: true, fetchFn: mockFetch });
      const scores = await reranker.rerank('query', ['doc1', 'doc2', 'doc3']);

      expect(scores[0]).toBe(1);
      expect(scores[1]).toBe(0);
      expect(scores[2]).toBe(0.75);
    });

    it('returns unnormalized scores when normalizeScores is false', async () => {
      const mockFetch = createMockFetch(200, {
        results: [
          { index: 0, document: 'doc1', relevance_score: 1.5 },
          { index: 1, document: 'doc2', relevance_score: -0.2 },
        ],
      });

      const reranker = new DedicatedReranker({ apiKey: 'test-key', normalizeScores: false, fetchFn: mockFetch });
      const scores = await reranker.rerank('query', ['doc1', 'doc2']);

      expect(scores[0]).toBe(1.5);
      expect(scores[1]).toBe(-0.2);
    });

    it('handles batched requests correctly', async () => {
      let callCount = 0;
      const mockFetch = mock(async (_url: string, init?: RequestInit) => {
        callCount++;
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.documents.length).toBeLessThanOrEqual(2);

        return new Response(
          JSON.stringify({
            results: body.documents.map((_: string, i: number) => ({
              index: i,
              document: `doc${i}`,
              relevance_score: 0.9 - i * 0.1,
            })),
          }),
          { status: 200 },
        );
      });

      const reranker = new DedicatedReranker({ apiKey: 'test-key', batchSize: 2, fetchFn: mockFetch });
      const scores = await reranker.rerank('query', ['doc1', 'doc2', 'doc3', 'doc4', 'doc5']);

      expect(scores).toHaveLength(5);
      expect(callCount).toBe(3);
    });

    it('sends correct request body to API', async () => {
      let capturedBody: unknown;
      const mockFetch = mock(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse((init as RequestInit).body as string);
        const headers = (init as RequestInit).headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer secret-key');
        expect(headers['Content-Type']).toBe('application/json');

        return new Response(
          JSON.stringify({
            results: [{ index: 0, document: 'doc', relevance_score: 0.5 }],
          }),
          { status: 200 },
        );
      });

      const reranker = new DedicatedReranker({
        apiKey: 'secret-key',
        model: 'custom-model',
        fetchFn: mockFetch,
      });
      await reranker.rerank('test query', ['doc']);

      expect((capturedBody as Record<string, unknown>).model).toBe('custom-model');
      expect((capturedBody as Record<string, unknown>).query).toBe('test query');
      expect((capturedBody as Record<string, unknown>).documents).toEqual(['doc']);
    });

    it('constructs correct URL from baseUrl', async () => {
      let capturedUrl: string | undefined;
      const mockFetch = mock(async (url: string) => {
        capturedUrl = url;
        return new Response(
          JSON.stringify({
            results: [{ index: 0, document: 'doc', relevance_score: 0.5 }],
          }),
          { status: 200 },
        );
      });

      const reranker = new DedicatedReranker({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com',
        fetchFn: mockFetch,
      });
      await reranker.rerank('query', ['doc']);

      expect(capturedUrl).toBe('https://api.example.com/v1/rerank');
    });

    it('removes trailing slash from baseUrl', async () => {
      let capturedUrl: string | undefined;
      const mockFetch = mock(async (url: string) => {
        capturedUrl = url;
        return new Response(
          JSON.stringify({
            results: [{ index: 0, document: 'doc', relevance_score: 0.5 }],
          }),
          { status: 200 },
        );
      });

      const reranker = new DedicatedReranker({
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com/',
        fetchFn: mockFetch,
      });
      await reranker.rerank('query', ['doc']);

      expect(capturedUrl).toBe('https://api.example.com/v1/rerank');
    });

    it('throws RerankError on HTTP error response', async () => {
      const mockFetch = createMockFetch(401, 'Unauthorized: Invalid API key');

      const reranker = new DedicatedReranker({ apiKey: 'invalid-key', fetchFn: mockFetch });
      expect(reranker.rerank('query', ['doc'])).rejects.toThrow(RerankError);
    });

    it('throws RerankError on unexpected response format', async () => {
      const mockFetch = createMockFetch(200, { wrong: 'format' });

      const reranker = new DedicatedReranker({ apiKey: 'test-key', fetchFn: mockFetch });
      expect(reranker.rerank('query', ['doc'])).rejects.toThrow(RerankError);
    });

    it('throws RerankError when a batch fails', async () => {
      let callCount = 0;
      const mockFetch = mock(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({
              results: [{ index: 0, document: 'doc1', relevance_score: 0.9 }],
            }),
            { status: 200 },
          );
        } else {
          throw new Error('Network error');
        }
      });

      const reranker = new DedicatedReranker({ apiKey: 'test-key', batchSize: 1, maxRetries: 0, fetchFn: mockFetch });
      expect(reranker.rerank('query', ['doc1', 'doc2'])).rejects.toThrow(RerankError);
    });

    it('uses RERANKER_API_KEY env var as fallback', async () => {
      process.env.RERANKER_API_KEY = 'env-key';
      const reranker = new DedicatedReranker({});
      expect(reranker.name).toBe('DedicatedReranker');
      delete process.env.RERANKER_API_KEY;
    });

    describe('maxContentLengthPerBatch', () => {
      it('splits batches by content length when limit is set', async () => {
        let actualBatches: number[] = [];
        const mockFetch = mock(async (_url: string, init?: RequestInit) => {
          const body = JSON.parse((init as RequestInit).body as string);
          const totalChars = (body.documents as string[]).reduce((sum: number, d: string) => sum + d.length, 0);
          actualBatches.push(totalChars);

          return new Response(
            JSON.stringify({
              results: (body.documents as string[]).map((d: string, i: number) => ({
                index: i,
                document: d,
                relevance_score: 0.8,
              })),
            }),
            { status: 200 },
          );
        });

        const docs = [
          'a'.repeat(100),
          'b'.repeat(100),
          'c'.repeat(100),
          'd'.repeat(100),
        ];
        const reranker = new DedicatedReranker({
          apiKey: 'test-key',
          batchSize: 10,
          maxContentLengthPerBatch: 250,
          fetchFn: mockFetch,
        });
        const scores = await reranker.rerank('query', docs);

        expect(scores).toHaveLength(4);
        expect(actualBatches).toEqual([200, 200]);
      });

      it('respects both batchSize and maxContentLengthPerBatch', async () => {
        let actualBatches: { count: number; size: number }[] = [];
        const mockFetch = mock(async (_url: string, init?: RequestInit) => {
          const body = JSON.parse((init as RequestInit).body as string);
          const docs = body.documents as string[];
          const size = docs.reduce((sum: number, d: string) => sum + d.length, 0);
          actualBatches.push({ count: docs.length, size });

          return new Response(
            JSON.stringify({
              results: docs.map((d: string, i: number) => ({
                index: i,
                document: d,
                relevance_score: 0.5,
              })),
            }),
            { status: 200 },
          );
        });

        const docs = Array(7).fill(null).map(() => 'x'.repeat(100));
        const reranker = new DedicatedReranker({
          apiKey: 'test-key',
          batchSize: 3,
          maxContentLengthPerBatch: 250,
          fetchFn: mockFetch,
        });
        const scores = await reranker.rerank('query', docs);

        expect(scores).toHaveLength(7);
        expect(actualBatches).toEqual([
          { count: 2, size: 200 },
          { count: 2, size: 200 },
          { count: 2, size: 200 },
          { count: 1, size: 100 },
        ]);
      });

      it('uses default Infinity when maxContentLengthPerBatch not set', async () => {
        let callCount = 0;
        const mockFetch = mock(async (_url: string, init?: RequestInit) => {
          callCount++;
          const body = JSON.parse((init as RequestInit).body as string);
          return new Response(
            JSON.stringify({
              results: (body.documents as string[]).map((d: string, i: number) => ({
                index: i,
                document: d,
                relevance_score: 0.6,
              })),
            }),
            { status: 200 },
          );
        });

        const docs = Array(5).fill(null).map(() => 'x'.repeat(10000));
        const reranker = new DedicatedReranker({
          apiKey: 'test-key',
          batchSize: 2,
          fetchFn: mockFetch,
        });
        const scores = await reranker.rerank('query', docs);

        expect(scores).toHaveLength(5);
        expect(callCount).toBe(3);
      });
    });
  });

  describe('retry behavior', () => {
    it('retry behavior is handled by retryAsync utility', async () => {
      const reranker = new DedicatedReranker({
        apiKey: 'test-key',
        maxRetries: 5,
      });
      expect(reranker.name).toBe('DedicatedReranker');
    });
  });

  describe('batching helper exports', () => {
    it('exports getBatchIndices and estimateTokens for testing', () => {
      const moduleExports = require('../src/reranking/dedicatedReranker.js');

      expect(typeof moduleExports.getBatchIndices).toBe('function');
      expect(typeof moduleExports.estimateTokens).toBe('function');

      const batches = Array.from(moduleExports.getBatchIndices(4, [100, 200, 150, 300], 2));
      expect(batches).toEqual([[0, 2], [2, 4]]);
    });
  });
});
