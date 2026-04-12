# TypeScript RAG Library - Design Plan

## Overview
A modular TypeScript library for managing Retrieval-Augmented Generation systems, supporting multiple file formats and pluggable components.

---

## 1. Core Architecture

### High-Level Components

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

---

## 2. Module Breakdown

### 2.1 Core Types (`src/types/index.ts`)

```typescript
// Base interfaces
interface RAGConfig { /* ... */ }
interface ChunkOptions { /* ... */ }
interface SearchOptions { /* ... */ }
interface SearchResult { /* ... */ }

// File parser types
interface DocumentParser<T> { /* ... */ }

// Vector store types
interface VectorStore { /* ... */ }

// Embedding types
interface EmbeddingModel { /* ... */ }
```

### 2.2 File Parsing Module (`src/parsers/`)

Support for initial file formats:

| Format | Parser File | Dependencies | Strategy |
|--------|-------------|--------------|----------|
| `.txt` | `parsers/text.ts` | None | Raw text read |
| `.md` | `parsers/markdown.ts` | marked (optional) | Parse + preserve structure |
| `.docx` | `parsers/docx.ts` | mammoth or docx-parser | Extract text content |
| `.pdf` | `parsers/pdf.ts` | pdf-parse or pdfjs-dist | Extract text from pages |

**Factory pattern** for automatic parser selection by extension.

### 2.3 Chunking Module (`src/chunking/`)

Strategies to implement:

- **Fixed-size chunking**: Split by character/token count
- **Recursive chunking**: Split by semantic boundaries (paragraphs → sentences)
- **Markdown-aware chunking**: Preserve headers/code blocks
- **Overlap support**: Configurable overlap between chunks

Config options:
```typescript
chunkSize: number
overlap: number
strategy: 'fixed' | 'recursive' | 'semantic'
maxTokens?: number
```

### 2.4 Embedding Module (`src/embeddings/`)

Interface for pluggable embedding models:

```typescript
interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
  dimensions: number
}
```

Initial implementations to support:
- Local (via Ollama/LiteLLM)
- OpenAI-compatible APIs
- HuggingFace Inference API

### 2.5 Vector Storage Module (`src/storage/`)

Abstract vector store interface with backends:

```typescript
interface VectorStore {
  add(embeddings: number[][], metadatas: Metadata[], ids?: string[]): Promise<void>
  search(query: number[], limit: number, filter?: Filter): Promise<SearchResult[]>
  delete(ids: string[]): Promise<void>
  // Optional: persistence
  save(path: string): Promise<void>
  load(path: string): Promise<void>
}
```

Storage backend options:
- **In-memory**: `InMemoryVectorStore` (default, no dependencies)
- **SQLite**: Better-sqlite3 with FTS/vectors
- **ChromaDB**: Remote/local instance
- **Qdrant/Weaviate**: Advanced options

### 2.6 Query Engine (`src/query/`)

Components:
- **Hybrid search**: Combine dense (vector) + sparse (keyword) search
- **Reranking**: Re-rank results by relevance score
- **Context assembly**: Combine retrieved chunks for LLM prompt

Query flow:
```
User Question → Embedding → Vector Search → Rerank → Context Assembly → Response
```

### 2.7 LLM Provider (`src/llm/`)

Interface for pluggable LLM backends (used by `queryAndAnswer`):

```typescript
interface LLMProvider {
  generate(prompt: string, options?: LLMOptions): Promise<string>
  stream(prompt: string, options?: LLMOptions): AsyncIterable<string>
}
```

Initial implementations:
- OpenAI-compatible API (covers OpenAI, Ollama, vLLM, LiteLLM, etc.)

### 2.8 RAGCore Class (`src/core/RAG.ts`)

Main entry point combining all modules:

```typescript
class RAG {
  constructor(config: RAGConfig);

  // Document management
  addDocument(file: FileInput, options?: DocOptions): Promise<DocumentInfo>;
  addDocuments(files: FileInput[]): Promise<DocumentInfo[]>;
  removeDocument(id: string): Promise<void>;
  listDocuments(): Promise<DocumentInfo[]>;

  // Query operations
  query(question: string, options?: QueryOptions): Promise<QueryResult>;
  queryAndAnswer(question: string, options?: QueryOptions & { llm?: LLMProvider }): Promise<{ answer: string; context: SearchResult[] }>;

  // Configuration
  updateConfig(partial: Partial<RAGConfig>): void;
}
```

---

## 3. Proposed Project Structure

