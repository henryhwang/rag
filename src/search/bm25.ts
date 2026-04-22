// ============================================================
// BM25 sparse search index — keyword-based retrieval
// Uses the Okapi BM25 ranking function.
// ============================================================

import type { Metadata, SparseDocument } from '../types/index.ts'
import { SearchError } from '../errors/index.ts';

export type BM25Document = SparseDocument;

export interface BM25SearchResult {
  id: string;
  content: string;
  score: number;
  metadata: Metadata;
}

export interface BM25Config {
  /** Term frequency saturation parameter. Default: 1.5. */
  k1: number;
  /** Length normalization parameter. Default: 0.75. */
  b: number;
}

export const DEFAULT_BM25_CONFIG: BM25Config = {
  k1: 1.5,
  b: 0.75,
};

/** Simple tokenizer: lowercase, split on non-alphanumeric, filter empty tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

class DocumentIndex {
  docId: string;
  content: string;
  metadata: Metadata;
  terms: string[];
  termFreq: Map<string, number>;

  constructor(doc: BM25Document) {
    this.docId = doc.id;
    this.content = doc.content;
    this.metadata = doc.metadata;
    this.terms = tokenize(doc.content);
    this.termFreq = new Map();
    for (const term of this.terms) {
      this.termFreq.set(term, (this.termFreq.get(term) ?? 0) + 1);
    }
  }

  get length(): number {
    return this.terms.length;
  }
}

export class BM25Index {
  private readonly config: BM25Config;
  private docs: Map<string, DocumentIndex> = new Map();
  /** Inverted index: term -> Set of docIds. */
  private invertedIndex: Map<string, Set<string>> = new Map();

  constructor(config?: Partial<BM25Config>) {
    this.config = { ...DEFAULT_BM25_CONFIG, ...config };
  }

  /** Add documents to the index. */
  addDocuments(documents: BM25Document[]): void {
    for (const doc of documents) {
      if (!doc.id || !doc.content) {
        throw new SearchError(
          `Invalid document: id and content are required, got id="${doc.id}", content.length=${doc.content?.length}`,
        );
      }
      const indexed = new DocumentIndex(doc);
      this.docs.set(doc.id, indexed);

      // Update inverted index
      for (const term of indexed.termFreq.keys()) {
        if (!this.invertedIndex.has(term)) {
          this.invertedIndex.set(term, new Set());
        }
        this.invertedIndex.get(term)!.add(doc.id);
      }
    }
  }

  /** Remove documents by id. */
  removeDocuments(ids: string[]): void {
    const idSet = new Set(ids);
    for (const id of idSet) {
      const doc = this.docs.get(id);
      if (doc) {
        // Remove from inverted index
        for (const term of doc.termFreq.keys()) {
          const docSet = this.invertedIndex.get(term);
          if (docSet) {
            docSet.delete(id);
            if (docSet.size === 0) {
              this.invertedIndex.delete(term);
            }
          }
        }
        this.docs.delete(id);
      }
    }
  }

  /** Search the BM25 index for a query. */
  search(query: string, limit?: number): BM25SearchResult[] {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) {
      return [];
    }

    const N = this.docs.size;
    if (N === 0) return [];

    const avgdl = this.averageDocLength();

    // Collect candidate docIds that contain any query term
    const candidateIds = new Set<string>();
    for (const term of queryTerms) {
      const docSet = this.invertedIndex.get(term);
      if (docSet) {
        for (const id of docSet) {
          candidateIds.add(id);
        }
      }
    }

    if (candidateIds.size === 0) {
      return [];
    }

    // Score each candidate
    const scored: BM25SearchResult[] = [];
    for (const docId of candidateIds) {
      const doc = this.docs.get(docId);
      if (!doc) continue;

      let score = 0;
      for (const term of queryTerms) {
        const df = this.invertedIndex.get(term)?.size ?? 0;
        if (df === 0) continue;

        const tf = doc.termFreq.get(term) ?? 0;
        const idf = this.idf(df, N);
        const numerator = tf * (this.config.k1 + 1);
        const denominator =
          tf + this.config.k1 * (1 - this.config.b + this.config.b * (doc.length / avgdl));
        score += idf * (numerator / denominator);
      }

      scored.push({
        id: doc.docId,
        content: doc.content,
        score,
        metadata: doc.metadata,
      });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Get the number of indexed documents. */
  get size(): number {
    return this.docs.size;
  }

  /** Get all indexed document ids. */
  get indexedIds(): string[] {
    return Array.from(this.docs.keys());
  }

  // -- Private helpers --------------------------------------------------

  private averageDocLength(): number {
    if (this.docs.size === 0) return 1;
    let total = 0;
    for (const doc of this.docs.values()) {
      total += doc.length;
    }
    return total / this.docs.size;
  }

  /**
   * Inverse document frequency (BM25 variant):
   * IDF(qi) = log((N - df + 0.5) / (df + 0.5))
   */
  private idf(df: number, N: number): number {
    return Math.log((N - df + 0.5) / (df + 0.5) + 1);
  }
}
