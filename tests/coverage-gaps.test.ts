import { describe, it, expect } from "bun:test";
import { OpenAICompatibleEmbeddings } from "../src/embeddings/index.ts";
import { SimpleQueryRewriter } from "../src/query/rewrite/simple-rewriter.ts";
import { TextParser } from "../src/parsers/index.ts";
import { LLMQueryRewriter } from "../src/query/rewrite/llm-rewriter.ts";
import { QueryError } from "../src/errors/index.ts";
import { OpenAICompatibleReranker } from "../src/reranking/openai-compatible.ts";
import { RerankError } from "../src/errors/index.ts";

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

// ============================================================
// Issue 2.4: LLMQueryRewriter should use QueryError
// ============================================================

describe("LLMQueryRewriter error handling", () => {
  const mockLLM = {
    generate: async () => "mock response",
    name: "MockLLM",
  };

  it("should throw QueryError for numQueries < 1", () => {
    expect(() => new LLMQueryRewriter({ llm: mockLLM as any, numQueries: 0 })).toThrow(QueryError);
    expect(() => new LLMQueryRewriter({ llm: mockLLM as any, numQueries: 0 })).toThrow("numQueries must be at least 1");
  });

  it("should throw QueryError for empty query in rewrite", async () => {
    const rewriter = new LLMQueryRewriter({ llm: mockLLM as any, numQueries: 2 });
    await expect(rewriter.rewrite("")).rejects.toThrow(QueryError);
    await expect(rewriter.rewrite("   ")).rejects.toThrow("Query cannot be empty");
  });

  it("should work normally with valid inputs", async () => {
    const rewriter = new LLMQueryRewriter({ llm: mockLLM as any, numQueries: 1 });
    // With numQueries=1, it should return just the original query
    const result = await rewriter.rewrite("test query");
    expect(result).toEqual(["test query"]);
  });
});

// ============================================================
// Issue 2.5: Reranker should fail fast on missing API key
// ============================================================

describe("OpenAICompatibleReranker API key validation", () => {
  it("should throw RerankError when apiKey is empty", async () => {
    const reranker = new OpenAICompatibleReranker({ apiKey: "" });
    // Should fail fast before making any network calls
    await expect(reranker.rerank("query", ["doc1", "doc2"])).rejects.toThrow(RerankError);
    await expect(reranker.rerank("query", ["doc1", "doc2"])).rejects.toThrow("API key is required");
  });

  it("should throw RerankError when apiKey is undefined", async () => {
    const reranker = new OpenAICompatibleReranker({});
    await expect(reranker.rerank("query", ["doc1", "doc2"])).rejects.toThrow(RerankError);
  });

  it("should work with valid API key (construction only)", () => {
    // Just verify construction doesn't throw
    const reranker = new OpenAICompatibleReranker({ apiKey: "sk-test-key" });
    expect(reranker.name).toBe("OpenAICompatibleReranker");
  });
});
