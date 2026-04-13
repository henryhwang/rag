import { describe, it, expect } from "bun:test";
import { chunkText } from "../src/chunking/index.ts";
import { ChunkingError } from "../src/errors/index.ts";

describe("chunkText — fixed strategy", () => {
  it("should split content into fixed-size chunks", () => {
    const content = "0123456789"; // 10 chars
    const chunks = chunkText(content, "doc-1", {
      strategy: "fixed",
      size: 3,
      overlap: 0,
    });

    expect(chunks.length).toBe(4); // 3+3+3+1
    expect(chunks[0].content).toBe("012");
    expect(chunks[1].content).toBe("345");
    expect(chunks[2].content).toBe("678");
    expect(chunks[3].content).toBe("9");
  });

  it("should include overlap between chunks", () => {
    const content = "abcdefghij"; // 10 chars
    const chunks = chunkText(content, "doc-1", {
      strategy: "fixed",
      size: 4,
      overlap: 1,
    });

    // Chunks: [abcd], [defg], [ghij] (step = 4-1 = 3)
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0].content).toBe("abcd");
    expect(chunks[1].content).toBe("defg");
  });

  it("should assign sequential indices", () => {
    const chunks = chunkText("hello world", "doc-1", {
      strategy: "fixed",
      size: 5,
      overlap: 0,
    });

    expect(chunks[0].index).toBe(0);
    expect(chunks[1].index).toBe(1);
    expect(chunks[2].index).toBe(2);
  });

  it("should set documentId on each chunk", () => {
    const chunks = chunkText("test", "my-doc", {
      strategy: "fixed",
      size: 5,
      overlap: 0,
    });

    chunks.forEach((c) => expect(c.documentId).toBe("my-doc"));
  });

  it("should generate unique IDs for each chunk", () => {
    const chunks = chunkText("a".repeat(100), "doc-1", {
      strategy: "fixed",
      size: 10,
      overlap: 0,
    });

    const ids = new Set(chunks.map((c) => c.id));
    expect(ids.size).toBe(chunks.length);
  });

  it("should handle content shorter than chunk size", () => {
    const chunks = chunkText("hi", "doc-1", {
      strategy: "fixed",
      size: 10,
      overlap: 0,
    });

    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe("hi");
  });

  it("should handle empty content", () => {
    const chunks = chunkText("", "doc-1", {
      strategy: "fixed",
      size: 5,
      overlap: 0,
    });

    expect(chunks.length).toBe(0);
  });

  it("should throw if chunk size is <= 0", () => {
    expect(() =>
      chunkText("test", "doc-1", {
        strategy: "fixed",
        size: 0,
        overlap: 0,
      })
    ).toThrow(ChunkingError);

    expect(() =>
      chunkText("test", "doc-1", {
        strategy: "fixed",
        size: -1,
        overlap: 0,
      })
    ).toThrow(ChunkingError);
  });

  it("should throw if overlap is < 0", () => {
    expect(() =>
      chunkText("test", "doc-1", {
        strategy: "fixed",
        size: 5,
        overlap: -1,
      })
    ).toThrow(ChunkingError);
  });

  it("should throw if overlap >= chunk size", () => {
    expect(() =>
      chunkText("test", "doc-1", {
        strategy: "fixed",
        size: 5,
        overlap: 5,
      })
    ).toThrow(ChunkingError);

    expect(() =>
      chunkText("test", "doc-1", {
        strategy: "fixed",
        size: 5,
        overlap: 6,
      })
    ).toThrow(ChunkingError);
  });

  it("should throw for unimplemented strategies", () => {
    expect(() =>
      chunkText("test", "doc-1", {
        strategy: "recursive",
        size: 5,
        overlap: 0,
      })
    ).toThrow(ChunkingError);

    expect(() =>
      chunkText("test", "doc-1", {
        strategy: "semantic",
        size: 5,
        overlap: 0,
      })
    ).toThrow(ChunkingError);
  });
});
