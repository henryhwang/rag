// ============================================================
// In-memory vector store — cosine similarity
// No dependencies, suitable for prototyping and testing.
// ============================================================

import { VectorStore, Metadata, SearchResult, Filter } from '../types/index.ts';
import { VectorStoreError } from '../errors/index.ts';
import * as fs from 'node:fs/promises';

interface StoredRecord {
  id: string;
  embedding: number[];
  metadata: Metadata;
}

export class InMemoryVectorStore implements VectorStore {
  private records: StoredRecord[] = [];

  async add(
    embeddings: number[][],
    metadatas: Metadata[],
    ids?: string[],
  ): Promise<void> {
    if (embeddings.length !== metadatas.length) {
      throw new VectorStoreError(
        `embeddings.length (${embeddings.length}) must match metadatas.length (${metadatas.length})`,
      );
    }

    for (let i = 0; i < embeddings.length; i++) {
      const id = ids?.[i] ?? crypto.randomUUID();
      this.records.push({
        id,
        embedding: embeddings[i],
        metadata: metadatas[i],
      });
    }
  }

  async search(
    query: number[],
    limit: number,
    filter?: Filter,
  ): Promise<SearchResult[]> {
    let candidates = this.records;

    // Apply metadata filter if provided
    if (filter) {
      candidates = candidates.filter((r) => matchesFilter(r.metadata, filter));
    }

    // Score by cosine similarity
    const scored = candidates
      .map((r) => ({
        id: r.id,
        content: (r.metadata.content as string) ?? '',
        score: cosineSimilarity(query, r.embedding),
        metadata: r.metadata,
        documentId: (r.metadata.documentId as string) ?? undefined,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  async delete(ids: string[]): Promise<void> {
    const idSet = new Set(ids);
    this.records = this.records.filter((r) => !idSet.has(r.id));
  }

  async save(filePath: string): Promise<void> {
    const data = JSON.stringify(this.records, null, 2);
    await fs.writeFile(filePath, data, 'utf-8');
  }

  async load(filePath: string): Promise<void> {
    const data = await fs.readFile(filePath, 'utf-8');
    this.records = JSON.parse(data) as StoredRecord[];
  }

  /** For introspection / testing. */
  get size(): number {
    return this.records.length;
  }
}

function matchesFilter(metadata: Metadata, filter: Filter): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false;
  }
  return true;
}

function cosineSimilarity(a: number[], b: number[]): number {
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
