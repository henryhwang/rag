import { describe, test, expect, afterEach } from 'bun:test';
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
    } catch {}
  });

  async function makeTmpDir(): Promise<string> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-sqlite-test-'));
    return tmpDir;
  }

  describe('construction', () => {
    test('creates in-memory database by default', () => {
      const store = new SQLiteVectorStore();
      expect(store.size).toBe(0);
      store.close();
    });

    test('accepts custom url and tableName', async () => {
      const dir = await makeTmpDir();
      const dbPath = path.join(dir, 'test.db');
      const store = new SQLiteVectorStore({ url: `file:${dbPath}`, tableName: 'vectors' });
      expect(store.size).toBe(0);
      store.close();
    });
  });

  describe('add', () => {
    test('adds records and reports correct size', async () => {
      const store = new SQLiteVectorStore();
      await store.add(
        [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
        [{ content: 'doc1' }, { content: 'doc2' }],
        ['id1', 'id2'],
      );
      expect(store.size).toBe(2);
      store.close();
    });

    test('auto-generates IDs when not provided', async () => {
      const store = new SQLiteVectorStore();
      await store.add(
        [[0.1, 0.2, 0.3]],
        [{ content: 'doc' }],
      );
      expect(store.size).toBe(1);
      store.close();
    });

    test('throws if embeddings and metadatas length mismatch', async () => {
      const store = new SQLiteVectorStore();
      await expect(
        store.add([[0.1, 0.2]], [{ content: 'a' }, { content: 'b' }]),
      ).rejects.toThrow('must match');
      store.close();
    });

    test('rejects inconsistent embedding dimensions', async () => {
      const store = new SQLiteVectorStore();
      await expect(
        store.add(
          [[0.1, 0.2], [0.1, 0.2, 0.3]],
          [{ content: 'a' }, { content: 'b' }],
        ),
      ).rejects.toThrow('Inconsistent embedding dimensions');
      store.close();
    });

    test('rejects dimension mismatch with existing records', async () => {
      const store = new SQLiteVectorStore();
      await store.add([[0.1, 0.2]], [{ content: 'a' }], ['id1']);
      await expect(
        store.add([[0.1, 0.2, 0.3]], [{ content: 'b' }], ['id2']),
      ).rejects.toThrow('Embedding dimension mismatch');
      store.close();
    });
  });

  describe('search', () => {
    test('returns results sorted by cosine similarity', async () => {
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

    test('respects limit', async () => {
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

    test('filters by metadata', async () => {
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

    test('returns 0 similarity for orthogonal vectors', async () => {
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
    test('removes records by ID', async () => {
      const store = new SQLiteVectorStore();
      await store.add([[0.1, 0.2]], [{ content: 'a' }], ['id1']);
      expect(store.size).toBe(1);
      await store.delete(['id1']);
      expect(store.size).toBe(0);
      store.close();
    });

    test('is a no-op for non-existent IDs', async () => {
      const store = new SQLiteVectorStore();
      await store.add([[0.1, 0.2]], [{ content: 'a' }], ['id1']);
      await store.delete(['nonexistent']);
      expect(store.size).toBe(1);
      store.close();
    });
  });

  describe('persistence', () => {
    test('save and load records from disk', async () => {
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

    test('save exports JSON file', async () => {
      const store = new SQLiteVectorStore();
      await store.add([[0.1, 0.2]], [{ content: 'hello' }], ['id1']);

      const dir = await makeTmpDir();
      const jsonPath = path.join(dir, 'export.json');
      await store.save(jsonPath);
      store.close();

      const data = JSON.parse(await fs.readFile(jsonPath, 'utf-8'));
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('id1');
    });

    test('load from JSON file', async () => {
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

    test('load throws on corrupt JSON', async () => {
      const dir = await makeTmpDir();
      const jsonPath = path.join(dir, 'bad.json');
      await fs.writeFile(jsonPath, 'not json');

      const store = new SQLiteVectorStore();
      await expect(store.load(jsonPath)).rejects.toThrow(VectorStoreError);
      store.close();
    });
  });

  describe('close', () => {
    test('closes client and resets state', async () => {
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
});
