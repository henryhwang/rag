// ============================================================
// SQLite vector store — persisted embeddings using @libsql/client.
// Works in both Bun and Node.js — no native compilation needed.
// Stores embeddings as JSON and computes cosine similarity in TS.
// ============================================================

import { createClient, type Client } from '@libsql/client';
import { VectorStore, Metadata, SearchResult, Filter } from '../types/index.ts';
import { VectorStoreError } from '../errors/index.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface StoredRecord {
  id: string;
  embedding: number[];
  metadata: Metadata;
}

export interface SQLiteVectorStoreConfig {
  /**
   * Database URL. Use 'file:my.db' for disk persistence,
   * or 'file::memory:' for in-memory (ephemeral). Default: 'file::memory:'.
   */
  url?: string;
  /** Table name. Default: 'embeddings'. */
  tableName?: string;
}

const DEFAULT_URL = 'file::memory:';
const DEFAULT_TABLE_NAME = 'embeddings';

export class SQLiteVectorStore implements VectorStore {
  private client: Client | null = null;
  private readonly url: string;
  private readonly tableName: string;
  private records: StoredRecord[] = [];
  private initialized = false;

  constructor(config?: SQLiteVectorStoreConfig) {
    this.url = config?.url ?? DEFAULT_URL;
    this.tableName = config?.tableName ?? DEFAULT_TABLE_NAME;
  }

  /** Initialize the store. Call this explicitly, or it's called lazily by add/search/delete. */
  async init(): Promise<void> {
    await this.ensureInitialized();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    this.client = createClient({ url: this.url });
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        embedding TEXT NOT NULL,
        metadata TEXT NOT NULL
      )
    `);

    // Load existing records into memory for search
    await this.loadFromDB();
    this.initialized = true;
  }

  async add(
    embeddings: number[][],
    metadatas: Metadata[],
    ids?: string[],
  ): Promise<void> {
    await this.ensureInitialized();

    if (embeddings.length !== metadatas.length) {
      throw new VectorStoreError(
        `embeddings.length (${embeddings.length}) must match metadatas.length (${metadatas.length})`,
      );
    }

    // Validate consistent dimensions
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

    const client = this.client!;
    for (let i = 0; i < embeddings.length; i++) {
      const id = ids?.[i] ?? crypto.randomUUID();
      const record: StoredRecord = {
        id,
        embedding: embeddings[i],
        metadata: metadatas[i],
      };
      this.records.push(record);
      await client.execute({
        sql: `INSERT OR REPLACE INTO ${this.tableName} (id, embedding, metadata) VALUES (?, ?, ?)`,
        args: [id, JSON.stringify(embeddings[i]), JSON.stringify(metadatas[i])],
      });
    }
  }

  async search(
    query: number[],
    limit: number,
    filter?: Filter,
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();

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
    await this.ensureInitialized();

    const idSet = new Set(ids);
    this.records = this.records.filter((r) => !idSet.has(r.id));

    const client = this.client!;
    for (const id of ids) {
      await client.execute({
        sql: `DELETE FROM ${this.tableName} WHERE id = ?`,
        args: [id],
      });
    }
  }

  async save(filePath: string): Promise<void> {
    // Export records to JSON for interoperability with other stores
    const data = JSON.stringify(this.records, null, 2);
    await fs.writeFile(filePath, data, 'utf-8');
  }

  async load(filePath: string): Promise<void> {
    let data: string;
    try {
      data = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      throw new VectorStoreError(`Failed to read file: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      throw new VectorStoreError(`Corrupt store: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }

    if (!Array.isArray(parsed)) {
      throw new VectorStoreError('Corrupt store: expected an array');
    }

    let expectedDIM: number | undefined;
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
      if (expectedDIM === undefined) {
        expectedDIM = embedding.length;
      } else if (embedding.length !== expectedDIM) {
        throw new VectorStoreError(
          `Corrupt store: record ${i} has dimension ${embedding.length}, expected ${expectedDIM}`,
        );
      }
      records.push({
        id: item.id as string,
        embedding,
        metadata: (item.metadata as Metadata) ?? {},
      });
    }

    this.records = records;

    // If client is initialized, sync the loaded records to DB
    if (this.client) {
      await this.client.execute({ sql: `DELETE FROM ${this.tableName}`, args: [] });
      for (const rec of records) {
        await this.client.execute({
          sql: `INSERT OR REPLACE INTO ${this.tableName} (id, embedding, metadata) VALUES (?, ?, ?)`,
          args: [rec.id, JSON.stringify(rec.embedding), JSON.stringify(rec.metadata)],
        });
      }
    }
  }

  /** Close the client connection. */
  close(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
      this.records = [];
      this.initialized = false;
    }
  }

  /** Get the number of stored records (from in-memory cache). */
  get size(): number {
    return this.records.length;
  }

  // -- Private helpers --------------------------------------------------

  private async loadFromDB(): Promise<void> {
    const result = await this.client!.execute(`SELECT id, embedding, metadata FROM ${this.tableName}`);
    this.records = result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      embedding: JSON.parse(row.embedding as string) as number[],
      metadata: JSON.parse(row.metadata as string) as Metadata,
    }));
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
