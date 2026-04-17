// ============================================================
// SQLite vector store — persisted embeddings using @libsql/client.
// Works in both Bun and Node.js — no native compilation needed.
// Stores embeddings as JSON and computes cosine similarity in TS.
// ============================================================

import { createClient, type Client } from '@libsql/client';
import { VectorStore, Metadata, SearchResult, Filter, VectorStoreSchemaMetadata } from '../types/index.ts';
import { VectorStoreError } from '../errors/index.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface StoredRecord {
  id: string;
  embedding: number[];
  metadata: Metadata;
}

/** Serializable format with embedded schema metadata */
interface SerializableStore {
  _meta: Omit<VectorStoreSchemaMetadata, 'createdAt' | 'updatedAt'> & {
    createdAt: string;
    updatedAt: string;
  };
  records: StoredRecord[];
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
  private _metadata: VectorStoreSchemaMetadata | null = null;

  constructor(config?: SQLiteVectorStoreConfig) {
    this.url = config?.url ?? DEFAULT_URL;
    this.tableName = config?.tableName ?? DEFAULT_TABLE_NAME;
  }

  /** Schema metadata - read-only access */
  get metadata(): VectorStoreSchemaMetadata | null {
    return this._metadata;
  }

  /** Initialize the store. Call this explicitly, or it's called lazily by add/search/delete. */
  async init(): Promise<void> {
    await this.ensureInitialized();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    this.client = createClient({ url: this.url });

    // Create schema metadata table
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS _schema (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Create data table
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        embedding TEXT NOT NULL,
        metadata TEXT NOT NULL
      )
    `);

    // Load or initialize schema metadata
    await this.loadSchemaMetadata();

    // Load existing records into memory for search
    await this.loadFromDB();
    this.initialized = true;
  }

  /** Load schema metadata from _schema table, or create default if not exists */
  private async loadSchemaMetadata(): Promise<void> {
    const client = this.client!;
    
    const result = await client.execute('SELECT COUNT(*) as cnt FROM _schema');
    const count = result.rows[0]?.cnt as unknown as number;

    if (count === 0) {
      // Initialize empty schema (dimension will be set on first insert)
      const now = new Date().toISOString();
      await client.execute(
        `INSERT INTO _schema (key, value) VALUES (?, ?), (?, ?), (?, ?), (?, ?), (?, ?)`,
        [
          'version', '1',
          'embedding_dimension', '0',
          'embedding_model', '"auto-detected"',
          'created_at', now,
          'updated_at', now,
        ],
      );
    }

    // Read schema values
    const rows = await client.execute('SELECT key, value FROM _schema');
    const map: Record<string, string> = {};
    for (const row of rows.rows) {
      map[row.key as string] = row.value as string;
    }

    this._metadata = {
      version: parseInt(map.version ?? '0'),
      embeddingDimension: parseInt(map.embedding_dimension ?? '0'),
      embeddingModel: JSON.parse(map.embedding_model ?? '"unknown"'),
      createdAt: new Date(map.created_at ?? Date.now()),
      updatedAt: new Date(map.updated_at ?? Date.now()),
    };
  }

  async add(
    embeddings: number[][],
    metadatas: Metadata[],
    ids?: string[],
    options?: { replaceDuplicates?: boolean }, // L7 fix: control duplicate handling
  ): Promise<void> {
    await this.ensureInitialized();

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

    // Initialize or validate dimension against stored schema
    if (!this._metadata || this._metadata.embeddingDimension === 0) {
      // First insert - lock in dimension via schema table
      const client = this.client!;
      await client.execute(
        `UPDATE _schema SET value = ? WHERE key = 'embedding_dimension'`,
        [String(dim || 0)],
      );
      await client.execute(
        `UPDATE _schema SET value = ? WHERE key = 'updated_at'`,
        [new Date().toISOString()],
      );
      // Refresh cached metadata
      this._metadata!.embeddingDimension = dim || 0;
      this._metadata!.updatedAt = new Date();
    } else if (dim !== this._metadata.embeddingDimension) {
      // Subsequent inserts - validate match
      throw new VectorStoreError(
        `Embedding dimension mismatch: got ${dim}, expected ${this._metadata.embeddingDimension}\n` +
        `Hint: Use the same embedding model/configuration as when you indexed documents.`,
      );
    }

    const client = this.client!;
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
        continue; // Skip duplicate
      }
      
      // Check if ID already exists in store
      const existingRecord = this.records.find(r => r.id === id);
      let wasReplaced = false;
      if (existingRecord) {
        if (options?.replaceDuplicates) {
          // Replace existing record in memory and database
          const index = this.records.indexOf(existingRecord);
          const record: StoredRecord = {
            id,
            embedding: embeddings[i],
            metadata: metadatas[i],
          };
          this.records[index] = record;
          await client.execute({
            sql: `UPDATE ${this.tableName} SET embedding = ?, metadata = ? WHERE id = ?`,
            args: [JSON.stringify(embeddings[i]), JSON.stringify(metadatas[i]), id],
          });
          wasReplaced = true;
        } else {
          // Skip to prevent duplicates (L7 fix)
          continue;
        }
      }
      
      idSet.add(id);
      
      // Only insert new record if not replaced
      if (!wasReplaced) {
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
    await this.ensureInitialized();

    // Ensure metadata exists
    if (!this._metadata) {
      this._metadata = {
        version: 1,
        embeddingDimension: this.records[0]?.embedding?.length ?? 0,
        embeddingModel: 'empty-store',
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

      console.warn(
        'Loaded legacy format store (v%d). Call save() to upgrade with schema metadata.',
        meta.version,
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

    // If client is initialized, sync the loaded records to DB and schema table
    if (this.client && this.initialized) {
      await this.client.execute({ sql: `DELETE FROM ${this.tableName}`, args: [] });
      
      // Update schema table
      await this.client.execute(
        `UPDATE _schema SET value = ? WHERE key = 'version'`,
        [String(meta.version)],
      );
      await this.client.execute(
        `UPDATE _schema SET value = ? WHERE key = 'embedding_dimension'`,
        [String(meta.embeddingDimension)],
      );
      await this.client.execute(
        `UPDATE _schema SET value = ? WHERE key = 'embedding_model'`,
        [JSON.stringify(meta.embeddingModel)],
      );
      await this.client.execute(
        `UPDATE _schema SET value = ? WHERE key = 'updated_at'`,
        [meta.updatedAt.toISOString()],
      );

      // Insert all records
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
