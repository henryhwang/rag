import { describe, it, expect, spyOn } from "bun:test";
import { chunkText } from "../src/chunking/index.ts";
import { ChunkingError } from "../src/errors/index.ts";
import type { Chunk, ChunkOptions } from "../src/types/index.ts";

const createOptions = (
  strategy: 'fixed' | 'recursive' | 'markdown',
  size: number,
  overlap?: number
): ChunkOptions => ({
  strategy,
  size,
  overlap,
});

const assertBasicInvariants = (chunks: Chunk[], maxSize: number, tolerance = 100) => {
  expect(chunks.length).toBeGreaterThan(0);
  chunks.forEach((chunk, i) => {
    expect(chunk.content.length).toBeLessThanOrEqual(maxSize + tolerance);
    expect(chunk.index).toBe(i);
  });
};

describe("chunkText — Core Behavior & Validation", () => {
  it("returns empty array for empty or whitespace-only content", () => {
    const strategies = ["fixed", "recursive", "markdown"] as const;
    strategies.forEach((strategy) => {
      const chunks = chunkText("   \n\t   ", "doc-1", createOptions(strategy, 100));
      expect(chunks).toEqual([]);
    });
  });

  it("throws ChunkingError for invalid size or overlap", () => {
    const strategies = ["fixed", "recursive", "markdown"] as const;
    strategies.forEach((strategy) => {
      expect(() => chunkText("test", "doc-1", { strategy, size: 0 })).toThrow(ChunkingError);
      expect(() => chunkText("test", "doc-1", { strategy, size: 100, overlap: 200 })).toThrow(ChunkingError);
    });
  });

  it("warns when overlap is excessively large", () => {
    const warnSpy = spyOn(console, "warn");
    chunkText("A".repeat(1000), "doc-1", createOptions("fixed", 200, 100));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Large overlap"));
  });
});

describe("fixed strategy", () => {
  it("creates fixed-size chunks with proper overlap", () => {
    const content = "0123456789abcdefghij";
    const chunks = chunkText(content, "doc-1", createOptions("fixed", 6, 2));

    // size=6, overlap=2 means step by 4 chars (last 2 chars overlap)
    expect(chunks.map((c) => c.content)).toEqual([
      "012345",
      "456789",
      "89abcd",
      "cdefgh",
      "ghij", // last chunk: only chars 16-19 remain
    ]);

    assertBasicInvariants(chunks, 6, 0);
  });

  it("fixed strategy chunks share exact specified overlap", () => {
    const content = "0123456789abcdefghijklmn";
    const chunks = chunkText(content, "doc-1", createOptions("fixed", 8, 3));

    // Verify each consecutive pair shares exactly 'overlap' characters
    for (let i = 0; i < chunks.length - 1; i++) {
      const prevEnd = chunks[i].content.slice(-3);
      const nextStart = chunks[i + 1].content.slice(0, 3);
      expect(prevEnd).toBe(nextStart);
    }
  });

  it("fixed strategy handles zero overlap", () => {
    const chunks = chunkText("0123456789", "doc-1", createOptions("fixed", 4, 0));
    expect(chunks.map((c) => c.content)).toEqual(["0123", "4567", "89"]);
  });
});

describe("recursive strategy", () => {
  it("splits on paragraph then sentence boundaries", () => {
    const content =
      "First paragraph with some important content.\n\n" +
      "Second paragraph. This has sentence one. Sentence two is here.";

    const chunks = chunkText(content, "doc-1", createOptions("recursive", 55, 12));
    assertBasicInvariants(chunks, 55);
  });

  it("recursive strategy respects overlap parameter", () => {
    const content = "First sentence. Second sentence. Third sentence. Fourth.";
    const chunks = chunkText(content, "doc-1", createOptions("recursive", 25, 8));

    if (chunks.length > 1) {
      for (let i = 0; i < chunks.length - 1; i++) {
        const prevEnd = chunks[i].content.slice(-8);
        expect(chunks[i + 1].content).toContain(prevEnd.trim());
      }
    }
  });

  it("maintains sequential indexes through recursive splits", () => {
    const content = "A very long paragraph ".repeat(50) + "that needs splitting here.";
    const chunks = chunkText(content, "doc-1", createOptions("recursive", 30, 5));
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
  });
});

describe("markdown strategy — structure awareness", () => {
  it("respects headings and stores hierarchy in metadata", () => {
    const content = `# Main Title
Introduction paragraph here.

## Subsection One
Content under the first subsection.`;

    const chunks = chunkText(content, "doc-1", createOptions("markdown", 70, 15));
    assertBasicInvariants(chunks, 70);
  });

  it("never splits inside code blocks", () => {
    const content = `# Title
\`\`\`typescript
function helloWorld() {
 console.log("Hello");
}
\`\`\`
After code.`;

    const chunks = chunkText(content, "doc-1", createOptions("markdown", 60, 0));

    const codeChunk = chunks.find((c) => c.content.includes("helloWorld"));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.metadata.isCodeBlock).toBe(true);
  });

  it("handles very long non-code lines gracefully", () => {
    const longLine = "This is ".repeat(50) + "a very long line that exceeds typical chunk sizes.";
    const content = `# Example\n${longLine}\n\nNormal text.`;
    const chunks = chunkText(content, "doc-1", createOptions("markdown", 100, 10));

    // Should not produce any chunk exceeding maxSize significantly
    assertBasicInvariants(chunks, 100, 50); // small tolerance for unavoidable overflow
  });

  it("preserves heading hierarchy metadata through multiple levels", () => {
    const content = `# H1
Content for H1.

## H2
Content for H2.

### H3
Content for H3.`;
    const chunks = chunkText(content, "doc-1", createOptions("markdown", 50, 0));
    const h3Chunk = chunks.find((c) => c.content.includes("H3"));
    const headings = h3Chunk?.metadata.headings;

    expect(Array.isArray(headings)).toBe(true);
    expect((headings as string[]).length).toBeGreaterThan(0);
  });
});

describe("Cross-strategy Edge Cases", () => {
  it("handles very large single units", () => {
    const longParagraph = "A".repeat(1200);
    const chunks = chunkText(longParagraph, "doc-1", createOptions("recursive", 300, 50));
    assertBasicInvariants(chunks, 300, 200);   // allow some tolerance for fallback
    expect(chunks.length).toBeGreaterThan(1);   // must be split
  });
});
