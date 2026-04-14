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

    // L5: Validate consistent dimensions across all new embeddings
    let newDim: number | undefined;
    for (const emb of embeddings) {
      if (newDim === undefined) {
        newDim = emb.length;
      } else if (emb.length !== newDim) {
        throw new VectorStoreError(
          `Inconsistent embedding dimensions: ${emb.length} vs expected ${newDim}`,
        );
      }
    }

    // Validate against existing records
    if (newDim !== undefined && this.records.length > 0) {
      const existingDim = this.records[0].embedding.length;
      if (newDim !== existingDim) {
        throw new VectorStoreError(
          `Embedding dimension mismatch: new ${newDim} vs existing ${existingDim}`,
        );
      }
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
    const parsed: unknown = JSON.parse(data);

    if (!Array.isArray(parsed)) {
      throw new VectorStoreError('Corrupt store: expected an array');
    }

    // Validate each record and detect the first record's embedding dimension
    let expectedDim: number | undefined;
    const records: StoredRecord[] = [];

    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i] as Record<string, unknown>;
      if (!item || typeof item !== 'object' || !('id' in item) || !('embedding' in item)) {
        throw new VectorStoreError(
          `Corrupt store: record ${i} is missing required fields`,
        );
      }
      const embedding = item.embedding as number[];
      if (!Array.isArray(embedding)) {
        throw new VectorStoreError(
          `Corrupt store: record ${i} has non-array embedding`,
        );
      }
      if (expectedDim === undefined) {
        expectedDim = embedding.length;
      } else if (embedding.length !== expectedDim) {
        throw new VectorStoreError(
          `Corrupt store: record ${i} has dimension ${embedding.length}, expected ${expectedDim}`,
        );
      }
      records.push({
        id: item.id as string,
        embedding,
        metadata: (item.metadata as Metadata) ?? {},
      });
    }

    this.records = records;
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
