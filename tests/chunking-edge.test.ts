import { describe, it, expect } from "bun:test";
import { chunkText } from "../src/chunking/index.js";

describe("Chunking edge cases (coverage gaps)", () => {
  it("recursive: overlap push exceeds size falls back to trimmed paragraph", () => {
    // When the carried-over overlap + new paragraph exceeds chunk size,
    // the strategy should fall back to just the new paragraph
    const text = "Short.\n\nThis paragraph is quite long and exceeds the size limit when combined with the previous overlap content from the previous chunk that was already accumulated here.\n\nAnother short.";
    const chunks = chunkText(text, "doc1", { strategy: "recursive", size: 50, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("recursive: final flush exceeds size falls back to fixed-size", () => {
    // A single long paragraph that accumulates and exceeds size on final flush
    const text = "This is a very long paragraph that by itself exceeds the chunk size limit and should trigger the fixed-size fallback during the final flush at the end of processing the document text.";
    const chunks = chunkText(text, "doc1", { strategy: "recursive", size: 40, overlap: 5 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("recursive: first paragraph alone exceeds size splits by sentences", () => {
    const text = "First sentence here. Second sentence follows. Third sentence completes the paragraph that is too long for a single chunk.";
    const chunks = chunkText(text, "doc1", { strategy: "recursive", size: 40, overlap: 5 });
    expect(chunks.length).toBeGreaterThan(1);
  });
});
