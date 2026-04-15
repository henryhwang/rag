# rag-typescript

A modular TypeScript library for managing **Retrieval-Augmented Generation (RAG)** systems. Supports multiple file formats, pluggable embedding/LLM providers, and flexible vector store backends.

## Features

- **Pluggable architecture** — swap embedding models, LLM providers, and vector stores independently
- **Multi-format document parsing** — `.txt`, `.md`, `.docx`, `.pdf` with lazy-loaded optional parsers
- **Flexible chunking** — fixed-size, recursive (paragraphs → sentences), and markdown (headings, code blocks)
- **OpenAI-compatible API support** — works with OpenAI, Ollama, vLLM, LiteLLM, and any compatible endpoint
- **Zero-setup defaults** — in-memory vector store with cosine similarity and JSON persistence
- **Fully typed** — end-to-end TypeScript with declaration files and strict mode

## Installation

```bash
npm install rag-typescript
```

### Optional dependencies

Install only the parsers you need:

```bash
npm install mammoth         # .docx parsing (optional)
npm install pdf-parse       # .pdf parsing (optional)
```

The library uses native `fetch()` for all API calls — no SDK required.

## Quick Start

```typescript
import {
  RAG,
  OpenAICompatibleEmbeddings,
  OpenAICompatibleLLM,
  InMemoryVectorStore,
} from 'rag-typescript';

// Initialize
const rag = new RAG({
  embeddings: new OpenAICompatibleEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.EMBEDDING_BASE_URL, // optional — works with Ollama too
  }),
  vectorStore: new InMemoryVectorStore(),
  chunking: { strategy: 'fixed', size: 500, overlap: 50 },
});

// Add documents — now supports .txt, .md, .docx, and .pdf
await rag.addDocuments([
  './docs/intro.txt',
  './docs/guide.md',
  './docs/report.docx',   // requires mammoth
  './docs/manual.pdf',    // requires pdf-parse
]);

// Retrieve context
const result = await rag.query('What is the main feature?', {
  topK: 3,
  scoreThreshold: 0.7,
});

console.log(result.context); // Retrieved chunks

// With answer generation (requires LLM provider)
const { answer, context } = await rag.queryAndAnswer(
  'How do I configure the API endpoint?',
  {
    llm: new OpenAICompatibleLLM({
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-mini',
    }),
  }
);
```

## Running the Example

A fully working end-to-end demo is included at `examples/basic.ts`.
It uses mock components — no API key required:

```bash
bun examples/basic.ts
```

Swap `MockEmbeddings` and `MockLLM` for `OpenAICompatibleEmbeddings`
and `OpenAICompatibleLLM` with real credentials to get actual semantic retrieval.

## API Reference

### `RAG`

Main entry point combining all modules.

#### Constructor

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `config.embeddings` | `EmbeddingProvider` | Yes | Embedding model provider |
| `config.vectorStore` | `VectorStore` | Yes | Vector storage backend |
| `config.chunking` | `ChunkOptions` | No | Chunking strategy and options |
| `config.logger` | `Logger` | No | Logger instance (defaults to `NoopLogger`) |

#### Methods

| Method | Description |
|--------|-------------|
| `addDocument(file)` | Parse, chunk, and embed a single file |
| `addDocuments(files)` | Batch-add multiple files (sequential) |
| `removeDocument(id)` | Remove a document and its chunks from the vector store |
| `listDocuments()` | List all ingested documents |
| `query(question, options?)` | Retrieve relevant chunks |
| `queryAndAnswer(question, options)` | Retrieve context and generate an answer (requires `options.llm`) |
| `updateConfig(partial)` | Update configuration at runtime |

### Chunking Options

```typescript
interface ChunkOptions {
  strategy: 'fixed' | 'recursive' | 'markdown';
  size: number;
  overlap: number;
  maxTokens?: number;
}
```

**Examples:**

```typescript
// Fixed-size: split every 500 characters with 50-char overlap
chunking: { strategy: 'fixed', size: 500, overlap: 50 }

// Recursive: split by paragraphs → sentences → fixed-size fallback
chunking: { strategy: 'recursive', size: 500, overlap: 50 }

// Markdown-aware: preserve headings, never split code blocks
chunking: { strategy: 'markdown', size: 500, overlap: 50 }
```

### Search Options

```typescript
interface SearchOptions {
  topK?: number;
  scoreThreshold?: number;
  filter?: Filter;
  /** 'dense' (vector), 'sparse' (BM25), or 'hybrid' (combined). Default: 'dense'. */
  searchMode?: 'dense' | 'sparse' | 'hybrid';
  /** Weight for dense results in hybrid mode (0–1). Default: 0.5. */
  denseWeight?: number;
}
```

```typescript
interface QueryOptions extends SearchOptions {
  llm?: LLMProvider;
  systemPrompt?: string;
  /** Apply reranker after search. Requires a configured reranker. */
  rerank?: boolean;
  /** Expand query for better recall. Requires a configured query rewriter. */
  rewriteQuery?: boolean;
}
```

> **Note:** Metadata filtering currently supports exact-match only (no ranges, operators, or regex).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      RAGLibrary                             │
│                    (Main API Interface)                     │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
   │ Document     │    │ Vector       │    │ Query        │
   │ Manager      │    │ Store        │    │ Engine       │
   └──────────────┘    └──────────────┘    └──────────────┘
          │                   │                   │
          ▼                   ▼                   ▼
   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
   │ File         │    │ Embedding    │    │ Prompt       │
   │ Parsers      │    │ Service      │    │ Template     │
   └──────────────┘    └──────────────┘    └──────────────┘
