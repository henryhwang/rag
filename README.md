# rag-typescript

A modular TypeScript library for managing **Retrieval-Augmented Generation (RAG)** systems. Supports multiple file formats, pluggable embedding/LLM providers, and flexible vector store backends.

## Features

- **Pluggable architecture** — swap embedding models, LLM providers, and vector stores independently
- **Multi-format document parsing** — `.txt`, `.md`, `.docx`, `.pdf` with lazy-loaded optional parsers
- **Flexible chunking** — fixed-size, recursive (paragraphs → sentences), and markdown-aware (headings, code blocks)
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

Additional optional peer dependencies:

```bash
npm install openai          # required for embedding & LLM providers
```

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
  strategy: 'fixed' | 'recursive' | 'semantic';
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
chunking: { strategy: 'semantic', size: 500, overlap: 50 }
```

### Search Options

```typescript
interface SearchOptions {
  topK: number;
  scoreThreshold: number;
  filter?: Filter;
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
│   ├── RAG.ts                # Main RAG class
│   └── utils.ts              # Common utilities
├── parsers/
│   ├── index.ts              # Parser factory (lazy-loads optional parsers)
│   ├── base.ts               # Abstract parser
│   ├── text.ts               # .txt parser
│   ├── markdown.ts           # .md parser
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
│   └── in-memory.ts          # In-memory vector store
├── llm/
│   ├── index.ts
│   └── openai-compatible.ts  # OpenAI-compatible LLM provider
├── query/
│   ├── index.ts
│   └── engine.ts             # Query engine
├── examples/
│   └── basic.ts                  # Runnable end-to-end demo
├── tests/
│   ├── errors.test.ts
│   ├── chunking.test.ts
│   ├── parsers.test.ts
│   └── ...                       # 89 tests total
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
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

The project ships with **139 tests** across 12 test files:

| Module | Tests | Coverage |
|--------|-------|----------|
| Errors | 10 | Hierarchy, cause propagation |
| Logger | 3 | NoopLogger, custom implementations |
| Chunking | 21 | Fixed, recursive, and markdown-aware strategies; overlap behavior |
| Parsers | 17 | TextParser, MarkdownParser, DocxParser, PdfParser, factory |
| Storage | 16 | CRUD, cosine search, filtering, persistence, validation |
| Embeddings | 9 | Config, mocked API calls, error handling, dimensions, response validation |
| LLM | 11 | Generate, streaming, error handling, empty responses |
| Query Engine | 12 | Retrieval, threshold filtering, answer generation, injection safety |
| RAG Core | 18 | Document management, query, config updates, duplicate detection, cleanup |
| Integration | 6 | Full addDocument → query flow with real store |

API providers use **mocked `fetch`** — no network calls during tests.

## Known Limitations

- **Metadata filtering:** Exact-match only; no range queries, operators, or regex support.
- **Logger:** Only `NoopLogger` is provided; no console or file logger implementation yet.
- **DOCX parsing:** Requires `mammoth` peer dependency — installed automatically via `bun add mammoth`.
- **PDF parsing:** Requires `pdf-parse` peer dependency — installed automatically via `bun add pdf-parse`.

## Roadmap

| Phase | Status | Highlights |
|-------|--------|------------|
| **Phase 1: MVP** | ✅ Complete | Text/MD parsers, fixed chunking, OpenAI-compatible providers, in-memory store |
| **Phase 2: Extended Formats** | ✅ Complete | DOCX/PDF parsers, recursive & markdown-aware chunking, 139 tests |
| **Phase 3: Advanced Storage** | Planned | SQLite, ChromaDB, Qdrant backends; hybrid search; reranking |
| **Phase 4: Polish** | Planned | CLI tool, performance optimizations |

## License

MIT
