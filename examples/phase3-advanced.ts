// ============================================================
// rag-typescript — Phase 3 Features Example
//
// Demonstrates:
//   1. BM25 sparse (keyword) search
//   2. Hybrid search (dense vector + BM25 fusion)
//   3. Reciprocal Rank Fusion (RRF)
//   4. Reranking search results
//   5. Query rewriting / expansion
//
// Run with: bun examples/phase3-advanced.ts
// ============================================================

import {
  RAG,
  BM25Index,
  SimpleQueryRewriter,
  InMemoryVectorStore,
  NoopLogger,
} from "../src/index.ts";

// -- Mock EmbeddingProvider -------------------------------------

class MockEmbeddings {
  readonly encodingFormat = "float"
  readonly dimensions = 4;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = [0, 0, 0, 0];
      for (const c of t) v[c.charCodeAt(0) % 4] += c.charCodeAt(0);
      return v.map((x) => x / Math.max(t.length, 1));
    });
  }
}

// -- Mock LLM ---------------------------------------------------

class MockLLM {
  async generate(prompt: string): Promise<string> {
    return `[Mock LLM] Answer based on retrieved context for the query of "${prompt}".`;
  }
  async *stream(_prompt: string): AsyncIterable<string> { }
}

// -- Main -------------------------------------------------------

async function main() {
  // -- Setup: BM25 index + Query Rewriter ----------------------

  const bm25 = new BM25Index();
  const rewriter = new SimpleQueryRewriter();

  const rag = new RAG(
    {
      embeddings: new MockEmbeddings(),
      vectorStore: new InMemoryVectorStore(),
      chunking: { strategy: "fixed", size: 200, overlap: 20 },
      logger: new NoopLogger(),
      sparseSearch: bm25,
      queryRewriter: rewriter
    },
  );

  console.log("=== Adding documents ===\n");

  const files = [
    {
      path: "typescript-intro.txt",
      content: Buffer.from(
        "TypeScript is a strongly typed programming language that builds on JavaScript. " +
        "It adds static type checking, interfaces, generics, and modern language features. " +
        "TypeScript compiles down to plain JavaScript that runs in any browser or Node.js environment."
      ),
    },
    {
      path: "python-intro.txt",
      content: Buffer.from(
        "Python is a high-level, interpreted programming language known for readability. " +
        "It supports multiple paradigms including procedural, object-oriented, and functional programming. " +
        "Python is widely used in data science, machine learning, and web development."
      ),
    },
    {
      path: "api-design.txt",
      content: Buffer.from(
        "RESTful API design follows principles of statelessness, resource-oriented URLs, " +
        "and standard HTTP methods. Good API design includes proper error handling, " +
        "versioning, pagination, rate limiting, and comprehensive documentation. " +
        "TypeScript helps define clear API contracts with interfaces and types."
      ),
    },
  ];

  const docs = await rag.addDocuments(files);
  console.log(`Added ${docs.length} documents (also indexed in BM25):\n`);
  for (const doc of docs) {
    console.log(`  📄 ${doc.fileName}`);
  }

  // -- 1. Dense Search (vector similarity) ---------------------

  console.log("\n=== 1. Dense Search (default) ===\n");

  let result = await rag.query("typed programming language", {
    topK: 2,
  });
  console.log(`Q: "typed programming language"`);
  console.log(`   Mode: ${result.searchMode}`);
  for (const r of result.context) {
    const snippet = r.content.slice(0, 70);
    console.log(`   [score ${r.score.toFixed(3)}] "${snippet}…"`);
  }

  // -- 2. Sparse Search (BM25 keyword matching) ----------------

  console.log("\n=== 2. Sparse Search (BM25 keywords) ===\n");

  result = await rag.query("TypeScript interface generics", {
    searchMode: "sparse",
    topK: 2,
  });
  console.log(`Q: "TypeScript interface generics"`);
  console.log(`   Mode: ${result.searchMode}`);
  for (const r of result.context) {
    const snippet = r.content.slice(0, 70);
    console.log(`   [score ${r.score.toFixed(3)}] "${snippet}…"`);
  }

  // -- 3. Hybrid Search (dense + sparse fusion) ----------------

  console.log("\n=== 3. Hybrid Search ===\n");

  result = await rag.query("API design TypeScript", {
    searchMode: "hybrid",
    topK: 2,
    denseWeight: 0.5, // 50% vector, 50% keyword
  });
  console.log(`Q: "API design TypeScript"`);
  console.log(`   Mode: ${result.searchMode}`);
  for (const r of result.context) {
    const snippet = r.content.slice(0, 70);
    console.log(`   [score ${r.score.toFixed(3)}] "${snippet}…"`);
  }

  // -- 4. Query Rewriting (expand query for better recall) ------

  console.log("\n=== 4. Query Rewriting ===\n");

  // See what the rewriter produces
  const variants = await rewriter.rewrite("How to configure API endpoints");
  console.log(`Original: "How to configure API endpoints"`);
  console.log(`Rewritten to ${variants.length} variants:`);
  for (let i = 0; i < variants.length; i++) {
    console.log(`   ${i + 1}. "${variants[i]}"`);
  }

  // Use it through the RAG API
  result = await rag.query("data science", {
    rewriteQuery: true,
    topK: 1,
  });
  console.log(`\nQ: "data science" (with rewriting)`);
  console.log(`   Mode: ${result.searchMode}`);
  if (result.context.length > 0) {
    const snippet = result.context[0].content.slice(0, 70);
    console.log(`   → "${snippet}…"`);
  }

  // -- 5. Query & Answer with Phase 3 features ----------------

  console.log("\n=== 5. Query & Answer ===\n");

  const mockLLM = new MockLLM();
  const { answer, context } = await rag.queryAndAnswer(
    "What programming languages are discussed?",
    {
      llm: mockLLM,
      searchMode: "hybrid",
      topK: 2,
      rewriteQuery: true,
    },
  );

  console.log(`Q: "What programming languages are discussed?"`);
  console.log(`A: ${answer}`);
  console.log(`   → Used ${context.length} context chunk(s)`);

  console.log("\n=== Done ===");
}

main().catch(console.error);