```

## Project Structure

```
src/
├── index.ts                  # Public API exports
├── core/
│   ├── RAG.ts                # Main RAG class (with Phase 3 support)
│   └── utils.ts              # Common utilities
├── parsers/
│   ├── index.ts              # Parser factory (lazy-loads optional parsers)
│   ├── base.ts               # Abstract parser with shared utilities
│   ├── text.ts               # .txt parser
│   ├── markdown.ts           # .md parser (+ stripFrontMatter utility)
│   ├── docx.ts               # .docx parser (mammoth, optional)
│   └── pdf.ts                # .pdf parser (pdf-parse, optional)
├── chunking/
│   ├── index.ts
│   └── strategies.ts         # Fixed, recursive, and markdown-aware strategies
├── embeddings/
│   ├── index.ts
│   └── openai-compatible.ts  # OpenAI-compatible provider
├── storage/
│   ├── index.ts
│   ├── in-memory.ts          # In-memory vector store
│   └── sqlite.ts             # SQLite vector store (via @libsql/client)
├── llm/
│   ├── index.ts
│   └── openai-compatible.ts  # OpenAI-compatible LLM provider
├── search/
│   ├── index.ts
│   ├── bm25.ts               # BM25 sparse keyword search
│   └── hybrid.ts             # Score fusion + Reciprocal Rank Fusion
├── reranking/
│   ├── index.ts
│   └── openai-compatible.ts  # LLM-based reranker
├── query/
│   ├── index.ts
│   ├── engine.ts             # Query engine (dense/sparse/hybrid + rerank/rewrite)
│   └── rewrite/
│       ├── index.ts
│       ├── simple-rewriter.ts    # Rule-based query expansion
│       └── llm-rewriter.ts       # LLM-powered query expansion
├── types/
│   └── index.ts              # Shared type definitions
├── errors/
│   └── index.ts              # Custom error hierarchy
├── logger/
│   └── index.ts              # Logger interface + NoopLogger
└── index.ts
examples/
├── basic.ts                  # Simple end-to-end demo
└── phase3-advanced.ts        # Phase 3 features demo
tests/                        # 294 tests across 21 files
├── bm25.test.ts
├── chunking.test.ts
├── core.test.ts
├── embeddings.test.ts
├── engine.test.ts
├── errors.test.ts
├── hybrid.test.ts
├── index.test.ts
├── integration.test.ts
├── llm.test.ts
├── logger.test.ts
├── parsers.test.ts
├── rag.test.ts
├── reranker.test.ts
├── rewriter.test.ts
├── search.test.ts
├── simple-rewriter.test.ts
├── sqlite-store.test.ts
├── storage.test.ts
└── vector-store.test.ts
```

## Development

```bash
npm run build     # Compile TypeScript
npm run dev       # Watch mode
npm run clean     # Remove dist
npm run lint      # Type-check only
npm test          # Run tests (Bun)
npm run test:watch  # Watch mode
```

## Test Coverage

The project ships with **294 tests** across 21 test files:

| Module | Tests | Coverage |
|--------|-------|----------|
| Errors | 10 | Hierarchy, cause propagation |
| Logger | 3 | NoopLogger, custom implementations |  
| Chunking | 27 | Fixed, recursive, markdown strategies, overlap edge cases |
| Parsers | 33 | All parsers + stripFrontMatter utility, factory, buffer handling |
| Storage (InMemory) | 38 | CRUD, cosine search, filtering, persistence |
| Storage (SQLite) | 18 | Add, search, delete, persistence, corruption handling |
| BM25 Search | 23 | Construction, add/remove, search, scoring properties |
| Hybrid Fusion | 16 | Score normalization, RRF, edge cases, weight tuning |
| Query Engine | 21 | Dense/sparse/hybrid search, reranking, query rewriting |
| Embeddings | 9 | Config, mocked API calls, error handling |
| LLM | 11 | Generate, streaming, error handling |
| Reranker | 13 | Score parsing, normalization, API errors, batching |
| Query Rewriters | 18 | Simple rewriter variants, LLM rewriter (dedup, stripping) || RAG Core | 32 | Document management, query, config updates |
| Integration | 6 | Full addDocument → query flow with real store |

API providers use **mocked `fetch`** — no network calls during tests.


## Known Limitations

- **Metadata filtering:** Exact-match only; no range queries, operators, or regex support.
- **Logger:** Only `NoopLogger` is provided; no console or file logger implementation yet.
- **DOCX parsing:** Requires `mammoth` peer dependency.
- **PDF parsing:** Requires `pdf-parse` peer dependency.
- **SQLite vector store:** Uses `@libsql/client` (pure TS, works in Bun and Node.js).

### Utility Functions

**`stripFrontMatter(text: string) ⇒ string`**

Remove YAML frontmatter from markdown content without instantiating a parser:

```typescript
import { stripFrontMatter } from 'rag-typescript';

const cleanContent = stripFrontMatter(markdownTextWithYaml);
```


## Roadmap

| Phase | Status | Highlights |
|-------|--------|------------|
| **Phase 1: MVP** | ✅ Complete | Text/MD parsers, fixed chunking, OpenAI-compatible providers, in-memory store |
| **Phase 2: Extended Formats** | ✅ Complete | DOCX/PDF parsers, recursive & markdown-aware chunking |
| **Phase 3: Advanced Storage & Search** | ✅ Complete | SQLite store (libsql), BM25, hybrid search, reranking, query rewriting |
| **Phase 4: Polish** | Planned | CLI tool, performance optimizations |

## License

MIT
