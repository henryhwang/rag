// ============================================================
// In-memory vector store — cosine similarity
// No dependencies, suitable for prototyping and testing.
// ============================================================

import type { VectorStore, Metadata, SearchResult, Filter, VectorStoreSchemaMetadata, Logger } from '../types/index.ts';
import { VectorStoreError } from '../errors/index.ts';
import { NoopLogger } from '../logger/index.ts';
import * as fs from 'node:fs/promises';
import { matchesFilter, cosineSimilarity, type StoredRecord, type SerializableStore } from './shared.ts';

/** Configuration for InMemoryVectorStore */
export interface InMemoryVectorStoreConfig {
  /** Optional logger for warnings and diagnostics */
  logger?: Logger;
}

export class InMemoryVectorStore implements VectorStore {
  private records: StoredRecord[] = [];
  private _metadata: VectorStoreSchemaMetadata | null = null;
  private readonly logger: Logger;

  constructor(config?: InMemoryVectorStoreConfig) {
    this.logger = config?.logger ?? new NoopLogger();
  }

  /** Schema metadata - read-only access */
  get metadata(): VectorStoreSchemaMetadata | null {
    return this._metadata;
  }

  async add(
    embeddings: number[][],
    metadatas: Metadata[],
    ids?: string[],
    options?: { replaceDuplicates?: boolean }, // New option
  ): Promise<void> {
    if (embeddings.length !== metadatas.length) {
      throw new VectorStoreError(
        `embeddings.length (${embeddings.length}) must match metadatas.length (${metadatas.length})`,
      );
    }

    const dim = embeddings[0]?.length;

    // Validate all new embeddings have consistent dimensions
    for (const emb of embeddings) {
      if (emb.length !== dim) {
        throw new VectorStoreError(
          `Inconsistent embedding dimensions: ${emb.length} vs expected ${dim}`,
        );
      }
    }

    // Initialize or validate dimension against existing store
    if (!this._metadata) {
      // First insert - lock in dimension
      this._metadata = {
        version: 1,
        embeddingDimension: dim || 0,
        embeddingModel: 'auto-detected',
        encodingFormat: 'float',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } else if (dim !== this._metadata.embeddingDimension) {
      // Subsequent inserts - validate match
      throw new VectorStoreError(
        `Embedding dimension mismatch: got ${dim}, expected ${this._metadata.embeddingDimension}\n` +
        `Hint: Use the same embedding model/configuration as when you indexed documents.`,
      );
    }

    // Store records with duplicate detection
    const idSet = new Set<string>();
    for (let i = 0; i < embeddings.length; i++) {
      const id = ids?.[i] ?? crypto.randomUUID();

      // Check for duplicate ID in batch
      if (idSet.has(id)) {
        if (options?.replaceDuplicates) {
          throw new VectorStoreError(
            `Cannot use replaceDuplicates=true with internally generated duplicate IDs at position ${i}`,
          );
        }
        // Skip silently to prevent accidental duplicates
        continue;
      }

      // Check if ID already exists in store
      const existingIndex = this.records.findIndex(r => r.id === id);
      let wasReplaced = false;
      if (existingIndex >= 0) {
        if (options?.replaceDuplicates) {
          // Replace existing record
          this.records[existingIndex] = {
            id,
            embedding: embeddings[i],
            metadata: metadatas[i],
          };
          wasReplaced = true;
        } else {
          // Skip to prevent duplicates (L7 fix)
          continue;
        }
      }

      idSet.add(id);

      // Only push if not replaced
      if (!wasReplaced) {
        this.records.push({
          id,
          embedding: embeddings[i],
          metadata: metadatas[i],
        });
      }
    }

    // Update timestamp
    if (this._metadata) {
      this._metadata.updatedAt = new Date();
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
    if (!this._metadata) {
      // Create minimal metadata if saving before any adds
      this._metadata = {
        version: 1,
        embeddingDimension: this.records[0]?.embedding?.length ?? 0,
        embeddingModel: 'empty-store',
        encodingFormat: 'float',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    const serializable: SerializableStore = {
      _meta: {
        ...this._metadata,
        createdAt: this._metadata.createdAt.toISOString(),
        updatedAt: this._metadata.updatedAt.toISOString(),
      },
      records: this.records,
    };

    const data = JSON.stringify(serializable, null, 2);
    await fs.writeFile(filePath, data, 'utf-8');
  }

  async load(filePath: string): Promise<void> {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(data);

    // Support both new format (with _meta) and legacy format (array only)
    let meta: VectorStoreSchemaMetadata;
    let records: StoredRecord[];

    if (parsed && typeof parsed === 'object' && '_meta' in parsed) {
      // New format with schema metadata
      const typed = parsed as SerializableStore;

      if (!typed._meta || !Array.isArray(typed.records)) {
        throw new VectorStoreError('Corrupt store: invalid schema structure');
      }

      meta = {
        version: typed._meta.version,
        embeddingDimension: typed._meta.embeddingDimension,
        embeddingModel: typed._meta.embeddingModel,
        encodingFormat: typed._meta.encodingFormat,
        createdAt: new Date(typed._meta.createdAt),
        updatedAt: new Date(typed._meta.updatedAt),
      };
      records = typed.records;
    } else {
      // Legacy format - array only
      if (!Array.isArray(parsed)) {
        throw new VectorStoreError('Corrupt store: expected array or wrapped object');
      }

      if (parsed.length === 0) {
        throw new VectorStoreError('Cannot determine dimension from empty store');
      }

      const firstDim = Array.isArray(parsed[0]?.embedding)
        ? (parsed[0].embedding as number[]).length
        : 0;

      meta = {
        version: 0, // Legacy version marker
        embeddingDimension: firstDim,
        embeddingModel: 'legacy-format',
        encodingFormat: 'float',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      records = parsed.map((item, i) => {
        const obj = item as Record<string, unknown>;
        if (!obj || typeof obj !== 'object' || !('id' in obj) || !('embedding' in obj)) {
          throw new VectorStoreError(
            `Corrupt store: record ${i} is missing required fields`,
          );
        }
        const embedding = obj.embedding as number[];
        if (!Array.isArray(embedding)) {
          throw new VectorStoreError(
            `Corrupt store: record ${i} has non-array embedding`,
          );
        }
        return {
          id: obj.id as string,
          embedding,
          metadata: (obj.metadata as Metadata) ?? {},
        };
      });

      this.logger.warn(
        `Loaded legacy format store (v${meta.version}). Call save() to upgrade with schema metadata.`,
      );
    }

    // Validate all records match schema
    for (let i = 0; i < records.length; i++) {
      const embLen = records[i].embedding.length;
      if (embLen !== meta.embeddingDimension) {
        throw new VectorStoreError(
          `Record ${i} has wrong dimension: ${embLen} (expected ${meta.embeddingDimension}).\n` +
          'This may indicate file corruption or manual editing.'
        );
      }
    }

    this._metadata = meta;
    this.records = records;
  }

  /** For introspection / testing. */
  get size(): number {
    return this.records.length;
  }
}
