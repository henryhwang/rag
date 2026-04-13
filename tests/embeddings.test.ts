import { describe, it, expect, afterEach } from "bun:test";
import { OpenAICompatibleEmbeddings } from "../src/embeddings/index.ts";
import { EmbeddingError } from "../src/errors/index.ts";

// --- Mock fetch ---

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), { status });
}

function mockFetchError(err: Error) {
  globalThis.fetch = async () => {
    throw err;
  };
}

function restoreFetch() {
  // @ts-ignore — restore native for other tests
  globalThis.fetch = undefined;
}

describe("OpenAICompatibleEmbeddings — config", () => {
  it("should use defaults", () => {
    const emb = new OpenAICompatibleEmbeddings({ apiKey: "test-key" });
    expect(emb.dimensions).toBe(1536);
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

  afterEach(() => restoreFetch());

  it("should return embeddings from a successful response", async () => {
    mockFetch(200, {
      data: [
        { embedding: [0.1, 0.2, 0.3] },
        { embedding: [0.4, 0.5, 0.6] },
      ],
    });

    const emb = new OpenAICompatibleEmbeddings({
      apiKey: "sk-test",
      baseURL: BASE,
    });

    const result = await emb.embed(["text1", "text2"]);
    expect(result).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
  });

  it("should throw EmbeddingError on API error", async () => {
    mockFetch(401, { error: "Unauthorized" });

    const emb = new OpenAICompatibleEmbeddings({
      apiKey: "sk-bad",
      baseURL: BASE,
    });

    await expect(emb.embed(["text"])).rejects.toThrow(EmbeddingError);
  });

  it("should throw EmbeddingError on network failure", async () => {
    mockFetchError(new Error("network down"));

    const emb = new OpenAICompatibleEmbeddings({
      apiKey: "sk-test",
      baseURL: BASE,
    });

    await expect(emb.embed(["text"])).rejects.toThrow(EmbeddingError);
  });

  it("should normalize baseURL by stripping trailing slashes", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }),
        { status: 200 }
      );
    };

    const emb = new OpenAICompatibleEmbeddings({
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1/",
    });

    await emb.embed(["test"]);
    expect(capturedUrl).toBe("https://api.example.com/v1/embeddings");
  });
});
