import { describe, it, expect } from 'bun:test';
import { QueryEngine, QueryEngineConfig } from '../src/query/engine.js';
import { BM25Index } from '../src/search/bm25.js';
import { NoopLogger } from '../src/logger/index.js';
import type { EmbeddingProvider, VectorStore, Metadata, SearchResult } from '../src/types/index.js';

// -- Mock implementations -------------------------------------------

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 4;
  readonly encodingFormat = 'float';

  async embed(texts: string[]): Promise<number[][]> {
    // Simple hash-based mock embedding
    return texts.map((text) => {
      const hash = (s: string) => {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
          h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
        }
        return [
          (h & 0xff) / 255,
          ((h >> 8) & 0xff) / 255,
          ((h >> 16) & 0xff) / 255,
          ((h >> 24) & 0xff) / 255,
        ];
      };
      return hash(text);
    });
  }
}

class MockVectorStore implements VectorStore {
  readonly metadata = null;
  private records: Array<{ id: string; embedding: number[]; metadata: Metadata }> = [];

  async add(embeddings: number[][], metadatas: Metadata[], ids?: string[]): Promise<void> {
    for (let i = 0; i < embeddings.length; i++) {
      this.records.push({
        id: ids?.[i] ?? `id-${i}`,
        embedding: embeddings[i],
        metadata: metadatas[i],
      });
    }
  }

