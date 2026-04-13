import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RAG } from "../src/core/RAG.ts";
import { RAGError } from "../src/errors/index.ts";
import type {
  EmbeddingProvider,
  VectorStore,
  Metadata,
  Filter,
  SearchResult,
  LLMProvider,
  LLMOptions,
} from "../src/types/index.ts";
import { NoopLogger } from "../src/logger/index.ts";

// --- Mock EmbeddingProvider ---

class MockEmbeddings implements EmbeddingProvider {
  readonly dimensions = 3;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const sum = t.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      return [(sum % 10) / 10, ((sum * 2) % 10) / 10, ((sum * 3) % 10) / 10];
    });
  }
}

// --- Mock VectorStore ---

class MockVectorStore implements VectorStore {
  private records: { id: string; embedding: number[]; metadata: Metadata }[] = [];

  async add(embeddings: number[][], metadatas: Metadata[], ids?: string[]): Promise<void> {
    for (let i = 0; i < embeddings.length; i++) {
      this.records.push({
        id: ids?.[i] ?? crypto.randomUUID(),
        embedding: embeddings[i],
        metadata: metadatas[i],
      });
    }
  }

  async search(_query: number[], limit: number, _filter?: Filter): Promise<SearchResult[]> {
    return this.records.slice(0, limit).map((r) => ({
      id: r.id,
      content: (r.metadata.content as string) ?? "",
      score: 0.8,
      metadata: r.metadata,
      documentId: (r.metadata.documentId as string) ?? undefined,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    const s = new Set(ids);
    this.records = this.records.filter((r) => !s.has(r.id));
  }

  async save(_path: string): Promise<void> {}
  async load(_path: string): Promise<void> {}
  get size(): number { return this.records.length; }
}

// --- Mock LLM ---

class MockLLM implements LLMProvider {
  async generate(_prompt: string, _options?: LLMOptions): Promise<string> {
    return "Mock answer based on context.";
  }
  async *stream(_prompt: string, _options?: LLMOptions): AsyncIterable<string> {}
}

// --- Helpers ---

async function writeTemp(ext: string, content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rag-rag-test-"));
  const filePath = path.join(dir, `sample.${ext}`);
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}

function makeRag(store?: VectorStore, embeddings?: EmbeddingProvider) {
  const emb = embeddings ?? new MockEmbeddings();
  const vs = store ?? new MockVectorStore();
  return {
    rag: new RAG({
      embeddings: emb,
      vectorStore: vs,
      chunking: { strategy: "fixed", size: 500, overlap: 50 },
      logger: new NoopLogger(),
    }),
    store: vs,
  };
}

describe("RAG — construction", () => {
  it("should construct with minimal config", () => {
    const { rag } = makeRag();
    expect(rag).toBeDefined();
  });
});

describe("RAG — document management", () => {
  it("should add a document from a string path", async () => {
    const { rag } = makeRag();
    const filePath = await writeTemp("txt", "This is test content for the RAG class.");
    const doc = await rag.addDocument(filePath);

    expect(doc.id).toBeDefined();
    expect(doc.fileName).toBe("sample.txt");
    expect(doc.content).toBe("This is test content for the RAG class.");
  });

  it("should add a document from { path } object", async () => {
    const { rag } = makeRag();
    const filePath = await writeTemp("txt", "Object-style input");
    const doc = await rag.addDocument({ path: filePath });

    expect(doc.content).toBe("Object-style input");
  });

  it("should add multiple documents", async () => {
    const { rag } = makeRag();
    const f1 = await writeTemp("txt", "Document one");
    const f2 = await writeTemp("txt", "Document two");

    const docs = await rag.addDocuments([f1, f2]);
    expect(docs.length).toBe(2);
  });

  it("should list added documents", async () => {
    const { rag } = makeRag();
    const f = await writeTemp("txt", "List me");
    await rag.addDocument(f);

    const list = rag.listDocuments();
    expect(list.length).toBe(1);
    expect(list[0].content).toBe("List me");
  });

  it("should remove a document from tracking", async () => {
    const { rag } = makeRag();
    const f = await writeTemp("txt", "Remove me");
    const doc = await rag.addDocument(f);

    await rag.removeDocument(doc.id);
    expect(rag.listDocuments().length).toBe(0);
  });

  it("should throw when removing a non-existent document", async () => {
    const { rag } = makeRag();
    await expect(rag.removeDocument("fake-id")).rejects.toThrow(RAGError);
  });
});

describe("RAG — query", () => {
  it("should query and return context", async () => {
    const { rag } = makeRag();
    const f = await writeTemp("txt", "The sky is blue.");
    await rag.addDocument(f);

    const result = await rag.query("What color is the sky?");
    expect(result.question).toBe("What color is the sky?");
    expect(result.context.length).toBeGreaterThan(0);
  });
});

describe("RAG — queryAndAnswer", () => {
  it("should require an LLM provider", async () => {
    const { rag } = makeRag();
    await expect(rag.queryAndAnswer("What?")).rejects.toThrow(RAGError);
  });

  it("should return an answer when context is available", async () => {
    const { rag } = makeRag();
    const f = await writeTemp("txt", "The capital of France is Paris.");
    await rag.addDocument(f);

    const result = await rag.queryAndAnswer("What is the capital?", {
      llm: new MockLLM(),
    });

    expect(result.answer).toBe("Mock answer based on context.");
    expect(result.context.length).toBeGreaterThan(0);
  });
});

describe("RAG — updateConfig", () => {
  it("should update chunking options", () => {
    const { rag } = makeRag();
    rag.updateConfig({ chunking: { size: 200 } });
    // No direct way to verify internal state, but it shouldn't throw
  });
});
