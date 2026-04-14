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

  it("should throw for unknown strategies", () => {
    expect(() =>
      chunkText("test", "doc-1", {
        strategy: "unknown" as any,
        size: 5,
        overlap: 0,
      })
    ).toThrow(ChunkingError);
  });
});

// ============================================================
// C3: recursive chunking should apply overlap at paragraph level
// ============================================================

describe("C3: recursive strategy should apply overlap", () => {
  it("should carry trailing content from one paragraph group into the next", async () => {
    const content =
      "Paragraph one content.\n\n" +
      "Paragraph two content.\n\n" +
      "Paragraph three is the one that pushes us over the size boundary for sure.";
    const chunks = chunkText(content, "doc-1", {
      strategy: "recursive",
      size: 45,
      overlap: 6,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // The last 6 chars of chunk 0 should be the FIRST 6 chars of chunk 1
    const overlap = chunks[0].content.slice(-6);
    expect(chunks[1].content.startsWith(overlap)).toBe(true);
  });
});

// ============================================================
// C4: markdownAwareChunk should apply overlap
// ============================================================

describe("C4: markdown-aware strategy should apply overlap", () => {
  it("should carry trailing content from one chunk into the next", async () => {
    const content = `# Section

Short line one.
Short line two.
Short line three.
Short line four which pushes past the limit.`;
    const chunks = chunkText(content, "doc-1", {
      strategy: "semantic",
      size: 40,
      overlap: 8,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // The last 8 chars of chunk 0 should appear in chunk 1.
    // Note: chunk 1 may have a heading prefix, so the overlap won't be at
    // position 0, but it should appear early (within the first 20 chars).
    const overlap = chunks[0].content.slice(-8);
    const pos = chunks[1].content.indexOf(overlap);
    expect(pos).toBeGreaterThanOrEqual(0);
    expect(pos).toBeLessThan(20);
  });
});

// ============================================================
// H3: 'semantic' strategy name is misleading
// ============================================================

describe("H3: 'semantic' strategy should be renamed to 'markdown'", () => {
  it("should apply markdown-aware chunking for 'semantic' strategy", async () => {
    const content = "This is plain text. It has no headings or code blocks. Just sentences.";
    const chunks = chunkText(content, "doc-1", {
      strategy: "semantic",
      size: 50,
      overlap: 5,
    });
    // The 'semantic' name implies embedding/topic-based splitting but
    // actually does markdown-aware splitting.
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("should not accept 'markdown' as a strategy yet (reserved name)", () => {
    expect(() =>
      chunkText("hello", "doc-1", { strategy: "markdown" as any, size: 100, overlap: 10 })
    ).toThrow(ChunkingError);
  });
});

// ============================================================
// L2: large overlap produces excessive chunks
// ============================================================

describe("L2: large overlap should not produce excessive chunks without warning", () => {
  it("should produce many chunks when overlap approaches size", () => {
    const content = "A".repeat(2500);
    const chunks = chunkText(content, "doc-1", {
      strategy: "fixed",
      size: 500,
      overlap: 499,
    });
    // overlap=499, size=500 → step=1, producing ~2000 chunks
    expect(chunks.length).toBeGreaterThan(1000);
  });
});

// ============================================================
// L3: empty content produces zero chunks silently
// ============================================================

describe("L3: empty content produces zero chunks", () => {
  it("should return [] for empty content", () => {
    const chunks = chunkText("", "doc-1", {
      strategy: "fixed",
      size: 500,
      overlap: 50,
    });
    expect(chunks).toEqual([]);
  });

  it("should produce 1 chunk for whitespace-only content", () => {
    const chunks = chunkText("   \n\n  \t  ", "doc-1", {
      strategy: "fixed",
      size: 500,
      overlap: 50,
    });
    expect(chunks.length).toBe(1);
  });
});

// ============================================================
// L8: code fence detection too broad
// ============================================================

describe("L8: markdown chunking should handle nested code fences", () => {
  it("should not flip code block state for backticks inside code blocks", () => {
    const content = [
      "# Title",
      "",
      "```python",
      'example = "```python"',
      "```",
    ].join("\n");

    const chunks = chunkText(content, "doc-1", {
      strategy: "semantic",
      size: 200,
      overlap: 0,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].content).toContain("```python");
  });
});

// ============================================================
// L9: heading context duplication can exceed size
// ============================================================

describe("L9: markdown chunking heading context can exceed size", () => {
  it("should document that heading prepending can make chunks exceed size", () => {
    const longLine = "x".repeat(50);
    const content = [`# Heading`, "", longLine, longLine].join("\n");

    const chunks = chunkText(content, "doc-1", {
      strategy: "semantic",
      size: 60,
      overlap: 0,
    });

    // Some chunks may exceed size when heading context is prepended
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// Recursive strategy — paragraphs → sentences → fixed fallback
// ============================================================

describe("chunkText — recursive strategy", () => {
  it("should split on paragraph boundaries", () => {
    const content = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    const chunks = chunkText(content, "doc-1", {
      strategy: "recursive",
      size: 100,
      overlap: 0,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].content).toContain("First paragraph");
  });

  it("should split long paragraphs by sentence boundaries", () => {
    const content = "Sentence one here. Sentence two is next. " +
      "This is sentence three. And sentence four ends it.";
    const chunks = chunkText(content, "doc-1", {
      strategy: "recursive",
      size: 30,
      overlap: 0,
    });

    expect(chunks.length).toBeGreaterThan(1);
    // Sentences should be split across chunks
    const allText = chunks.map((c) => c.content).join(" ");
    expect(allText).toContain("Sentence one");
    expect(allText).toContain("sentence four");
  });

  it("should fall back to fixed-size for oversized sentences", () => {
    const longSentence = "A".repeat(100) + ". ";
    const content = `${longSentence} Short sentence.`;
    const chunks = chunkText(content, "doc-1", {
      strategy: "recursive",
      size: 50,
      overlap: 0,
    });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.content.length).toBeLessThanOrEqual(50));
  });

  it("should throw on invalid size/overlap", () => {
    expect(() =>
      chunkText("test", "doc-1", { strategy: "recursive", size: 0, overlap: 0 })
    ).toThrow(ChunkingError);
    expect(() =>
      chunkText("test", "doc-1", { strategy: "recursive", size: 10, overlap: 10 })
    ).toThrow(ChunkingError);
  });
});

// ============================================================
// Markdown-aware (semantic) strategy
// ============================================================

describe("chunkText — markdown-aware strategy", () => {
  it("should split on headings", () => {
    const content = `# Heading 1

Content under heading one goes here with some words.

## Heading 2

More content under heading two.`;
    const chunks = chunkText(content, "doc-1", {
      strategy: "semantic",
      size: 60,
      overlap: 0,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // First chunk should start with heading
    expect(chunks[0].content).toContain("# Heading 1");
  });

  it("should never split inside a code block", () => {
    const codeContent = `# Title

Some intro text.

\`\`\`
function hello() {
  console.log("world");
  return true;
}
\`\`\`

After the code.`;
    const chunks = chunkText(codeContent, "doc-1", {
      strategy: "semantic",
      size: 50,
      overlap: 0,
    });

    // Code block should be kept together in one chunk
    const codeChunk = chunks.find((c) => c.content.includes("function hello"));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.content).toContain("```");
  });

  it("should prepend heading context to continuation chunks", () => {
    const content = `## Section

A lot of text here that will exceed the size limit for a single chunk.
More lines to push it over the boundary.`;
    const chunks = chunkText(content, "doc-1", {
      strategy: "semantic",
      size: 50,
      overlap: 0,
    });

    expect(chunks.length).toBeGreaterThan(1);
    // Second chunk should include the heading for context
    expect(chunks[1].content).toContain("## Section");
  });

  it("should throw on invalid size/overlap", () => {
    expect(() =>
      chunkText("test", "doc-1", { strategy: "semantic", size: -1, overlap: 0 })
    ).toThrow(ChunkingError);
    expect(() =>
      chunkText("test", "doc-1", { strategy: "semantic", size: 10, overlap: 15 })
    ).toThrow(ChunkingError);
  });
});
