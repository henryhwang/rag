import { describe, it, expect } from "bun:test";
import { OpenAICompatibleEmbeddings } from "../src/embeddings/index.js";
import { SimpleQueryRewriter } from "../src/query/rewrite/simple-rewriter.js";
import { TextParser } from "../src/parsers/index.js";

describe("Coverage: getters and small methods", () => {
  it("OpenAICompatibleEmbeddings.dimensions returns configured value", () => {
    const emb = new OpenAICompatibleEmbeddings({
      apiKey: "sk-test",
      dimensions: 768,
    });
    expect(emb.dimensions).toBe(768);
  });

  it("OpenAICompatibleEmbeddings.dimensions returns default", () => {
    const emb = new OpenAICompatibleEmbeddings({ apiKey: "sk-test" });
    expect(emb.dimensions).toBe(1024);
  });

  it("SimpleQueryRewriter.name returns correct string", () => {
    const rewriter = new SimpleQueryRewriter();
    expect(rewriter.name).toBe("SimpleQueryRewriter");
  });

  it("TextParser.supports returns true for supported extension", () => {
    const parser = new TextParser();
    expect(parser.supports("file.txt")).toBe(true);
  });

  it("TextParser.supports returns false for unsupported extension", () => {
    const parser = new TextParser();
    expect(parser.supports("file.pdf")).toBe(false);
  });
});
