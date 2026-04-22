// ============================================================
// Shared utilities for vector stores
// ============================================================

import type { Metadata, Filter, VectorStoreSchemaMetadata } from '../types/index.ts';
import { VectorStoreError } from '../errors/index.ts';

export interface StoredRecord {
  id: string;
  embedding: number[];
  metadata: Metadata;
}

export interface SerializableStore {
  _meta: Omit<VectorStoreSchemaMetadata, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
  };
  records: StoredRecord[];
}

/**
 * Match record metadata against a filter object.
 * All filter key-value pairs must match for the result to be true.
 */
export function matchesFilter(metadata: Metadata, filter: Filter): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false;
  }
  return true;
}

/**
 * Compute cosine similarity between two vectors.
 * Returns 0 if either vector has zero norm.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new VectorStoreError(
      `Embedding dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
