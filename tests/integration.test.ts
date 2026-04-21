import { describe, it, expect } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RAG } from "../src/core/RAG.ts";
import { InMemoryVectorStore } from "../src/storage/index.ts";
import type {
  EmbeddingProvider,
  LLMProvider,
  LLMOptions,
} from "../src/types/index.ts";
import { NoopLogger } from "../src/logger/index.ts";

// ============================================================
// Mock components for a realistic end-to-end flow
// ============================================================

/** Embedding provider that returns deterministic, predictable vectors. */
class MockEmbeddings implements EmbeddingProvider {
  readonly dimensions = 4;
  readonly encodingFormat = 'float';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      // Create a vector where each dimension reflects character codes
      // so similar texts produce similar vectors.
      const codes = t.split("").map((c) => c.charCodeAt(0));
      const v = [
        this._norm(codes.filter((_, i) => i % 4 === 0)),
        this._norm(codes.filter((_, i) => i % 4 === 1)),
        this._norm(codes.filter((_, i) => i % 4 === 2)),
        this._norm(codes.filter((_, i) => i % 4 === 3)),
      ];
      return v;
    });
  }

  private _norm(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sum = arr.reduce((a, b) => a + b, 0);
    return Math.min(sum / 500, 1);
  }
}

/** LLM that echoes back a summary of the context. */
class EchoLLM implements LLMProvider {
  async generate(prompt: string, _options?: LLMOptions): Promise<string> {
    return `Answer: ${prompt.slice(0, 80)}...`;
  }
  async *stream(_prompt: string, _options?: LLMOptions): AsyncIterable<string> {}
}

async function writeTemp(ext: string, content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rag-integ-"));
  const filePath = path.join(dir, `sample.${ext}`);
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}

describe("Integration — full RAG flow with InMemoryVectorStore", () => {
  it("should ingest a text file and retrieve it", async () => {
    const store = new InMemoryVectorStore();
    const embeddings = new MockEmbeddings();
    const rag = new RAG({
      embeddings,
      vectorStore: store,
      chunking: { strategy: "fixed", size: 500, overlap: 50 },
      logger: new NoopLogger(),
    });

    const filePath = await writeTemp("txt", "RAG stands for Retrieval-Augmented Generation.");
    const doc = await rag.addDocument(filePath);

    expect(doc.content).toContain("Retrieval-Augmented Generation");
    expect(store.size).toBeGreaterThan(0);
  });

  it("should ingest multiple files of mixed formats", async () => {
    const store = new InMemoryVectorStore();
    const embeddings = new MockEmbeddings();
    const rag = new RAG({
      embeddings,
      vectorStore: store,
      chunking: { strategy: "fixed", size: 500, overlap: 50 },
      logger: new NoopLogger(),
    });

    const txtFile = await writeTemp("txt", "Plain text document content.");
    const mdFile = await writeTemp("md", "# Markdown\n\nWith some body text.");

    const docs = await rag.addDocuments([txtFile, mdFile]);
    expect(docs.length).toBe(2);
    expect(store.size).toBeGreaterThan(0);
  });

  it("should query and return relevant context", async () => {
    const store = new InMemoryVectorStore();
    const embeddings = new MockEmbeddings();
    const rag = new RAG({
      embeddings,
      vectorStore: store,
      chunking: { strategy: "fixed", size: 100, overlap: 10 },
      logger: new NoopLogger(),
    });

    const f = await writeTemp("txt", "The quick brown fox jumps over the lazy dog.");
    await rag.addDocument(f);

    const result = await rag.query("What does the fox do?");
    expect(result.context.length).toBeGreaterThan(0);
    expect(result.context[0].content).toContain("fox");
  });

  it("should queryAndAnswer with an LLM", async () => {
    const store = new InMemoryVectorStore();
    const embeddings = new MockEmbeddings();
    const rag = new RAG({
      embeddings,
      vectorStore: store,
      chunking: { strategy: "fixed", size: 100, overlap: 10 },
      logger: new NoopLogger(),
    });

    const f = await writeTemp("txt", "Python is a popular programming language.");
    await rag.addDocument(f);

    const result = await rag.queryAndAnswer("What is Python?", {
      llm: new EchoLLM(),
    });

    expect(result.answer).toContain("Answer:");
    expect(result.context.length).toBeGreaterThan(0);
  });

  it("should persist and reload the vector store", async () => {
    const store = new InMemoryVectorStore();
    const embeddings = new MockEmbeddings();
    const rag = new RAG({
      embeddings,
      vectorStore: store,
      chunking: { strategy: "fixed", size: 500, overlap: 0 },
      logger: new NoopLogger(),
    });

    const f = await writeTemp("txt", "Persistence test content.");
    await rag.addDocument(f);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rag-persist-"));
    const storeFile = path.join(tmpDir, "vectors.json");

    await store.save(storeFile);

    const store2 = new InMemoryVectorStore();
    await store2.load(storeFile);
    expect(store2.size).toBe(store.size);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should handle document removal from tracking", async () => {
    const store = new InMemoryVectorStore();
    const embeddings = new MockEmbeddings();
    const rag = new RAG({
      embeddings,
      vectorStore: store,
      chunking: { strategy: "fixed", size: 500, overlap: 0 },
      logger: new NoopLogger(),
    });

    const f = await writeTemp("txt", "Will be removed.");
    const doc = await rag.addDocument(f);

    expect(rag.listDocuments().length).toBe(1);
    await rag.removeDocument(doc.id);
    expect(rag.listDocuments().length).toBe(0);
  });
});