  async search(query: number[], limit: number): Promise<SearchResult[]> {
    return this.records
      .map((r) => ({
        id: r.id,
        content: (r.metadata.content as string) ?? '',
        score: this.cosineSimilarity(query, r.embedding),
        metadata: r.metadata,
        documentId: (r.metadata.documentId as string) ?? undefined,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async delete(ids: string[]): Promise<void> {
    const idSet = new Set(ids);
    this.records = this.records.filter((r) => !idSet.has(r.id));
  }

  async save(): Promise<void> { }
  async load(): Promise<void> { }

  get size(): number {
    return this.records.length;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

// -- Tests -----------------------------------------------------------

function createTestEngine(overrides: Partial<QueryEngineConfig> = {}): QueryEngine {
  const config: QueryEngineConfig = {
    embeddings: new MockEmbeddingProvider(),
    vectorStore: new MockVectorStore(),
    logger: new NoopLogger(),
    ...overrides,
  };
  return new QueryEngine(config);
}

describe('QueryEngine', () => {
  describe('dense search (default)', () => {
    it('returns query results', async () => {
      createTestEngine();
      // Add some documents
      const vs = new MockVectorStore();
      const embeddings = new MockEmbeddingProvider();
      const texts = ['TypeScript is great', 'Python is also great'];
      const embeds = await embeddings.embed(texts);
      await vs.add(
        embeds,
        texts.map((c, i) => ({ content: c, documentId: `doc${i}`, chunkIndex: i })),
        ['chunk1', 'chunk2'],
      );

      const engine2 = createTestEngine({ vectorStore: vs });
      const result = await engine2.query('TypeScript');
      expect(result.context.length).toBeGreaterThan(0);
      expect(result.searchMode).toBe('dense');
    });

    it('returns searchMode in result', async () => {
      const engine = createTestEngine();
      const result = await engine.query('test');
      expect(result.searchMode).toBe('dense');
    });

    it('applies score threshold', async () => {
      const vs = new MockVectorStore();
      const embeddings = new MockEmbeddingProvider();
      const texts = ['hello world', 'foo bar'];
      const embeds = await embeddings.embed(texts);
      await vs.add(
        embeds,
        texts.map((c, i) => ({ content: c, documentId: `doc${i}`, chunkIndex: i })),
        ['c1', 'c2'],
      );

      const engine = createTestEngine({ vectorStore: vs });
      const result = await engine.query('hello', { scoreThreshold: 0.99 });
      // With very high threshold, likely no results pass
      expect(result.context.every((r) => r.score >= 0.99)).toBe(true);
    });

    it('respects topK', async () => {
      const vs = new MockVectorStore();
      const embeddings = new MockEmbeddingProvider();
      const texts = ['one', 'two', 'three', 'four', 'five'];
      const embeds = await embeddings.embed(texts);
      await vs.add(
        embeds,
        texts.map((c, i) => ({ content: c, documentId: `doc${i}`, chunkIndex: i })),
        texts.map((_, i) => `c${i}`),
      );

      const engine = createTestEngine({ vectorStore: vs });
      const result = await engine.query('test', { topK: 2 });
      expect(result.context.length).toBeLessThanOrEqual(2);
    });
  });

  describe('sparse search (BM25)', () => {
    it('searches BM25 index when mode is sparse', async () => {
      const bm25 = new BM25Index();
      bm25.addDocuments([
        { id: 'c1', content: 'TypeScript is a typed language', metadata: { documentId: 'doc1', chunkIndex: 0 } },
        { id: 'c2', content: 'Python is a dynamic language', metadata: { documentId: 'doc2', chunkIndex: 0 } },
      ]);

      const engine = createTestEngine({ bm25 });
      const result = await engine.query('TypeScript', { searchMode: 'sparse' });
      expect(result.context.length).toBeGreaterThan(0);
      expect(result.searchMode).toBe('sparse');
    });

    it('throws when BM25 index is not configured', async () => {
      const engine = createTestEngine();
      await expect(engine.query('test', { searchMode: 'sparse' })).rejects.toThrow(
        'BM25 index is required',
      );
    });

    it('returns keyword-matching results', async () => {
      const bm25 = new BM25Index();
      bm25.addDocuments([
        { id: 'c1', content: 'how to configure API endpoints', metadata: {} },
        { id: 'c2', content: 'the weather is nice today', metadata: {} },
      ]);

      const engine = createTestEngine({ bm25 });
      const result = await engine.query('configure API', { searchMode: 'sparse', topK: 1 });
      expect(result.context.length).toBeGreaterThan(0);
      expect(result.context[0].content).toContain('API');
    });
  });

  describe('hybrid search', () => {
    it('combines dense and sparse results', async () => {
      const vs = new MockVectorStore();
      const embeddings = new MockEmbeddingProvider();
      const texts = ['API configuration guide', 'database optimization tips'];
      const embeds = await embeddings.embed(texts);
      await vs.add(
        embeds,
        texts.map((c, i) => ({ content: c, documentId: `doc${i}`, chunkIndex: i })),
        ['c1', 'c2'],
      );

      const bm25 = new BM25Index();
      bm25.addDocuments([
        { id: 'c1', content: 'API configuration guide', metadata: {} },
        { id: 'c2', content: 'database optimization tips', metadata: {} },
      ]);

      const engine = createTestEngine({ vectorStore: vs, bm25 });
      const result = await engine.query('API configuration', { searchMode: 'hybrid', topK: 5 });
      expect(result.context.length).toBeGreaterThan(0);
      expect(result.searchMode).toBe('hybrid');
    });

    it('throws when BM25 index is not configured for hybrid', async () => {
      const engine = createTestEngine();
      await expect(engine.query('test', { searchMode: 'hybrid' })).rejects.toThrow(
        'BM25 index is required',
      );
    });

    it('respects denseWeight', async () => {
      const vs = new MockVectorStore();
      const embeddings = new MockEmbeddingProvider();
      const texts = ['API config', 'database tips'];
      const embeds = await embeddings.embed(texts);
      await vs.add(
        embeds,
        texts.map((c, i) => ({ content: c, documentId: `doc${i}`, chunkIndex: i })),
        ['c1', 'c2'],
      );

      const bm25 = new BM25Index();
      bm25.addDocuments([
        { id: 'c1', content: 'API config', metadata: {} },
        { id: 'c2', content: 'database tips', metadata: {} },
      ]);

      const engineHeavyDense = createTestEngine({ vectorStore: vs, bm25 });
      const result = await engineHeavyDense.query('API', {
        searchMode: 'hybrid',
        denseWeight: 0.9,
        topK: 2,
      });
      expect(result.context.length).toBeGreaterThan(0);
    });
  });

  describe('reranking', () => {
    it('applies reranker when configured', async () => {
      const vs = new MockVectorStore();
      const embeddings = new MockEmbeddingProvider();
      const texts = ['hello world', 'foo bar baz'];
      const embeds = await embeddings.embed(texts);
      await vs.add(
        embeds,
        texts.map((c, i) => ({ content: c, documentId: `doc${i}`, chunkIndex: i })),
        ['c1', 'c2'],
      );

      const mockReranker = {
        name: 'MockReranker',
        async rerank(_query: string, documents: string[]): Promise<number[]> {
          // Give higher score to documents containing 'hello'
          return documents.map((d) => (d.includes('hello') ? 0.9 : 0.1));
        },
      };

      const engine = createTestEngine({ vectorStore: vs, reranker: mockReranker as any });
      const result = await engine.query('hello', { rerank: true, topK: 2 });
      expect(result.context.length).toBeGreaterThan(0);
      // After reranking, 'hello world' should be first
      expect(result.context[0].content).toContain('hello');
    });

    it('skips reranking when reranker is not configured', async () => {
      const engine = createTestEngine();
      // Should not throw even with rerank: true
      const result = await engine.query('test', { rerank: true });
      expect(result).toBeDefined();
    });

    it('skips reranking for single result', async () => {
      const vs = new MockVectorStore();
      const embeddings = new MockEmbeddingProvider();
      const embeds = await embeddings.embed(['single document']);
      await vs.add(embeds, [{ content: 'single document', documentId: 'doc1', chunkIndex: 0 }], ['c1']);

      let rerankCalled = false;
      const mockReranker = {
        name: 'MockReranker',
        async rerank(): Promise<number[]> {
          rerankCalled = true;
          return [0.9];
        },
      };

      const engine = createTestEngine({ vectorStore: vs, reranker: mockReranker as any });
      await engine.query('test', { rerank: true, topK: 1 });
      expect(rerankCalled).toBe(false);
    });
  });

  describe('query rewriting', () => {
    it('applies query rewriter when configured', async () => {
      const vs = new MockVectorStore();
      const embeddings = new MockEmbeddingProvider();
      const texts = ['hello world', 'greetings earth'];
      const embeds = await embeddings.embed(texts);
      await vs.add(
        embeds,
        texts.map((c, i) => ({ content: c, documentId: `doc${i}`, chunkIndex: i })),
        ['c1', 'c2'],
      );

      const mockRewriter = {
        name: 'MockRewriter',
        async rewrite(query: string): Promise<string[]> {
          return [query, query.toLowerCase(), 'greetings'];
        },
      };

      const engine = createTestEngine({ vectorStore: vs, queryRewriter: mockRewriter as any });
      const result = await engine.query('Hello', { rewriteQuery: true });
      expect(result.context.length).toBeGreaterThan(0);
    });

    it('does not rewrite when rewriteQuery is false', async () => {
      let rewriteCalled = false;
      const mockRewriter = {
        name: 'MockRewriter',
        async rewrite(): Promise<string[]> {
          rewriteCalled = true;
          return ['test'];
        },
      };

      const engine = createTestEngine({ queryRewriter: mockRewriter as any });
      await engine.query('test', { rewriteQuery: false });
      expect(rewriteCalled).toBe(false);
    });
  });

  describe('syncBM25', () => {
    it('adds documents to BM25 index', () => {
      const bm25 = new BM25Index();
      const engine = createTestEngine({ bm25 });

      engine.syncBM25([
        { id: '1', content: 'hello world', metadata: {} },
        { id: '2', content: 'foo bar', metadata: {} },
      ]);

      expect(bm25.size).toBe(2);
    });

    it('does nothing when BM25 is not configured', () => {
      const engine = createTestEngine();
      // Should not throw
      engine.syncBM25([{ id: '1', content: 'hello', metadata: {} }]);
    });
  });

  describe('queryAndAnswer with Phase 3 options', () => {
    it('answer is generated with rerank option', async () => {
      const vs = new MockVectorStore();
      const embeddings = new MockEmbeddingProvider();
      const texts = ['TypeScript is great'];
      const embeds = await embeddings.embed(texts);
      await vs.add(embeds, texts.map((c) => ({ content: c })), ['c1']);

      const mockReranker = {
        name: 'Mock',
        async rerank(_q: string, docs: string[]): Promise<number[]> {
          return docs.map(() => 0.5);
        },
      };
      const mockLlm = {
        async generate(): Promise<string> { return 'answer'; },
        async *stream(): AsyncIterable<string> { },
      };

      const engine = createTestEngine({ vectorStore: vs, reranker: mockReranker as any });
      const result = await engine.queryAndAnswer('test', mockLlm, { rerank: true });
      expect(result.answer).toBe('answer');
      expect(result.context.length).toBeGreaterThan(0);
    });

    it('answer is generated with rewriteQuery option', async () => {
      const vs = new MockVectorStore();
      const embeddings = new MockEmbeddingProvider();
      const texts = ['hello world'];
      const embeds = await embeddings.embed(texts);
      await vs.add(embeds, texts.map((c) => ({ content: c })), ['c1']);

      let rewriteCalled = false;
      const mockRewriter = {
        name: 'Mock',
        async rewrite(q: string): Promise<string[]> {
          rewriteCalled = true;
          return [q];
        },
      };
      const mockLlm = {
        async generate(): Promise<string> { return 'answer'; },
        async *stream(): AsyncIterable<string> { },
      };

      const engine = createTestEngine({ vectorStore: vs, queryRewriter: mockRewriter as any });
      const result = await engine.queryAndAnswer('hello', mockLlm, { rewriteQuery: true });
      expect(rewriteCalled).toBe(true);
      expect(result.answer).toBe('answer');
    });
  });

  describe('rerank edge cases', () => {
    it('reranker error is wrapped in RerankError', async () => {
      const vs = new MockVectorStore();
      await vs.add([[0.1, 0.2]], [{ content: 'doc' }], ['c1']);
      await vs.add([[0.3, 0.4]], [{ content: 'doc2' }], ['c2']);

      const mockReranker = {
        name: 'FailingReranker',
        async rerank(): Promise<number[]> {
          throw new Error('network error');
        },
      };

      const engine = createTestEngine({ vectorStore: vs, reranker: mockReranker as any });
      await expect(engine.query('test', { rerank: true })).rejects.toThrow('Reranking failed');
    });
  });
});
