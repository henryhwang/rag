import { describe, it, expect } from 'bun:test';
import { BM25Index, BM25Document } from '../src/search/bm25.js';

describe('BM25Index', () => {
  const createDocs = (): BM25Document[] => [
    { id: '1', content: 'The quick brown fox jumps over the lazy dog', metadata: {} },
    { id: '2', content: 'The lazy dog sleeps all day long', metadata: {} },
    { id: '3', content: 'The quick fox is very quick and agile', metadata: {} },
    { id: '4', content: 'Python is a programming language used for data science', metadata: {} },
    { id: '5', content: 'TypeScript is a typed programming language for web development', metadata: {} },
  ];

  describe('construction', () => {
    it('creates with default config', () => {
      const index = new BM25Index();
      expect(index.size).toBe(0);
    });

    it('creates with custom config', () => {
      const index = new BM25Index({ k1: 2.0, b: 0.5 });
      expect(index.size).toBe(0);
    });
  });

  describe('addDocuments', () => {
    it('adds documents and increases size', () => {
      const index = new BM25Index();
      index.addDocuments(createDocs());
      expect(index.size).toBe(5);
    });

    it('throws on document without id', () => {
      const index = new BM25Index();
      expect(() =>
        index.addDocuments([{ id: '', content: 'hello', metadata: {} }]),
      ).toThrow('id and content are required');
    });

    it('throws on document without content', () => {
      const index = new BM25Index();
      expect(() =>
        index.addDocuments([{ id: '1', content: '', metadata: {} }]),
      ).toThrow('id and content are required');
    });

    it('handles duplicate ids (last write wins)', () => {
      const index = new BM25Index();
      index.addDocuments([
        { id: '1', content: 'first version', metadata: {} },
        { id: '1', content: 'second version', metadata: {} },
      ]);
      expect(index.size).toBe(1);
    });
  });

  describe('removeDocuments', () => {
    it('removes documents by id', () => {
      const index = new BM25Index();
      index.addDocuments(createDocs());
      index.removeDocuments(['1', '2']);
      expect(index.size).toBe(3);
    });

    it('removing non-existent id is a no-op', () => {
      const index = new BM25Index();
      index.addDocuments(createDocs());
      index.removeDocuments(['nonexistent']);
      expect(index.size).toBe(5);
    });

    it('removes all documents', () => {
      const index = new BM25Index();
      const docs = createDocs();
      index.addDocuments(docs);
      index.removeDocuments(docs.map((d) => d.id));
      expect(index.size).toBe(0);
    });
  });

  describe('search', () => {
    it('returns results for matching query', () => {
      const index = new BM25Index();
      index.addDocuments(createDocs());
      const results = index.search('quick fox', 3);
      expect(results.length).toBeGreaterThan(0);
      // Documents about quick fox should rank higher
      expect(results[0].content).toContain('quick');
    });

    it('returns empty for no match', () => {
      const index = new BM25Index();
      index.addDocuments(createDocs());
      const results = index.search('xyzzyplugh', 5);
      expect(results.length).toBe(0);
    });

    it('respects limit', () => {
      const index = new BM25Index();
      index.addDocuments(createDocs());
      const results = index.search('programming language', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returns results sorted by score descending', () => {
      const index = new BM25Index();
      index.addDocuments(createDocs());
      const results = index.search('programming', 3);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });

    it('returns id, content, score, metadata', () => {
      const index = new BM25Index();
      index.addDocuments(createDocs());
      const results = index.search('dog', 1);
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('content');
      expect(results[0]).toHaveProperty('score');
      expect(results[0]).toHaveProperty('metadata');
    });

    it('scores higher for more frequent terms', () => {
      const index = new BM25Index();
      index.addDocuments([
        { id: '1', content: 'quick quick quick quick quick', metadata: {} },
        { id: '2', content: 'quick', metadata: {} },
      ]);
      const results = index.search('quick', 2);
      expect(results[0].id).toBe('1');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('handles empty query', () => {
      const index = new BM25Index();
      index.addDocuments(createDocs());
      const results = index.search('', 5);
      expect(results).toEqual([]);
    });

    it('handles query with only punctuation', () => {
      const index = new BM25Index();
      index.addDocuments(createDocs());
      const results = index.search('...!!!???', 5);
      expect(results).toEqual([]);
    });

    it('search on empty index returns empty', () => {
      const index = new BM25Index();
      const results = index.search('hello', 5);
      expect(results).toEqual([]);
    });

    it('case insensitive search', () => {
      const index = new BM25Index();
      index.addDocuments(createDocs());
      const resultsLower = index.search('quick fox', 5);
      const resultsUpper = index.search('QUICK FOX', 5);
      expect(resultsLower).toEqual(resultsUpper);
    });

    it('metadata is preserved in results', () => {
      const index = new BM25Index();
      index.addDocuments([
        { id: '1', content: 'hello world', metadata: { documentId: 'doc1', custom: 'value' } },
      ]);
      const results = index.search('hello', 1);
      expect(results[0].metadata.documentId).toBe('doc1');
      expect(results[0].metadata.custom).toBe('value');
    });
  });

  describe('indexedIds', () => {
    it('returns all document ids', () => {
      const index = new BM25Index();
      const docs = createDocs();
      index.addDocuments(docs);
      const ids = index.indexedIds;
      expect(ids.sort()).toEqual(docs.map((d) => d.id).sort());
    });
  });

  describe('BM25 scoring properties', () => {
    it('rarer terms get higher scores', () => {
      const index = new BM25Index();
      index.addDocuments([
        { id: '1', content: 'the cat sat on the mat', metadata: {} },
        { id: '2', content: 'the dog sat on the mat', metadata: {} },
        { id: '3', content: 'the cat ate the food', metadata: {} },
        { id: '4', content: 'a unique term appears here', metadata: {} },
      ]);

      const catResults = index.search('cat', 4);
      const uniqueResults = index.search('unique', 4);

      // 'unique' appears in only one doc, so it should have higher IDF
      if (uniqueResults.length > 0 && catResults.length > 0) {
        const catScore = catResults.find((r) => r.id === '1')?.score ?? 0;
        const uniqueScore = uniqueResults.find((r) => r.id === '4')?.score ?? 0;
        expect(uniqueScore).toBeGreaterThan(catScore);
      }
    });

    it('shorter documents with matching terms rank higher', () => {
      const index = new BM25Index();
      index.addDocuments([
        { id: '1', content: 'python python python', metadata: {} },
        {
          id: '2',
          content: 'python ' + 'word '.repeat(100),
          metadata: {},
        },
      ]);
      const results = index.search('python', 2);
      expect(results[0].id).toBe('1');
    });
  });
});
