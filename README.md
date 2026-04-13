# rag-typescript

A modular TypeScript library for managing **Retrieval-Augmented Generation (RAG)** systems. Supports multiple file formats, pluggable embedding/LLM providers, and flexible vector store backends.

## Features

- **Pluggable architecture** — swap embedding models, LLM providers, and vector stores independently
- **Multi-format document parsing** — `.txt`, `.md` (Phase 1); `.docx`, `.pdf` (Phase 2+)
- **Flexible chunking** — fixed-size strategy with configurable overlap; recursive & semantic planned
- **OpenAI-compatible API support** — works with OpenAI, Ollama, vLLM, LiteLLM, and any compatible endpoint
- **Zero-setup defaults** — in-memory vector store with cosine similarity and JSON persistence
- **Fully typed** — end-to-end TypeScript with declaration files and strict mode

## Installation

```bash
npm install rag-typescript
```

### Peer dependencies

For production usage you'll typically also install:

```bash
npm install openai          # required for embedding & LLM providers
```

Additional optional dependencies (Phase 2+):

```bash
npm install mammoth         # .docx parsing
npm install pdf-parse       # .pdf parsing
npm install marked          # markdown-aware chunking
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

// Add documents
await rag.addDocuments([
  './docs/intro.txt',
  './docs/guide.md',
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
| `removeDocument(id)` | Remove a document from tracking (note: chunks remain in vector store) |
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

> **Note:** Currently only `'fixed'` strategy is implemented. `'recursive'` and `'semantic'` will throw `ChunkingError`.

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
│   ├── index.ts              # Parser factory
│   ├── base.ts               # Abstract parser
│   ├── text.ts               # .txt parser
│   └── markdown.ts           # .md parser
├── chunking/
│   ├── index.ts
│   └── strategies.ts         # Chunking strategies
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

Phase 1 ships with **89 tests** covering all modules:

| Module | Tests | Coverage |
|--------|-------|----------|
| Errors | 10 | Hierarchy, cause propagation |
| Logger | 3 | NoopLogger, custom implementations |
| Chunking | 11 | Fixed strategy, validation, unimplemented strategies |
| Parsers | 15 | TextParser, MarkdownParser, front-matter, factory |
| Storage | 12 | CRUD, cosine search, filtering, persistence |
| Embeddings | 7 | Config, mocked API calls, error handling |
| LLM | 9 | Generate, streaming, error handling |
| Query Engine | 5 | Retrieval, threshold filtering, answer generation |
| RAG Core | 11 | Document management, query, config updates |
| Integration | 6 | Full addDocument → query flow with real store |

API providers use **mocked `fetch`** — no network calls during tests.

## Known Limitations

- **Chunking:** Only `'fixed'` strategy is implemented. `'recursive'` and `'semantic'` throw errors.
- **Document removal:** `removeDocument()` removes from internal tracking but does **not** delete chunks from the vector store.
- **Metadata filtering:** Exact-match only; no range queries, operators, or regex support.
- **Logger:** Only `NoopLogger` is provided; no console or file logger implementation yet.
- **Parser coverage:** Only `.txt`, `.md`, and `.markdown` files are supported.

## Roadmap

| Phase | Status | Highlights |
|-------|--------|------------|
| **Phase 1: MVP** | ✅ Complete | Text/MD parsers, fixed chunking, OpenAI-compatible providers, in-memory store, 89 tests |
| **Phase 2: Extended Formats** | Planned | DOCX/PDF parsers, recursive & markdown-aware chunking |
| **Phase 3: Advanced Storage** | Planned | SQLite, ChromaDB, Qdrant backends; hybrid search; reranking |
| **Phase 4: Polish** | Planned | CLI tool, performance optimizations |

## License

MIT
