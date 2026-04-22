// ============================================================
// Tests for batching utilities
// ============================================================
import { describe, it, expect } from 'bun:test';
import { getBatchIndices, estimateTokens } from '../src/reranking/batching.ts';

describe('getBatchIndices', () => {
  it('returns empty iterator when totalDocs is 0', () => {
    const batches = Array.from(getBatchIndices(0, [], 10));
    expect(batches).toEqual([]);
  });

  it('yields single batch when all docs fit within count limit', () => {
    const docSizes = [100, 200, 150];
    const batches = Array.from(getBatchIndices(3, docSizes, 10));

    expect(batches).toEqual([[0, 3]]); // All 3 docs in one batch
  });

  it('splits into multiple batches when exceeding batchSize', () => {
    const docSizes = [100, 200, 150, 300, 250];
    const batches = Array.from(getBatchIndices(5, docSizes, 2));

    expect(batches).toEqual([
      [0, 2], // docs 0-1
      [2, 4], // docs 2-3
      [4, 5], // doc 4
    ]);
  });

  it('respects maxContentLengthPerBatch when set', () => {
    const docSizes = [100, 200, 150, 300];
    const batches = Array.from(getBatchIndices(4, docSizes, 10, 400));

    expect(batches).toEqual([
      [0, 2], // 100 + 200 = 300 (adding 150 would exceed 400)
      [2, 3], // 150 alone (adding 300 would exceed 400)
      [3, 4], // 300 alone
    ]);
  });

  it('prioritizes both limits - stops at whichever comes first', () => {
    const docSizes = [100, 200, 150, 80, 90, 70];
    const batches = Array.from(getBatchIndices(6, docSizes, 3, 400));

    expect(batches).toEqual([
      [0, 2], // 2 docs, 300 chars (adding 150 would exceed 400)
      [2, 5], // 3 docs, 320 chars (hit batchSize limit of 3)
      [5, 6], // 1 doc, 70 chars (remaining)
    ]);
  });

  it('handles documents larger than maxContentLengthPerBatch individually', () => {
    const docSizes = [50, 500, 60, 70]; // doc[1] = 500 exceeds limit of 400
    const batches = Array.from(getBatchIndices(4, docSizes, 10, 400));

    expect(batches).toEqual([
      [0, 1], // doc[0] = 50
      [1, 2], // doc[1] = 500 (forced alone despite exceeding limit)
      [2, 4], // docs[2-3] = 130
    ]);
  });

  it('works with exactly at the limit', () => {
    const docSizes = [100, 200, 100, 200];
    const batches = Array.from(getBatchIndices(4, docSizes, 10, 300));

    expect(batches).toEqual([
      [0, 2], // 100 + 200 = 300 (exactly at limit)
      [2, 4], // 100 + 200 = 300 (exactly at limit)
    ]);
  });

  it('handles single document edge case', () => {
    const docSizes = [500];
    const batches = Array.from(getBatchIndices(1, docSizes, 10, 400));

    expect(batches).toEqual([[0, 1]]); // Single doc always in its own batch
  });

  it('many small documents with tight content limit', () => {
    const docSizes = Array(20).fill(150); // 20 docs × 150 chars
    const batches = Array.from(getBatchIndices(20, docSizes, 10, 400));

    // Each batch can have at most floor(400/150) = 2 docs due to size limit
    expect(batches.length).toBe(10); // 20 docs / 2 per batch = 10 batches
    expect(batches[0]).toEqual([0, 2]);
    expect(batches[batches.length - 1]).toEqual([18, 20]);
  });

  it('validates docSizes length matches totalDocs', () => {
    const docSizes = [100, 200, 150];
    const batches = Array.from(getBatchIndices(5, docSizes, 10));

    // Should return empty when lengths don't match
    expect(batches).toEqual([]);
  });

  it('no content limit uses Infinity as default', () => {
    const docSizes = [1000, 2000, 3000, 4000, 5000];
    const batches = Array.from(getBatchIndices(5, docSizes, 3));

    // Only batch size matters since no content limit
    expect(batches).toEqual([
      [0, 3],
      [3, 5],
    ]);
  });
});

describe('estimateTokens', () => {
  it('returns 1 token for very short text', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('ab')).toBe(1);
    expect(estimateTokens('abc')).toBe(1);
  });

  it('calculates tokens using 4 chars per token ratio', () => {
    expect(estimateTokens('abcd')).toBe(1);     // 4 chars = 1 token
    expect(estimateTokens('abcde')).toBe(2);    // 5 chars = 2 tokens
    expect(estimateTokens('test')).toBe(1);     // 4 chars = 1 token
    expect(estimateTokens('hello world')).toBe(3); // 11 chars = 3 tokens
  });

  it('handles long text correctly', () => {
    const longText = 'a'.repeat(100);
    expect(estimateTokens(longText)).toBe(25); // 100 / 4 = 25
  });

  it('handles empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('ceils fractional results', () => {
    expect(estimateTokens('abc')).toBe(1);   // 0.75 → 1
    expect(estimateTokens('abcdef')).toBe(2); // 1.5 → 2
    expect(estimateTokens('abcdefgh')).toBe(2); // 2.0 → 2
    expect(estimateTokens('abcdefghi')).toBe(3); // 2.25 → 3
  });
});
