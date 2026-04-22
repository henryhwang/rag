import { describe, it, expect } from "bun:test";
import { syncSparseSearch } from "../src/search/hybrid.ts";
import { MockSparseSearchProvider } from "./utils/mock-sparse.ts"
import { afterEach, beforeEach } from "node:test";

describe("syncSparseSearch", () => {
  let mockSparse: MockSparseSearchProvider
  beforeEach(() => { mockSparse = new MockSparseSearchProvider() })
  afterEach(() => mockSparse.reset())
  it("adds documents to the sparse search index", () => {
    expect(mockSparse.size).toBe(0);

    syncSparseSearch(mockSparse, [
      { id: "1", content: "hello world", metadata: {} },
      { id: "2", content: "foo bar", metadata: {} },
    ]);

    expect(mockSparse.size).toBe(2);
  });

  it("appends to existing documents", () => {
    mockSparse.addDocuments([{ id: "1", content: "existing", metadata: {} }]);

    syncSparseSearch(mockSparse, [
      { id: "2", content: "new doc", metadata: {} },
    ]);

    expect(mockSparse.size).toBe(2);
  });
});