```
rag-typescript/
├── src/
│   ├── index.ts                  # Public API exports
│   ├── types/
│   │   └── index.ts              # Shared type definitions
│   ├── core/
│   │   ├── RAG.ts                # Main RAG class
│   │   └── utils.ts              # Common utilities
│   ├── parsers/
│   │   ├── index.ts              # Parser factory
│   │   ├── base.ts               # Abstract parser
│   │   ├── text.ts               # .txt parser
│   │   └── markdown.ts           # .md parser
│   ├── chunking/
│   │   ├── index.ts
│   │   └── strategies.ts         # Chunking strategies
│   ├── embeddings/
│   │   ├── index.ts
│   │   └── openai-compatible.ts  # OpenAI-compatible provider
│   ├── storage/
│   │   ├── index.ts
│   │   └── in-memory.ts          # In-memory vector store
│   ├── llm/
│   │   ├── index.ts
│   │   └── openai-compatible.ts  # OpenAI-compatible LLM provider
│   ├── query/
│   │   ├── index.ts
│   │   └── engine.ts             # Query engine
│   ├── errors/
│   │   └── index.ts              # Custom error types
│   └── logger/
│       └── index.ts              # Logger interface
├── tests/
│   ├── parsers/
│   ├── chunking/
│   ├── embeddings/
│   ├── storage/
│   ├── llm/
│   └── integration/
├── examples/
│   └── basic.ts                  # Simple usage example
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
```

**Note:** Phase 1 includes only the minimal set above. DOCX/PDF parsers, additional embedding providers, and persistent vector stores are deferred to later phases.

---

## 4. Key Dependencies

### Required
- `uuid`: For document/chunk ID generation

### Optional peer dependencies (installed by user as needed)
- `openai`: OpenAI-compatible API client (embeddings + LLM)
- `mammoth`: DOCX parsing (Phase 2+)
- `pdf-parse` or `pdfjs-dist`: PDF parsing (Phase 2+)
- `marked`: Markdown structure-aware chunking (optional)
- `better-sqlite3`: SQLite vector storage (Phase 3+)

**Strategy:** Parser backends for heavy formats (DOCX, PDF) are loaded via dynamic `import()` so the core library remains lightweight. Users only install what they need.

---

## 4.1 Error Handling

Custom error types for clear, actionable feedback:

```typescript
class RAGError extends Error {}
class ParseError extends RAGError {}
class EmbeddingError extends RAGError {}
class VectorStoreError extends RAGError {}
class LLMError extends RAGError {}
```

All public methods should catch internal errors and re-throw as the appropriate `RAGError` subclass with context.

## 4.2 Logging / Telemetry

Minimal logger interface — no hard dependency on any logging library:

```typescript
interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}
```

- A `NoopLogger` is the default (zero output).
- Users can plug in `pino`, `winston`, `console`, or their own implementation.
- Internal components receive the logger via config and use it for diagnostics.

---

## 5. Implementation Phases

### Phase 1: MVP (Week 1-2)
- [ ] Core types and interfaces
- [ ] Text (.txt) and Markdown (.md) parsers only
- [ ] Basic fixed-size chunking only
- [ ] OpenAI-compatible embedding provider (covers Ollama, vLLM, etc.)
- [ ] In-memory vector store only (no persistent backends)
- [ ] OpenAI-compatible LLM provider
- [ ] Custom error types (`RAGError` hierarchy)
- [ ] Logger interface + `NoopLogger` default
- [ ] Basic RAG class with `addDocument()` and `query()`

### Phase 2: Extended Formats (Week 3)
- [ ] DOCX parser (peer dep, dynamic import)
- [ ] PDF parser (peer dep, dynamic import)
- [ ] Recursive chunking strategy
- [ ] Markdown-aware chunking

### Phase 3: Advanced Storage & Search (Week 4+)
- [ ] Multiple vector store backends (SQLite, ChromaDB, Qdrant)
- [ ] Hybrid search (dense + BM25)
- [ ] Reranking support
- [ ] Persistent storage
- [ ] Query rewriting

### Phase 4: Polish (Week 5+)
- [ ] Comprehensive tests
- [ ] Documentation & examples
- [ ] TypeScript declaration files
- [ ] Performance optimizations
- [ ] CLI tool (optional)

---

## 6. API Usage Example

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

// Add files
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

---

## 7. Design Decisions / Trade-offs

| Decision | Options Considered | Final Choice | Rationale |
|----------|-------------------|--------------|-----------|
| Storage Backend | SQL vs NoSQL vs Graph | SQLite default | Zero-setup, local-first |
| Chunking | By tokens vs chars | Both (configurable) | Flexibility across models |
| File Upload | Sync vs Async | Async streams | Memory efficiency for large files |
| Embeddings | Built-in vs External | External (pluggable) | Model-agnostic, future-proof |
| Similarity | Cosine vs Dot Product | Cosine (default) | Better normalization |

---

## 8. Potential Future Extensions

- Streaming document ingestion
- Incremental updates/upserts
- Multi-language support with translation
- Metadata filtering and faceted search
- Caching layer for frequent queries
- Web UI for document management
- Rate limiting and quotas for API usage
- Observability: tracing, metrics, logs
- Fine-tuning pipeline integration

---

## Next Steps

1. Review this plan for gaps or changes
2. Set up the project scaffolding with pnpm/npm
3. Start implementing Phase 1 (MVP)
4. Write tests alongside each component
5. Gather feedback on API ergonomics

Would you like me to start implementing this? Or would you prefer to modify the plan first?
