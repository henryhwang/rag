// ============================================================
// Inline Mock Templates
// Copy-paste these into your test files for quick sparse search mocking
// ============================================================

import type { SparseDocument, SparseSearchProvider, SparseSearchResult } from '../../src/types/index';

/**
 * Quick inline mock factory function.
 * Use this when you need a simple mock without importing MockSparseSearchProvider.
 * 
 * @example
 *   const mock = createInlineMock();
 *   mock.search('query', 5);
 */
export function createInlineMock(): SparseSearchProvider {
  const docs: SparseDocument[] = [];
  
  return {
    search(query: string, limit?: number): SparseSearchResult[] {
      // Simple substring match
      const lowerQuery = query.toLowerCase().trim();
      const results = docs.filter(d => d.content.toLowerCase().includes(lowerQuery));
      return (limit ? results.slice(0, limit) : results).map(d => ({ ...d, score: 1.0 } as SparseSearchResult));
    },
    addDocuments(documents: SparseDocument[]): void {
      docs.push(...documents);
    },
    removeDocuments(ids: string[]): void {
      const idSet = new Set(ids);
      // eslint-disable-next-line no-param-reassign
      docs.splice(docs.findIndex(d => idSet.has(d.id)), 1);
    },
    get size(): number {
      return docs.length;
    },
  };
}

/**
 * Create a mock with custom search behavior.
 * Useful for testing edge cases where you need specific results.
 * 
 * @example
 *   const mock = createInlineMockWithBehavior(q => {
 *     if (q === 'error') return [{id:'1', content:'error', score:1, metadata:{}}];
 *     return [];
 *   });
 */
export function createInlineMockWithBehavior(
  customSearch: (query: string, limit?: number) => SparseSearchResult[],
): SparseSearchProvider {
  const docs: SparseDocument[] = [];
  
  return {
    search(query: string, limit?: number): SparseSearchResult[] {
      return customSearch(query, limit);
    },
    addDocuments(documents: SparseDocument[]): void {
      docs.push(...documents);
    },
    removeDocuments(ids: string[]): void {
      const idSet = new Set(ids);
      // eslint-disable-next-line no-param-reassign
      docs.splice(docs.findIndex(d => idSet.has(d.id)), 1);
    },
    get size(): number {
      return docs.length;
    },
  };
}

/**
 * Example usage patterns for copy-pasting into tests:
 * 
 * 1. Minimal inline pattern (use directly in test):
 * ```typescript
 * const mockSparse = {
 *   docs: [] as Array<{id:string; content:string; metadata:any;}>,
 *   search(_q: string, limit?: number) {
 *     return this.docs.slice(0, limit ?? 10).map(d => ({...d, score: 1.0}));
 *   },
 *   addDocuments(d: any[]) { this.docs.push(...d); },
 *   removeDocuments(ids: string[]) {
 *     const set = new Set(ids);
 *     this.docs = this.docs.filter(d => !set.has(d.id));
 *   },
 *   get size() { return this.docs.length; },
 * };
 * ```
 * 
 * 2. Stubbed response pattern:
 * ```typescript
 * const mockSparse = {
 *   responses: new Map<string, any[]>(),
 *   search(query: string, limit?: number) {
 *     return (this.responses.get(query) || []).slice(0, limit ?? 10);
 *   },
 *   addDocuments(_docs: any[]) {},
 *   removeDocuments(_ids: string[]) {},
 *   get size() { return Array.from(this.responses.values()).reduce((a, v) => a + v.length, 0); },
 * };
 * mockSparse.responses.set('my query', [/* pre-fab results]);
 * ```
 */
