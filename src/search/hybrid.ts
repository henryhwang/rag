// ============================================================
// Hybrid search — fuses dense (vector) and sparse (BM25) results.
// Uses score normalization and weighted combination.
// ============================================================

import { SearchResult, Metadata } from '../types/index.ts';
import { BM25Index, BM25SearchResult, BM25Document } from './bm25.ts';

export interface HybridSearchConfig {
  /** Weight for dense (vector) scores in the fusion, 0–1. Default: 0.5. */
  denseWeight: number;
}

export const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  denseWeight: 0.5,
};

/**
 * Normalized score for a single result set.
 * Converts raw scores to 0–1 range using min-max normalization.
 */
function normalizeScores(
  results: { id: string; score: number }[],
): Map<string, number> {
  const scores = new Map<string, number>();
  if (results.length === 0) return scores;

  let min = Infinity;
  let max = -Infinity;
  for (const r of results) {
    if (r.score < min) min = r.score;
    if (r.score > max) max = r.score;
  }

  const range = max - min;
  for (const r of results) {
    scores.set(r.id, range === 0 ? 0.5 : (r.score - min) / range);
  }
  return scores;
}

/**
 * Fuse dense and sparse search results using weighted score combination.
 *
 * Both result sets are normalized to 0–1, then combined as:
 *   final_score = denseWeight * dense_score + (1 - denseWeight) * sparse_score
 *
 * Results present in only one set get the other score as 0.
 */
export function fuseResults(
  denseResults: SearchResult[],
  sparseResults: BM25SearchResult[],
  config: HybridSearchConfig,
  limit: number,
): SearchResult[] {
  const denseWeight = config.denseWeight;
  const sparseWeight = 1 - denseWeight;

  const denseScores = normalizeScores(
    denseResults.map((r) => ({ id: r.id, score: r.score })),
  );
  const sparseScores = normalizeScores(
    sparseResults.map((r) => ({ id: r.id, score: r.score })),
  );

  // Union of all result ids
  const allIds = new Set<string>([
    ...denseResults.map((r) => r.id),
    ...sparseResults.map((r) => r.id),
  ]);

  // Build lookup maps for content/metadata
  const denseMap = new Map<string, SearchResult>();
  for (const r of denseResults) {
    denseMap.set(r.id, r);
  }
  const sparseMap = new Map<string, BM25SearchResult>();
  for (const r of sparseResults) {
    sparseMap.set(r.id, r);
  }

  // Combine scores
  const fused: SearchResult[] = [];
  for (const id of allIds) {
    const dScore = denseScores.get(id) ?? 0;
    const sScore = sparseScores.get(id) ?? 0;
    const finalScore = denseWeight * dScore + sparseWeight * sScore;

    // Prefer dense result for content/metadata; fall back to sparse
    const denseResult = denseMap.get(id);
    const sparseResult = sparseMap.get(id);
    const result = denseResult ?? sparseResult!;

    fused.push({
      id: result.id,
      content: result.content,
      score: finalScore,
      metadata: result.metadata as Metadata,
      documentId: (result.metadata.documentId as string) ?? undefined,
    });
  }

  return fused.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Sync a BM25 index with the vector store metadata.
 * Call this after adding/removing documents to keep BM25 in sync.
 *
 * Extracts documents from stored metadata and indexes them for BM25.
 */
export function syncBM25WithStore(
  bm25: BM25Index,
  documents: BM25Document[],
): void {
  bm25.addDocuments(documents);
}

/**
 * Reciprocal Rank Fusion (RRF) — an alternative fusion method that
 * uses rank positions rather than raw scores. Often more robust when
 * score distributions differ significantly between dense and sparse.
 *
 * RRF(d) = Σ 1 / (k + rank(d))
 * where k is a constant (default 60).
 */
export function reciprocalRankFusion(
  denseResults: SearchResult[],
  sparseResults: BM25SearchResult[],
  limit: number,
  k: number = 60,
): SearchResult[] {
  const allIds = new Set<string>([
    ...denseResults.map((r) => r.id),
    ...sparseResults.map((r) => r.id),
  ]);

  const denseRank = new Map<string, number>();
  for (let i = 0; i < denseResults.length; i++) {
    denseRank.set(denseResults[i].id, i + 1);
  }

  const sparseRank = new Map<string, number>();
  for (let i = 0; i < sparseResults.length; i++) {
    sparseRank.set(sparseResults[i].id, i + 1);
  }

  const denseMap = new Map<string, SearchResult>();
  for (const r of denseResults) denseMap.set(r.id, r);
  const sparseMap = new Map<string, BM25SearchResult>();
  for (const r of sparseResults) sparseMap.set(r.id, r);

  const fused: SearchResult[] = [];
  for (const id of allIds) {
    const dRank = denseRank.get(id);
    const sRank = sparseRank.get(id);
    const rrfScore =
      (dRank ? 1 / (k + dRank) : 0) + (sRank ? 1 / (k + sRank) : 0);

    const denseResult = denseMap.get(id);
    const sparseResult = sparseMap.get(id);
    const result = denseResult ?? sparseResult!;

    fused.push({
      id: result.id,
      content: result.content,
      score: rrfScore,
      metadata: result.metadata as Metadata,
      documentId: (result.metadata.documentId as string) ?? undefined,
    });
  }

  return fused.sort((a, b) => b.score - a.score).slice(0, limit);
}
