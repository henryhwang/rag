import { describe, it, expect } from "bun:test";
import { QueryEngine } from "../src/query/index.ts";
import { NoopLogger } from "../src/logger/index.ts";
import type {
  EmbeddingProvider,
  VectorStore,
  Metadata,
  Filter,
  SearchResult,
} from "../src/types/index.ts";

// --- Mock EmbeddingProvider ---

class MockEmbeddings implements EmbeddingProvider {
  readonly dimensions = 3;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      // Deterministic mock: hash text to a vector
      const sum = t.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      return [(sum % 10) / 10, ((sum * 2) % 10) / 10, ((sum * 3) % 10) / 10];
    });
  }
}

// --- Mock VectorStore ---

class MockVectorStore implements VectorStore {
  private results: SearchResult[] = [];

  setMockResults(results: SearchResult[]) {
    this.results = results;
  }

  async add(
    _embeddings: number[][],
    _metadatas: Metadata[],
    _ids?: string[]
  ): Promise<void> {}

  async search(
    _query: number[],
    limit: number,
    _filter?: Filter
  ): Promise<SearchResult[]> {
    return this.results.slice(0, limit);
  }

  async delete(_ids: string[]): Promise<void> {}
  async save(_path: string): Promise<void> {}
  async load(_path: string): Promise<void> {}
}

describe("QueryEngine — query", () => {
  it("should return context from vector store results", async () => {
    const embeddings = new MockEmbeddings();
    const store = new MockVectorStore();
    store.setMockResults([
      {
        id: "c1",
        content: "Relevant chunk A",
        score: 0.9,
        metadata: {},
        documentId: "doc-1",
      },
      {
        id: "c2",
        content: "Relevant chunk B",
        score: 0.7,
        metadata: {},
        documentId: "doc-1",
      },
    ]);

    const engine = new QueryEngine({
      embeddings,
      vectorStore: store,
      logger: new NoopLogger(),
    });

    const result = await engine.query("test question");

    expect(result.question).toBe("test question");
    expect(result.context.length).toBe(2);
    expect(result.context[0].content).toBe("Relevant chunk A");
  });

  it("should filter results below scoreThreshold", async () => {
    const embeddings = new MockEmbeddings();
    const store = new MockVectorStore();
    store.setMockResults([
      { id: "c1", content: "High score", score: 0.9, metadata: {} },
      { id: "c2", content: "Low score", score: 0.3, metadata: {} },
    ]);

    const engine = new QueryEngine({
      embeddings,
      vectorStore: store,
      logger: new NoopLogger(),
    });

    const result = await engine.query("test", { scoreThreshold: 0.5 });

    expect(result.context.length).toBe(1);
    expect(result.context[0].content).toBe("High score");
  });
});

describe("QueryEngine — queryAndAnswer", () => {
  it("should generate an answer when context is available", async () => {
    const embeddings = new MockEmbeddings();
    const store = new MockVectorStore();
    store.setMockResults([
      { id: "c1", content: "The capital is Paris.", score: 0.9, metadata: {} },
    ]);

    const mockLlm = {
      generate: async (prompt: string) => {
        if (prompt.includes("Paris")) return "The capital is Paris.";
        return "I don't know.";
      },
      stream: async function* () {},
    };

    const engine = new QueryEngine({
      embeddings,
      vectorStore: store,
      logger: new NoopLogger(),
    });

    const result = await engine.queryAndAnswer("What is the capital?", mockLlm);

    expect(result.answer).toBe("The capital is Paris.");
    expect(result.context.length).toBe(1);
    expect(result.question).toBe("What is the capital?");
  });

  it("should return a fallback message when no context is found", async () => {
    const embeddings = new MockEmbeddings();
    const store = new MockVectorStore();
    store.setMockResults([]);

    const mockLlm = {
      generate: async () => "should not be called",
      stream: async function* () {},
    };

    const engine = new QueryEngine({
      embeddings,
      vectorStore: store,
      logger: new NoopLogger(),
    });

    const result = await engine.queryAndAnswer("What?", mockLlm);

    expect(result.answer).toBe(
      "No relevant context was found to answer this question."
    );
    expect(result.context).toEqual([]);
  });

  it("should use a custom systemPrompt when provided", async () => {
    const embeddings = new MockEmbeddings();
    const store = new MockVectorStore();
    store.setMockResults([
      { id: "c1", content: "42", score: 0.9, metadata: {} },
    ]);

    let receivedPrompt = "";
    const mockLlm = {
      generate: async (prompt: string) => {
        receivedPrompt = prompt;
        return "answer";
      },
      stream: async function* () {},
    };

    const engine = new QueryEngine({
      embeddings,
      vectorStore: store,
      logger: new NoopLogger(),
    });

    await engine.queryAndAnswer("What is the answer?", mockLlm, {
      systemPrompt: "Be very concise.",
    });

    expect(receivedPrompt).toContain("Be very concise.");
  });
});
