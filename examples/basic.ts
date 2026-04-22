// ============================================================
// rag-typescript — Basic Usage Example
//
// Run with: bun examples/basic.ts
// ============================================================

import { RAG, InMemoryVectorStore, NoopLogger } from "../src/index.ts";

// -- Mock EmbeddingProvider (no API key needed) -----------------
// In production you'd use OpenAICompatibleEmbeddings instead.

class MockEmbeddings {
  readonly dimensions = 4;
  readonly encodingFormat = 'float';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      // Simple deterministic vector from character codes
      const v = [0, 0, 0, 0];
      for (const c of t) v[c.charCodeAt(0) % 4] += c.charCodeAt(0);
      return v.map((x) => x / Math.max(t.length, 1));
    });
  }
}

// -- Mock LLM (no API key needed) -------------------------------
// In production you'd use OpenAICompatibleLLM instead.

class MockLLM {
  async generate(prompt: string): Promise<string> {
    // Echo back a simulated answer
    return `[Mock LLM] Based on the context, here is a simulated answer for the query of "${prompt}".`;
  }
  async *stream(_prompt: string): AsyncIterable<string> { }
}

// -- Main -------------------------------------------------------

async function main() {
  const rag = new RAG({
    embeddings: new MockEmbeddings(),
    vectorStore: new InMemoryVectorStore(),
    chunking: { strategy: "fixed", size: 200, overlap: 20 },
    logger: new NoopLogger(),
  });

  console.log("=== Adding documents ===");

  // Simulate files with inline content (no real files needed)
  const files = [
    {
      path: "intro.txt",
      content: Buffer.from(
        "RAG stands for Retrieval-Augmented Generation. " +
        "It combines information retrieval with large language models. " +
        "The system first retrieves relevant context from a knowledge base, " +
        "then uses an LLM to generate an answer based on that context."
      ),
    },
    {
      path: "architecture.md",
      content: Buffer.from(
        `---
title: Architecture
---

# RAG Architecture

The system has three main components:

1. **Document Manager** — parses files into chunks
2. **Vector Store** — stores embeddings for fast similarity search
3. **Query Engine** — embeds questions and retrieves relevant chunks

Chunks are typically 200-500 tokens with 10-20% overlap.`
      ),
    },
    {
      path: "chunking.txt",
      content: Buffer.from(
        "Chunking splits documents into smaller pieces for embedding. " +
        "Common strategies include fixed-size splitting, recursive splitting " +
        "by semantic boundaries, and markdown-aware splitting that preserves " +
        "headings and code blocks. Overlap between chunks helps maintain context."
      ),
    },
  ];

  const docs = await rag.addDocuments(files);
  console.log(`Added ${docs.length} documents:\n`);
  for (const doc of docs) {
    console.log(`  📄 ${doc.fileName}  (${doc.id.slice(0, 8)}…)`);
  }

  console.log("\n=== Querying ===\n");

  const questions = [
    "What does RAG stand for?",
    "What are the main components?",
    "What chunking strategies are available?",
  ];

  for (const q of questions) {
    const result = await rag.query(q, { topK: 1 });
    console.log(`Q: ${q}`);
    console.log(`   → Found ${result.context.length} result(s)`);
    if (result.context.length > 0) {
      const snippet = result.context[0].content.slice(0, 80);
      console.log(`   → Best match: "${snippet}…"\n`);
    }
  }

  console.log("=== Query & Answer ===\n");

  const { answer, context } = await rag.queryAndAnswer(
    "How does the query engine work?",
    { llm: new MockLLM(), topK: 2 }
  );

  console.log(`Q: How does the query engine work?`);
  console.log(`A: ${answer}`);
  console.log(`   → Used ${context.length} context chunk(s)`);

  console.log("\n=== Done ===");
}

main().catch(console.error);
