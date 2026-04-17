import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { InMemoryVectorStore } from "../src/storage/index.ts";
import { VectorStoreError } from "../src/errors/index.ts";

describe("InMemoryVectorStore", () => {
  it("should add records and report correct size", async () => {
    const store = new InMemoryVectorStore();
    expect(store.size).toBe(0);

    await store.add(
      [
        [1, 0, 0],
        [0, 1, 0],
      ],
      [{ content: "a" }, { content: "b" }]
    );

    expect(store.size).toBe(2);
  });

  it("should auto-generate IDs when not provided", async () => {
    const store = new InMemoryVectorStore();
    await store.add([[1, 0]], [{ content: "x" }]);
    expect(store.size).toBe(1);
  });

  it("should use provided IDs", async () => {
    const store = new InMemoryVectorStore();
    await store.add([[1, 0]], [{ content: "x" }], ["my-id"]);
    const results = await store.search([1, 0], 5);
    expect(results[0].id).toBe("my-id");
  });

  it("should throw if embeddings and metadatas length mismatch", async () => {
    const store = new InMemoryVectorStore();
    await expect(
      store.add([[1, 0]], [{}, {}])
    ).rejects.toThrow(VectorStoreError);
  });
});

describe("InMemoryVectorStore — search", () => {
  it("should return results sorted by cosine similarity", async () => {
    const store = new InMemoryVectorStore();
    // Normalized vectors for predictable similarity
    await store.add(
      [
        [1, 0, 0],
        [0, 1, 0],
        [0.707, 0.707, 0],
      ],
      [
        { content: "aligned" },
        { content: "orthogonal" },
        { content: "diagonal" },
      ]
    );

    const results = await store.search([1, 0, 0], 10);
    expect(results.length).toBe(3);
    // [1,0,0] vs [1,0,0] = 1.0 (highest)
    expect(results[0].content).toBe("aligned");
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it("should respect limit", async () => {
    const store = new InMemoryVectorStore();
    await store.add(
      [
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      [{ content: "a" }, { content: "b" }, { content: "c" }]
    );

    const results = await store.search([1, 0], 1);
    expect(results.length).toBe(1);
  });

  it("should filter by metadata", async () => {
    const store = new InMemoryVectorStore();
    await store.add(
      [
        [1, 0],
        [0, 1],
      ],
      [{ content: "visible", category: "a" }, { content: "hidden", category: "b" }]
    );

    const results = await store.search([1, 0], 10, { category: "a" });
    expect(results.length).toBe(1);
    expect(results[0].content).toBe("visible");
  });

  it("should throw on dimension mismatch", async () => {
    const store = new InMemoryVectorStore();
    await store.add([[1, 0, 0]], [{ content: "x" }]);
    await expect(store.search([1, 0], 5)).rejects.toThrow(VectorStoreError);
  });

  it("should return 0 similarity for zero vectors", async () => {
    const store = new InMemoryVectorStore();
    await store.add([[0, 0, 0]], [{ content: "zero" }]);
    const results = await store.search([1, 0, 0], 5);
    expect(results[0].score).toBe(0);
  });
});

describe("InMemoryVectorStore — delete", () => {
  it("should remove records by ID", async () => {
    const store = new InMemoryVectorStore();
    await store.add(
      [
        [1, 0],
        [0, 1],
      ],
      [{ content: "a" }, { content: "b" }],
      ["id-a", "id-b"]
    );

    await store.delete(["id-a"]);
    expect(store.size).toBe(1);

    const results = await store.search([0, 1], 5);
    expect(results[0].content).toBe("b");
  });

  it("should be a no-op for non-existent IDs", async () => {
    const store = new InMemoryVectorStore();
    await store.add([[1, 0]], [{ content: "x" }], ["id-1"]);
    await store.delete(["nonexistent"]);
    expect(store.size).toBe(1);
  });
});

describe("InMemoryVectorStore — persistence", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rag-store-"));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should save and load records", async () => {
    const store = new InMemoryVectorStore();
    await store.add([[0.6, 0.8]], [{ content: "persisted" }], ["p-1"]);

    const filePath = path.join(tmpDir, "store.json");
    await store.save(filePath);

    const store2 = new InMemoryVectorStore();
    await store2.load(filePath);

    expect(store2.size).toBe(1);
    const results = await store2.search([0.6, 0.8], 5);
    expect(results[0].content).toBe("persisted");
  });
});

// ============================================================
// M11: InMemoryVectorStore.load() validation
// ============================================================

describe("M11: InMemoryVectorStore.load() should validate data", () => {
  it("should throw on corrupt JSON", async () => {
    const store = new InMemoryVectorStore();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rag-m11-"));
    const corruptFile = path.join(tmpDir, "corrupt.json");
    await fs.writeFile(corruptFile, "not valid json{{{", "utf-8");

    await expect(store.load(corruptFile)).rejects.toThrow();

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should validate embedding dimensions on load", async () => {
    const store = new InMemoryVectorStore();
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rag-m11b-"));
    const badFile = path.join(tmpDir, "bad.json");

    await fs.writeFile(
      badFile,
      JSON.stringify([
        { id: "a", embedding: [1, 0, 0], metadata: { content: "x" } },
        { id: "b", embedding: [1, 0, 0, 0, 0], metadata: { content: "y" } },
      ]),
      "utf-8"
    );

    await expect(store.load(badFile)).rejects.toThrow(VectorStoreError);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

// ============================================================
// M12: undefined metadata breaks JSON serialization
// ============================================================

describe("M12: null metadata survives save/load", () => {
  it("should preserve null metadata on save/load", async () => {
    const store = new InMemoryVectorStore();
    await store.add([[1, 0, 0]], [{ content: "test", missing: null }], ["id-1"]);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rag-m12-"));
    const saveFile = path.join(tmpDir, "store.json");

    await store.save(saveFile);
    const raw = await fs.readFile(saveFile, "utf-8");
    const parsed = JSON.parse(raw);

    // New format wraps records in { _meta, records: [...] }
    // null survives JSON.stringify (unlike undefined)
    expect(parsed._meta).toBeDefined();
    expect(parsed.records[0].metadata.missing).toBeNull();

    const store2 = new InMemoryVectorStore();
    await store2.load(saveFile);
    const results = await store2.search([1, 0, 0], 10);
    expect(results[0].metadata.missing).toBeNull();

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

// ============================================================
// L5: embedding dimension validation at ingest time
// ============================================================

describe("L5: InMemoryVectorStore.add should validate embedding dimensions", () => {
  it("should reject embeddings with inconsistent dimensions", async () => {
    const store = new InMemoryVectorStore();
    await store.add([[1, 0, 0]], [{ content: "3d" }], ["id-1"]);

    await expect(
      store.add([[1, 0, 0, 0, 0]], [{ content: "5d" }], ["id-2"])
    ).rejects.toThrow(VectorStoreError);
  });
});

// ============================================================
// L7: no duplicate ID check in InMemoryVectorStore.add
// ============================================================

describe("L7: InMemoryVectorStore.add should handle duplicate IDs", () => {
  it("should create multiple records when same ID is added twice (BUG: last write does NOT win)", async () => {
    const store = new InMemoryVectorStore();
    await store.add([[1, 0, 0]], [{ content: "first" }], ["dup-id"]);
    await store.add([[0, 1, 0]], [{ content: "second" }], ["dup-id"]);

    // Two records with the same ID exist — delete removes both
    expect(store.size).toBe(2);
    await store.delete(["dup-id"]);
    expect(store.size).toBe(0);
  });

  it("L7 improvement needed: adding same ID creates duplicates instead of replacing", async () => {
    const store = new InMemoryVectorStore();
    await store.add([[1, 0, 0]], [{ content: "version-1" }], ["same-id"]);

    const resultsBefore = await store.search([1, 0, 0], 10);
    expect(resultsBefore.length).toBe(1);
    expect(resultsBefore[0].metadata.content).toBe("version-1");

    await store.add([[1, 0, 0]], [{ content: "version-2" }], ["same-id"]);

    const resultsAfter = await store.search([1, 0, 0], 10);
    
    expect(resultsAfter.length).toBe(2);
    expect(resultsAfter.some(r => r.metadata.content === "version-1")).toBe(true);
    expect(resultsAfter.some(r => r.metadata.content === "version-2")).toBe(true);
  });
});
