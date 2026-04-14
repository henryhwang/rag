// ============================================================
// Search module — BM25 sparse search and hybrid (dense+sparse) fusion
// ============================================================

export {
  BM25Index,
  type BM25Document,
  type BM25SearchResult,
  type BM25Config,
  DEFAULT_BM25_CONFIG,
} from './bm25.ts';

export {
  fuseResults,
  reciprocalRankFusion,
  syncBM25WithStore,
  type HybridSearchConfig,
  DEFAULT_HYBRID_CONFIG,
} from './hybrid.ts';
