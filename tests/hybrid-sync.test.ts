import { describe, it, expect } from "bun:test";
import { syncBM25WithStore } from "../src/search/hybrid.js";
import { BM25Index } from "../src/search/bm25.js";

describe("syncBM25WithStore", () => {
  it("adds documents to the BM25 index", () => {
    const bm25 = new BM25Index();
    expect(bm25.size).toBe(0);

    syncBM25WithStore(bm25, [
      { id: "1", content: "hello world", metadata: {} },
      { id: "2", content: "foo bar", metadata: {} },
    ]);

    expect(bm25.size).toBe(2);
  });

  it("appends to existing documents", () => {
    const bm25 = new BM25Index();
    bm25.addDocuments([{ id: "1", content: "existing", metadata: {} }]);

    syncBM25WithStore(bm25, [
      { id: "2", content: "new doc", metadata: {} },
    ]);

    expect(bm25.size).toBe(2);
  });
});
