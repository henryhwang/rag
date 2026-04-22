// ============================================================
// Mock Sparse Search Provider for Testing
// Used to test QueryEngine, RAG, and other consumers of
// SparseSearchProvider without depending on BM25 behavior.
// ============================================================

import type { SparseDocument, SparseSearchProvider, SparseSearchResult } from '../../src/types/index';

/**
 * Mock implementation of SparseSearchProvider for testing.
 * 
 * Features:
 * - Simple substring matching by default (not BM25 scoring)
 * - Can configure custom search behavior per-test
 * - Reset helper for beforeEach/afterEach patterns
 * - Type-safe implementation of the interface
 */
export class MockSparseSearchProvider implements SparseSearchProvider {
  private docs: SparseDocument[] = [];
  private customBehavior?: (query: string) => SparseSearchResult[];

  constructor(options?: { customBehavior?: (query: string) => SparseSearchResult[] }) {
    this.customBehavior = options?.customBehavior;
  }

  /**
   * Search for documents matching the query.
   * Default behavior: naive substring matching with simple term frequency scoring.
   */
  search(query: string, limit?: number): SparseSearchResult[] {
    if (this.customBehavior) {
      const results = this.customBehavior(query);
      return limit ? results.slice(0, limit) : results;
    }

    const lowerQuery = query.toLowerCase().trim();
    const terms = lowerQuery.split(/\s+/).filter(t => t.length > 0);

    const scoredDocs = this.docs
      .map((doc) => {
        const contentLower = doc.content.toLowerCase();
        const matches = terms.filter(t => contentLower.includes(t)).length;
        
        if (matches === 0) return null;
        
        return {
          id: doc.id,
          content: doc.content,
          score: matches / terms.length,
          metadata: doc.metadata,
        } as SparseSearchResult;
      })
      .filter((result): result is SparseSearchResult => result !== null)
      .sort((a, b) => b.score - a.score);

    return limit && limit < scoredDocs.length 
      ? scoredDocs.slice(0, limit) 
      : scoredDocs;
  }

  addDocuments(documents: SparseDocument[]): void {
    this.docs.push(...documents);
  }

  removeDocuments(ids: string[]): void {
    const idSet = new Set(ids);
    this.docs = this.docs.filter((doc) => !idSet.has(doc.id));
  }

  get size(): number {
    return this.docs.length;
  }

  // ===================================================================
  // Helper Methods for Test Convenience
  // ===================================================================

  reset(): void {
    this.docs = [];
  }

  preload(documents: SparseDocument[]): void {
    this.docs = [...documents];
  }

  setQueryResponse(queryString: string, results: SparseSearchResult[]): void {
    const originalSearch = (...args: Parameters<SparseSearchProvider['search']>) => 
      this.search.apply(this, args);

    const boundOriginal = originalSearch.bind(this);

    this.search = ((q: string, limit?: number) => {
      if (q === queryString) {
        const response = results;
        return limit && limit < response.length ? response.slice(0, limit) : response;
      }
      return boundOriginal(q, limit);
    }) as SparseSearchProvider['search'];
  }

  getAllDocs(): ReadonlyArray<SparseDocument> {
    return [...this.docs] as ReadonlyArray<SparseDocument>;
  }

  hasDocument(id: string): boolean {
    return this.docs.some(d => d.id === id);
  }
}
