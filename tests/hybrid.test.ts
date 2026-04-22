import { describe, it, expect } from 'bun:test';
import { fuseResults, reciprocalRankFusion, DEFAULT_HYBRID_CONFIG } from '../src/search/hybrid.ts';
import { SearchResult } from '../src/types/index.ts';
import { SparseSearchResult } from '../src/types/index.ts';

describe('Hybrid Search Fusion', () => {
  const denseResults: SearchResult[] = [
    { id: '1', content: 'doc 1', score: 0.9, metadata: {} },
    { id: '2', content: 'doc 2', score: 0.7, metadata: {} },
    { id: '3', content: 'doc 3', score: 0.5, metadata: {} },
    { id: '5', content: 'doc 5', score: 0.3, metadata: {} },
  ];

  const sparseResults: SparseSearchResult[] = [
    { id: '2', content: 'doc 2', score: 10.0, metadata: {} },
    { id: '3', content: 'doc 3', score: 8.0, metadata: {} },
    { id: '4', content: 'doc 4', score: 5.0, metadata: {} },
    { id: '5', content: 'doc 5', score: 2.0, metadata: {} },
  ];

  describe('fuseResults', () => {
    it('combines dense and sparse results', () => {
      const fused = fuseResults(denseResults, sparseResults, DEFAULT_HYBRID_CONFIG, 5);
      expect(fused.length).toBeGreaterThan(0);
      // All unique ids from both sets should be present
      const ids = new Set(fused.map((r) => r.id));
      expect(ids.has('1')).toBe(true); // from dense only
      expect(ids.has('4')).toBe(true); // from sparse only
      expect(ids.has('2')).toBe(true); // from both
    });

    it('respects limit', () => {
      const fused = fuseResults(denseResults, sparseResults, DEFAULT_HYBRID_CONFIG, 2);
      expect(fused.length).toBeLessThanOrEqual(2);
    });

    it('results sorted by score descending', () => {
      const fused = fuseResults(denseResults, sparseResults, DEFAULT_HYBRID_CONFIG, 10);
      for (let i = 1; i < fused.length; i++) {
        expect(fused[i].score).toBeLessThanOrEqual(fused[i - 1].score);
      }
    });

    it('favors dense with higher denseWeight', () => {
      const denseFavoring = fuseResults(denseResults, sparseResults, { denseWeight: 0.9 }, 5);
      const sparseFavoring = fuseResults(denseResults, sparseResults, { denseWeight: 0.1 }, 5);

      // Doc 1 only appears in dense, should rank higher with denseWeight=0.9
      const denseFavoringPos = denseFavoring.findIndex((r) => r.id === '1');
      const sparseFavoringPos = sparseFavoring.findIndex((r) => r.id === '1');
      expect(denseFavoringPos).toBeLessThanOrEqual(sparseFavoringPos);
    });

    it('equal weight by default', () => {
      const fused = fuseResults(denseResults, sparseResults, { denseWeight: 0.5 }, 10);
      expect(fused.length).toBeGreaterThan(0);
    });

    it('handles empty dense results', () => {
      const fused = fuseResults([], sparseResults, DEFAULT_HYBRID_CONFIG, 5);
      expect(fused.length).toBeLessThanOrEqual(5);
      expect(fused.every((r) => ['2', '3', '4', '5'].includes(r.id))).toBe(true);
    });

    it('handles empty sparse results', () => {
      const fused = fuseResults(denseResults, [], DEFAULT_HYBRID_CONFIG, 5);
      expect(fused.length).toBeLessThanOrEqual(5);
      expect(fused.every((r) => ['1', '2', '3', '5'].includes(r.id))).toBe(true);
    });

    it('handles both empty', () => {
      const fused = fuseResults([], [], DEFAULT_HYBRID_CONFIG, 5);
      expect(fused).toEqual([]);
    });

    it('normalizes scores to 0-1 range', () => {
      const extremeDense: SearchResult[] = [
        { id: '1', content: 'doc 1', score: 1000, metadata: {} },
        { id: '2', content: 'doc 2', score: 0.001, metadata: {} },
      ];
      const fused = fuseResults(extremeDense, [], DEFAULT_HYBRID_CONFIG, 5);
      // Scores should be normalized (not extreme)
      for (const r of fused) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    });

    it('preserves content and metadata', () => {
      const dense: SearchResult[] = [
        { id: '1', content: 'hello world', score: 0.9, metadata: { documentId: 'doc1', custom: true } },
      ];
      const fused = fuseResults(dense, [], DEFAULT_HYBRID_CONFIG, 5);
      expect(fused[0].content).toBe('hello world');
      expect(fused[0].metadata.documentId).toBe('doc1');
      expect(fused[0].metadata.custom).toBe(true);
    });
  });

  describe('reciprocalRankFusion', () => {
    it('combines results using rank positions', () => {
      const fused = reciprocalRankFusion(denseResults, sparseResults, 5);
      expect(fused.length).toBeGreaterThan(0);
      const ids = new Set(fused.map((r) => r.id));
      expect(ids.has('1')).toBe(true);
      expect(ids.has('4')).toBe(true);
    });

    it('results sorted by RRF score descending', () => {
      const fused = reciprocalRankFusion(denseResults, sparseResults, 10);
      for (let i = 1; i < fused.length; i++) {
        expect(fused[i].score).toBeLessThanOrEqual(fused[i - 1].score);
      }
    });

    it('respects limit', () => {
      const fused = reciprocalRankFusion(denseResults, sparseResults, 2);
      expect(fused.length).toBeLessThanOrEqual(2);
    });

    it('handles empty inputs', () => {
      expect(reciprocalRankFusion([], [], 5)).toEqual([]);
      expect(reciprocalRankFusion(denseResults, [], 5).length).toBeGreaterThan(0);
      expect(reciprocalRankFusion([], sparseResults, 5).length).toBeGreaterThan(0);
    });

    it('k parameter affects score magnitude', () => {
      const fusedK10 = reciprocalRankFusion(denseResults, sparseResults, 10, 10);
      const fusedK100 = reciprocalRankFusion(denseResults, sparseResults, 10, 100);
      // With smaller k, rank differences matter more -> higher scores
      if (fusedK10.length > 0 && fusedK100.length > 0) {
        expect(fusedK10[0].score).toBeGreaterThan(fusedK100[0].score);
      }
    });

    it('appearing in both lists boosts ranking', () => {
      const fused = reciprocalRankFusion(denseResults, sparseResults, 10);
      // Doc 2 and 3 appear in both lists, should generally rank higher than docs in only one
      const bothIds = ['2', '3'];
      const singleIds = ['1', '4'];
      const avgBoth = fused
        .filter((r) => bothIds.includes(r.id))
        .reduce((sum, r) => sum + r.score, 0) / bothIds.length;
      const avgSingle = fused
        .filter((r) => singleIds.includes(r.id))
        .reduce((sum, r) => sum + r.score, 0) / singleIds.length;
      expect(avgBoth).toBeGreaterThan(avgSingle);
    });
  });
});
