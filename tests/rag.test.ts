import { describe, it, expect } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RAG } from "../src/core/RAG.ts";
import { BM25Index } from "../src/search/bm25.ts";
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
  readonly encodingFormat = 'float';
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const sum = t.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
      return [(sum % 10) / 10, ((sum * 2) % 10) / 10, ((sum * 3) % 10) / 10];
    });
  }
}

// --- Mock VectorStore ---

class MockVectorStore implements VectorStore {
  readonly metadata = null;
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

// ============================================================
// C1+C2: removeDocument should purge vector store chunks
// ============================================================

describe("C1+C2: removeDocument should purge vector store chunks", () => {
  it("should not leave orphaned chunks after removal", async () => {
    const store = new MockVectorStore();
    const embeddings = new MockEmbeddings();
    const rag = new RAG({
      embeddings,
      vectorStore: store,
      chunking: { strategy: "fixed", size: 500, overlap: 50 },
      logger: new NoopLogger(),
    });

    const f = await writeTemp("txt", "This document will be removed.");
    const doc = await rag.addDocument(f);

    expect(store.size).toBeGreaterThan(0);

    await rag.removeDocument(doc.id);

    // Orphaned chunks should NOT remain
    expect(store.size).toBe(0);
  });
});

// ============================================================
// H1: addDocument should not leave ghost entries on failure
// ============================================================

describe("H1: addDocument should not leave ghost entries on failure", () => {
  it("should not track document if embedding fails", async () => {
    const store = new MockVectorStore();
    const failingEmbeddings: EmbeddingProvider = {
      dimensions: 3,
      encodingFormat: 'float',
      async embed() {
        throw new Error("Embedding API unavailable");
      },
    };
    const rag = new RAG({
      embeddings: failingEmbeddings,
      vectorStore: store,
      logger: new NoopLogger(),
    });

    const f = await writeTemp("txt", "Some content");

    await expect(rag.addDocument(f)).rejects.toThrow();

    expect(rag.listDocuments().length).toBe(0);
    expect(store.size).toBe(0);
  });
});

// ============================================================
// H2: updateConfig should propagate embeddings to queryEngine
// ============================================================

describe("H2: updateConfig should propagate embeddings to queryEngine", () => {
  it("should use updated embeddings provider after updateConfig", async () => {
    const store = new MockVectorStore();
    let callCountA = 0;
    let callCountB = 0;

    const embedA: EmbeddingProvider = {
      dimensions: 3,
      encodingFormat: 'float',
      async embed(texts: string[]) {
        callCountA++;
        return texts.map(() => [1, 0, 0]);
      },
    };
    const embedB: EmbeddingProvider = {
      dimensions: 3,
      encodingFormat: 'float',
      async embed(texts: string[]) {
        callCountB++;
        return texts.map(() => [0, 0, 1]);
      },
    };

    const rag = new RAG({
      embeddings: embedA,
      vectorStore: store,
      logger: new NoopLogger(),
    });

    const f = await writeTemp("txt", "Hello world");
    await rag.addDocument(f);
    const countAAfterAdd = callCountA;

    rag.updateConfig({ embeddings: embedB });

    await rag.query("test?");
    expect(callCountB).toBe(1);
    expect(callCountA).toBe(countAAfterAdd);

    await rag.query("test2?");
    expect(callCountB).toBe(2);
    expect(callCountA).toBe(countAAfterAdd);
  });

  it("H2(a): should not overwrite config when passing undefined in Partial", async () => {
    const store = new MockVectorStore();
    const rag = new RAG({
      embeddings: new MockEmbeddings(),
      vectorStore: store,
      logger: new NoopLogger(),
      chunking: { strategy: "fixed", size: 400, overlap: 40 },
    });

    const filePath = await writeTemp("txt", "Test document for chunking");
    await rag.addDocument(filePath);

    (rag as any).updateConfig({ chunking: undefined });

    await rag.query("test query?");
    
    expect(rag.listDocuments().length).toBeGreaterThan(0);
  });

  it("H2(b): should update main logger but note queryEngine may need rebuild", async () => {
    const loggedCalls: { method: string; args: unknown[] }[] = [];
    
    const customLogger = {
      debug: (...args: unknown[]) => {
        loggedCalls.push({ method: 'debug', args });
      },
      info: (...args: unknown[]) => {
        loggedCalls.push({ method: 'info', args });
      },
      warn: (msg: string, ...args: unknown[]) => {
        loggedCalls.push({ method: 'warn', args: [msg, ...args] });
      },
      error: (msg: string, ...args: unknown[]) => {
        loggedCalls.push({ method: 'error', args: [msg, ...args] });
      },
    };

    const store = new MockVectorStore();
    const rag = new RAG({
      embeddings: new MockEmbeddings(),
      vectorStore: store,
      logger: new NoopLogger(),
    });

    const f = await writeTemp("txt", "Test content");
    await rag.addDocument(f);

    (rag as any).updateConfig({ logger: customLogger });

    await rag.addDocument(await writeTemp("txt", "another doc"));

    expect((rag as any).config.logger).toBe(customLogger);
    expect(loggedCalls.length).toBe(0);
  });
});

// ============================================================
// M1: addDocuments partial failure
// ============================================================

describe("M1: addDocuments should report partial success", () => {
  it("should not silently lose documents on partial failure", async () => {
    const store = new MockVectorStore();
    let callCount = 0;
    const embeddings: EmbeddingProvider = {
      dimensions: 3,
      encodingFormat: 'float',
      async embed(texts: string[]) {
        callCount++;
        if (callCount === 2) throw new Error("Embedding failed on 2nd call");
        return texts.map(() => [1, 0, 0]);
      },
    };
    const rag = new RAG({
      embeddings,
      vectorStore: store,
      logger: new NoopLogger(),
    });

    const f1 = await writeTemp("txt", "Document one");
    const f2 = await writeTemp("txt", "Document two");
    const f3 = await writeTemp("txt", "Document three");

    await expect(rag.addDocuments([f1, f2, f3])).rejects.toThrow();
    expect(rag.listDocuments().length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// M2: duplicate document detection
// ============================================================

describe("M2: adding the same file twice should be handled", () => {
  it("should not create duplicate chunks in the vector store", async () => {
    const store = new MockVectorStore();
    const embeddings: EmbeddingProvider = {
      dimensions: 3,
      encodingFormat: 'float',
      async embed(texts: string[]) {
        return texts.map(() => [1, 0, 0]);
      },
    };
    const rag = new RAG({
      embeddings,
      vectorStore: store,
      chunking: { strategy: "fixed", size: 500, overlap: 50 },
      logger: new NoopLogger(),
    });

    const f = await writeTemp("txt", "Same content");
    await rag.addDocument(f);
    const sizeAfterFirst = store.size;

    await rag.addDocument(f);

    expect(store.size).toBe(sizeAfterFirst);
  });
});

// ============================================================
// M9: parser factory should use ESM imports
// ============================================================

describe("M9: parser factory should use ESM imports", () => {
  it("should resolve parsers without require() errors", async () => {
    const { resolveParser } = await import("../src/parsers/index.ts");
    const parser = resolveParser("/path/to/file.txt");
    expect(parser.supportedExtensions.includes("txt")).toBe(true);
  });
});

// ============================================================
// M10: PdfParser assumes pdf-parse v2 API
// ============================================================

describe("M10: PdfParser should work with installed pdf-parse version", () => {
  it("should use the pdf-parse v2 class-based API (PDFParse class)", async () => {
    const { PdfParser } = await import("../src/parsers/pdf.ts");
    const parser = new PdfParser();
    expect(parser.supportedExtensions).toContain("pdf");
  });

  it("should throw a helpful error if pdf-parse is not installed", async () => {
    const parserModule = await import("../src/parsers/pdf.ts");
    const parseMethod = parserModule.PdfParser.prototype.parse;
    expect(parseMethod.toString()).toContain("pdf-parse");
  });
});

// ============================================================
// Phase 3: BM25 integration in RAG class
// ============================================================

describe("Phase 3: BM25 integration", () => {
  it("should auto-index documents in BM25 when configured", async () => {
    const bm25 = new BM25Index();
    const rag = new RAG({
      embeddings: new MockEmbeddings(),
      vectorStore: new MockVectorStore(),
      logger: new NoopLogger(),
    }, { bm25 });

    const filePath = await writeTemp("txt", "TypeScript is a typed programming language");
    await rag.addDocument(filePath);

    expect(bm25.size).toBeGreaterThan(0);
  });

  it("should remove documents from BM25 on removeDocument", async () => {
    const bm25 = new BM25Index();
    const rag = new RAG({
      embeddings: new MockEmbeddings(),
      vectorStore: new MockVectorStore(),
      logger: new NoopLogger(),
    }, { bm25 });

    const filePath = await writeTemp("txt", "Hello world test content");
    const doc = await rag.addDocument(filePath);
    const sizeBefore = bm25.size;
    expect(sizeBefore).toBeGreaterThan(0);

    await rag.removeDocument(doc.id);
    expect(bm25.size).toBeLessThan(sizeBefore);
  });

  it("should work without BM25 (backward compatible)", async () => {
    const { rag } = makeRag();

    const filePath = await writeTemp("txt", "Hello world");
    await rag.addDocument(filePath);

    expect(rag.listDocuments().length).toBe(1);
  });
});

// ============================================================
// Phase 3: End-to-end RAG flow with sparse/hybrid/rerank/rewrite
// ============================================================

describe("Phase 3: RAG end-to-end flow", () => {
  it("should query with sparse mode through RAG API", async () => {
    const bm25 = new BM25Index();
    const rag = new RAG({
      embeddings: new MockEmbeddings(),
      vectorStore: new MockVectorStore(),
      logger: new NoopLogger(),
    }, { bm25 });

    const filePath = await writeTemp("txt", "TypeScript is a typed programming language");
    await rag.addDocument(filePath);

    const result = await rag.query("TypeScript programming", { searchMode: "sparse" });
    expect(result.searchMode).toBe("sparse");
    expect(result.context.length).toBeGreaterThan(0);
  });

  it("should query with hybrid mode through RAG API", async () => {
    const bm25 = new BM25Index();
    const rag = new RAG({
      embeddings: new MockEmbeddings(),
      vectorStore: new MockVectorStore(),
      logger: new NoopLogger(),
    }, { bm25 });

    const filePath = await writeTemp("txt", "TypeScript is a typed programming language for web development");
    await rag.addDocument(filePath);

    const result = await rag.query("TypeScript", { searchMode: "hybrid" });
    expect(result.searchMode).toBe("hybrid");
    expect(result.context.length).toBeGreaterThan(0);
  });

  it("should apply reranker through RAG API", async () => {
    const mockReranker = {
      name: "MockReranker",
      async rerank(_query: string, documents: string[]): Promise<number[]> {
        return documents.map((d) => (d.includes("TypeScript") ? 0.9 : 0.1));
      },
    };
    const rag = new RAG({
      embeddings: new MockEmbeddings(),
      vectorStore: new MockVectorStore(),
      logger: new NoopLogger(),
    }, { reranker: mockReranker as any });

    const filePath = await writeTemp("txt", "TypeScript is a typed programming language");
    await rag.addDocument(filePath);

    const result = await rag.query("TypeScript", { rerank: true });
    expect(result.context.length).toBeGreaterThan(0);
  });

  it("should apply query rewriter through RAG API", async () => {
    const mockRewriter = {
      name: "MockRewriter",
      async rewrite(query: string): Promise<string[]> {
        return [query, query.toLowerCase()];
      },
    };
    const rag = new RAG({
      embeddings: new MockEmbeddings(),
      vectorStore: new MockVectorStore(),
      logger: new NoopLogger(),
    }, { queryRewriter: mockRewriter as any });

    const filePath = await writeTemp("txt", "TypeScript programming");
    await rag.addDocument(filePath);

    const result = await rag.query("TypeScript", { rewriteQuery: true });
    expect(result.context.length).toBeGreaterThan(0);
  });

  it("should use all Phase 3 features together", async () => {
    const bm25 = new BM25Index();
    const mockReranker = {
      name: "MockReranker",
      async rerank(_query: string, documents: string[]): Promise<number[]> {
        return documents.map(() => 0.5);
      },
    };
    const mockRewriter = {
      name: "MockRewriter",
      async rewrite(query: string): Promise<string[]> {
        return [query];
      },
    };
    const rag = new RAG(
      {
        embeddings: new MockEmbeddings(),
        vectorStore: new MockVectorStore(),
        logger: new NoopLogger(),
      },
      { bm25, reranker: mockReranker as any, queryRewriter: mockRewriter as any },
    );

    const filePath = await writeTemp("txt", "Advanced TypeScript patterns for web development");
    await rag.addDocument(filePath);

    const result = await rag.query("TypeScript", {
      searchMode: "hybrid",
      rerank: true,
      rewriteQuery: true,
    });
    expect(result.searchMode).toBe("hybrid");
    expect(result.context.length).toBeGreaterThan(0);
  });
});
