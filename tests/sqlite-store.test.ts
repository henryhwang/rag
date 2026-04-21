import { describe, it, expect, afterEach } from 'bun:test';
import { SQLiteVectorStore } from '../src/storage/sqlite.js';
import { VectorStoreError } from '../src/errors/index.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

describe('SQLiteVectorStore', () => {
  let tmpDir: string;

  afterEach(async () => {
    try {
      if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    } catch { }
  });

  async function makeTmpDir(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-sqlite-test-'));
    return tmpDir;
  }

  describe('construction', () => {
    it('creates in-memory database by default', () => {
      const store = new SQLiteVectorStore();
      expect(store.size).toBe(0);
      store.close();
    });

    it('accepts custom url and tableName', async () => {
      const dir = await makeTmpDir();
      const dbPath = path.join(dir, 'test.db');
      const store = new SQLiteVectorStore({ url: `file:${dbPath}`, tableName: 'vectors' });
      expect(store.size).toBe(0);
      store.close();
    });

    it('rejects table names with SQL injection attempts', () => {
      expect(() => new SQLiteVectorStore({ tableName: 'embeddings; DROP TABLE users;--' }))
        .toThrow('Invalid table name');
    });

    it('rejects table names with special characters', () => {
      expect(() => new SQLiteVectorStore({ tableName: 'test; DELETE FROM' }))
        .toThrow('Invalid table name');
    });

    it('rejects table names starting with numbers', () => {
      expect(() => new SQLiteVectorStore({ tableName: '123table' }))
        .toThrow('Invalid table name');
    });

    it('rejects table names with spaces', () => {
      expect(() => new SQLiteVectorStore({ tableName: 'my table' }))
        .toThrow('Invalid table name');
    });

    it('rejects table names with quotes', () => {
      expect(() => new SQLiteVectorStore({ tableName: "test'table" }))
        .toThrow('Invalid table name');
    });

    it('accepts valid table names', () => {
      expect(() => new SQLiteVectorStore({ tableName: 'embeddings' })).not.toThrow();
      expect(() => new SQLiteVectorStore({ tableName: 'my_table_123' })).not.toThrow();
      expect(() => new SQLiteVectorStore({ tableName: '_test' })).not.toThrow();
      expect(() => new SQLiteVectorStore({ tableName: 'TestTable' })).not.toThrow();
    });
  });

  describe('add', () => {
    it('adds records and reports correct size', async () => {
      const store = new SQLiteVectorStore();
      await store.add(
        [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
        [{ content: 'doc1' }, { content: 'doc2' }],
        ['id1', 'id2'],
      );
      expect(store.size).toBe(2);
      store.close();
    });

    it('auto-generates IDs when not provided', async () => {
      const store = new SQLiteVectorStore();
      await store.add(
        [[0.1, 0.2, 0.3]],
        [{ content: 'doc' }],
      );
      expect(store.size).toBe(1);
      store.close();
    });

    it('throws if embeddings and metadatas length mismatch', async () => {
      const store = new SQLiteVectorStore();
      await expect(
        store.add([[0.1, 0.2]], [{ content: 'a' }, { content: 'b' }]),
      ).rejects.toThrow('must match');
      store.close();
    });

    it('rejects inconsistent embedding dimensions', async () => {
      const store = new SQLiteVectorStore();
      await expect(
        store.add(
          [[0.1, 0.2], [0.1, 0.2, 0.3]],
          [{ content: 'a' }, { content: 'b' }],
        ),
      ).rejects.toThrow('Inconsistent embedding dimensions');
      store.close();
    });

    it('rejects dimension mismatch with existing records', async () => {
      const store = new SQLiteVectorStore();
      await store.add([[0.1, 0.2]], [{ content: 'a' }], ['id1']);
      await expect(
        store.add([[0.1, 0.2, 0.3]], [{ content: 'b' }], ['id2']),
      ).rejects.toThrow('Embedding dimension mismatch');
      store.close();
    });
  });

  describe('search', () => {
    it('returns results sorted by cosine similarity', async () => {
      const store = new SQLiteVectorStore();
      await store.add(
        [[0.9, 0.1, 0.0], [0.1, 0.9, 0.0], [0.5, 0.5, 0.0]],
        [{ content: 'a' }, { content: 'b' }, { content: 'c' }],
        ['id1', 'id2', 'id3'],
      );

      const results = await store.search([0.9, 0.1, 0.0], 3);
      expect(results).toHaveLength(3);
      expect(results[0].id).toBe('id1');
      expect(results[0].score).toBeGreaterThan(results[1].score);
      store.close();
    });

    it('respects limit', async () => {
      const store = new SQLiteVectorStore();
      await store.add(
        [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6], [0.7, 0.8]],
        [{ content: 'a' }, { content: 'b' }, { content: 'c' }, { content: 'd' }],
        ['1', '2', '3', '4'],
      );

      const results = await store.search([0.1, 0.2], 2);
      expect(results).toHaveLength(2);
      store.close();
    });

    it('filters by metadata', async () => {
      const store = new SQLiteVectorStore();
      await store.add(
        [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
        [
          { content: 'a', category: 'tech' },
          { content: 'b', category: 'science' },
          { content: 'c', category: 'tech' },
        ],
        ['1', '2', '3'],
      );

      const results = await store.search([0.1, 0.2], 10, { category: 'tech' });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.metadata.category === 'tech')).toBe(true);
      store.close();
    });

    it('returns 0 similarity for orthogonal vectors', async () => {
      const store = new SQLiteVectorStore();
      await store.add(
        [[1, 0], [0, 1]],
        [{ content: 'a' }, { content: 'b' }],
        ['1', '2'],
      );

      const results = await store.search([1, 0], 2);
      expect(results[0].id).toBe('1');
      expect(results[1].score).toBe(0);
      store.close();
    });
  });

  describe('delete', () => {
    it('removes records by ID', async () => {
      const store = new SQLiteVectorStore();
      await store.add([[0.1, 0.2]], [{ content: 'a' }], ['id1']);
      expect(store.size).toBe(1);
      await store.delete(['id1']);
      expect(store.size).toBe(0);
      store.close();
    });

    it('is a no-op for non-existent IDs', async () => {
      const store = new SQLiteVectorStore();
      await store.add([[0.1, 0.2]], [{ content: 'a' }], ['id1']);
      await store.delete(['nonexistent']);
      expect(store.size).toBe(1);
      store.close();
    });
  });

  describe('persistence', () => {
    it('save and load records from disk', async () => {
      const dir = await makeTmpDir();
      const dbPath = path.join(dir, 'test.db');
      const store = new SQLiteVectorStore({ url: `file:${dbPath}` });
      await store.add(
        [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
        [{ content: 'doc1', foo: 'bar' }, { content: 'doc2' }],
        ['id1', 'id2'],
      );
      store.close();

      // Create new store from same db file
      const store2 = new SQLiteVectorStore({ url: `file:${dbPath}` });
      await store2.init();
      expect(store2.size).toBe(2);
      const results = await store2.search([0.1, 0.2, 0.3], 2);
      expect(results[0].content).toBe('doc1');
      store2.close();
    });

    it('save exports JSON file', async () => {
      const store = new SQLiteVectorStore();
      await store.add([[0.1, 0.2]], [{ content: 'hello' }], ['id1']);

      const dir = await makeTmpDir();
      const jsonPath = path.join(dir, 'export.json');
      await store.save(jsonPath);
      store.close();

      const data = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
      // New format: { _meta: {...}, records: [...] }
      expect(data._meta).toBeDefined();
      expect(data.records).toHaveLength(1);
      expect(data.records[0].id).toBe('id1');
    });

    it('load from JSON file', async () => {
      const dir = await makeTmpDir();
      const dbPath = path.join(dir, 'test.db');
      const jsonPath = path.join(dir, 'export.json');
      await fs.writeFile(jsonPath, JSON.stringify([
        { id: 'id1', embedding: [0.1, 0.2], metadata: { content: 'hello' } },
      ]));

      const store = new SQLiteVectorStore({ url: `file:${dbPath}` });
      await store.load(jsonPath);
      expect(store.size).toBe(1);
      store.close();
    });

    it('load throws on corrupt JSON', async () => {
      const dir = await makeTmpDir();
      const jsonPath = path.join(dir, 'bad.json');
      await fs.writeFile(jsonPath, 'not json');

      const store = new SQLiteVectorStore();
      await expect(store.load(jsonPath)).rejects.toThrow(VectorStoreError);
      store.close();
    });
  });

  describe('close', () => {
    it('closes client and resets state', async () => {
      const store = new SQLiteVectorStore();
      await store.add([[0.1, 0.2]], [{ content: 'a' }], ['1']);
      expect(store.size).toBe(1);

      store.close();
      expect(store.size).toBe(0);

      // Can reopen
      const store2 = new SQLiteVectorStore();
      await store2.add([[0.1, 0.2]], [{ content: 'a' }], ['1']);
      expect(store2.size).toBe(1);
      store2.close();
    });
  });

  describe('transactional behavior', () => {
    it('add operation maintains data consistency on success', async () => {
      const store = new SQLiteVectorStore();

      // Add multiple records
      await store.add(
        [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
        [{ content: 'a' }, { content: 'b' }, { content: 'c' }],
        ['id1', 'id2', 'id3'],
      );

      expect(store.size).toBe(3);

      // Verify all records are searchable
      const results = await store.search([0.1, 0.2], 10);
      expect(results).toHaveLength(3);

      store.close();
    });

    it('delete operation maintains data consistency', async () => {
      const store = new SQLiteVectorStore();
      await store.add(
        [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
        [{ content: 'a' }, { content: 'b' }, { content: 'c' }],
        ['id1', 'id2', 'id3'],
      );

      // Delete multiple records
      await store.delete(['id1', 'id2']);

      expect(store.size).toBe(1);

      const results = await store.search([0.1, 0.2], 10);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('id3');

      store.close();
    });

    it('load operation replaces all records atomically', async () => {
      const store = new SQLiteVectorStore();

      // Add initial records
      await store.add(
        [[0.1, 0.2]],
        [{ content: 'old' }],
        ['old1'],
      );
      expect(store.size).toBe(1);

      // Create temp JSON file with new data
      const dir = await makeTmpDir();
      const jsonPath = path.join(dir, 'export.json');
      await fs.writeFile(jsonPath, JSON.stringify([
        { id: 'new1', embedding: [0.9, 0.1], metadata: { content: 'new1' } },
        { id: 'new2', embedding: [0.8, 0.2], metadata: { content: 'new2' } },
      ]));

      // Load should replace all records
      await store.load(jsonPath);

      expect(store.size).toBe(2);

      const results = await store.search([0.9, 0.1], 10);
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('new1');

      store.close();
    });
  });
});
