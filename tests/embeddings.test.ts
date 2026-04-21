import { describe, it, expect, mock } from "bun:test";
import { OpenAICompatibleEmbeddings } from "../src/embeddings/index.ts";
import { EmbeddingError } from "../src/errors/index.ts";
import { createMockFetch, createMockFetchError } from "./helpers/mock-fetch.ts";

describe("OpenAICompatibleEmbeddings — config", () => {
  it("should use defaults", () => {
    const emb = new OpenAICompatibleEmbeddings({ apiKey: "test-key" });
    expect(emb.dimensions).toBe(1024);
  });

  it("should accept custom dimensions and model", () => {
    const emb = new OpenAICompatibleEmbeddings({
      apiKey: "test-key",
      model: "custom-model",
      dimensions: 768,
    });
    expect(emb.dimensions).toBe(768);
  });

  it("should throw if no API key is provided and env var is unset", async () => {
    const prev = process.env.OPENAI_API_KEY;
    try {
      delete process.env.OPENAI_API_KEY;
      const emb = new OpenAICompatibleEmbeddings();
      await expect(emb.embed(["hello"])).rejects.toThrow(EmbeddingError);
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });
});

describe("OpenAICompatibleEmbeddings — embed", () => {
  const BASE = "https://api.example.com/v1";
  it("should return embeddings from a successful response", async () => {
    const emb = new OpenAICompatibleEmbeddings({
      apiKey: "sk-test",
      baseURL: BASE,
      fetchFn: createMockFetch(200, {
        data: [
          { embedding: [0.1, 0.2, 0.3] },
          { embedding: [0.4, 0.5, 0.6] },
        ],
      }),
    });

    const result = await emb.embed(["text1", "text2"]);
    expect(result).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
  });

  it("should throw EmbeddingError on API error", async () => {
    const emb = new OpenAICompatibleEmbeddings({
      apiKey: "sk-bad",
      baseURL: BASE,
      fetchFn: createMockFetch(401, { error: "Unauthorized" }),
    });

    await expect(emb.embed(["text"])).rejects.toThrow(EmbeddingError);
  });

  it("should throw EmbeddingError on network failure", async () => {
    const emb = new OpenAICompatibleEmbeddings({
      apiKey: "sk-test",
      baseURL: BASE,
      fetchFn: createMockFetchError(new Error("network down")),
    });

    await expect(emb.embed(["text"])).rejects.toThrow(EmbeddingError);
  });

  it("should normalize baseURL by stripping trailing slashes", async () => {
    let capturedUrl = "";

    const emb = new OpenAICompatibleEmbeddings({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1/",
      fetchFn: mock(async (url: string, _init?: RequestInit) => {
        capturedUrl = url;
        return new Response(
          JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }),
          { status: 200 }
        );
      }),
    });

    await emb.embed(["test"]);
    expect(capturedUrl).toBe("https://api.example.com/v1/embeddings");
  });
});

// ============================================================
// M5: dimensions not sent to embedding API
// ============================================================

describe("M5: OpenAICompatibleEmbeddings should send dimensions to API", () => {
  it("should include dimensions in the request body when configured", async () => {
    let capturedBody: any;

    const emb = new OpenAICompatibleEmbeddings({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      model: "text-embedding-3-small",
      dimensions: 512,
      fetchFn: mock(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse((init as RequestInit).body as string);
        return new Response(
          JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
          { status: 200 }
        );
      }),
    });

    await emb.embed(["test"]);

    expect(capturedBody.model).toBe("text-embedding-3-small");
    expect(capturedBody.input).toEqual(["test"]);
    expect(capturedBody.dimensions).toBe(512);
  });
});

// ============================================================
// M6: no response length validation for embedding API
// ============================================================

describe("M6: embedding should validate response length matches input", () => {
  it("should detect when API returns fewer embeddings than requested", async () => {
    const emb = new OpenAICompatibleEmbeddings({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      fetchFn: createMockFetch(200, {
          data: [{ embedding: [0.1, 0.2, 0.3] }],
        }),
    });

    await expect(emb.embed(["a", "b", "c"])).rejects.toThrow(EmbeddingError);
  });
});
