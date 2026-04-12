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

### 2.7 RAGCore Class (`src/core/RAG.ts`)

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
  queryAndAnswer(question: string, options?: QueryOptions): Promise<{ answer: string; context: SearchResult[] }>;
  
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
│   │   ├── markdown.ts           # .md parser
│   │   ├── docx.ts               # .docx parser
│   │   └── pdf.ts                # .pdf parser
│   ├── chunking/
│   │   ├── index.ts
│   │   ├── strategies.ts         # Chunking strategies
│   │   └── utils.ts              # Token counting, etc.
│   ├── embeddings/
│   │   ├── index.ts
│   │   ├── providers.ts          # Provider abstract class
│   │   ├── openai.ts             # OpenAI embedding
│   │   ├── ollama.ts             # Ollama embedding
│   │   └── huggingface.ts        # HF Inference API
│   ├── storage/
│   │   ├── index.ts
│   │   ├── base.ts               # VectorStore interface
│   │   ├── in-memory.ts          # Simple in-memory store
│   │   ├── sqlite.ts             # SQLite backend (optional)
│   │   └── chroma.ts             # ChromaDB backend (optional)
│   └── query/
│       ├── index.ts
│       ├── engine.ts             # Query engine
│       └── reranker.ts           # Result reranking
├── tests/
│   ├── parsers/
│   ├── chunking/
│   ├── embeddings/
│   ├── storage/
│   └── integration/
├── examples/
│   ├── basic-query.ts            # Simple usage example
│   ├── multi-file.ts             # Multiple file sources
│   ├── custom-embedding.ts       # Custom embedding model
│   └── advanced-query.ts         # Hybrid search + reranking
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
```

---

## 4. Key Dependencies

### Required
- `uuid`: For document/chunk ID generation
- `dotenv`: For environment configuration

### Optional (by feature)
- `mammoth`: DOCX parsing
- `pdf-parse` or `@pdf-lib/...`: PDF parsing
- `marked`: Markdown parsing (optional)
- `better-sqlite3`: SQLite vector storage
- `openai`: Official OpenAI SDK
- `axios`: Generic HTTP client for APIs

---

## 5. Implementation Phases

### Phase 1: MVP (Week 1-2)
- [ ] Core types and interfaces
- [ ] Text (.txt) and Markdown (.md) parsers
- [ ] Basic fixed-size chunking
- [ ] OpenAI embedding provider
- [ ] In-memory vector store with cosine similarity
- [ ] Basic RAG class with addDocument() and query()

### Phase 2: Extended Formats (Week 3)
- [ ] DOCX parser
- [ ] PDF parser
- [ ] Recursive chunking strategy
- [ ] Ollama embedding provider

### Phase 3: Advanced Features (Week 4+)
- [ ] Multiple vector store backends (SQLite, ChromaDB)
- [ ] Hybrid search (dense + BM25)
- [ ] Reranking support
- [ ] Full-text query generation (query rewriting)
- [ ] Persistent storage

### Phase 4: Polish (Week 5+)
- [ ] Comprehensive tests
- [ ] Documentation examples
- [ ] TypeScript declaration files
- [ ] Performance optimizations
- [ ] CLI tool (optional)

---

## 6. API Usage Example

```typescript
import { RAG, OpenAIEmbeddings, InMemoryVectorStore } from 'rag-typescript';

// Initialize
const rag = new RAG({
  embeddings: new OpenAIEmbeddings({ apiKey: process.env.OPENAI_API_KEY }),
  vectorStore: new InMemoryVectorStore(),
  chunking: { strategy: 'recursive', size: 500, overlap: 50 },
});

// Add files
await rag.addDocuments([
  './docs/intro.txt',
  './docs/guide.md',
  './reports/quarterly.docx',
  './specs/api.pdf',
]);

// Query
const result = await rag.query('What is the main feature?', {
  topK: 3,
  scoreThreshold: 0.7,
});

console.log(result.context); // Retrieved chunks
console.log(result.scores);  // Relevance scores

// With answer generation
const { answer, context } = await rag.queryAndAnswer(
  'How do I configure the API endpoint?',
  { llm: myLLMClient }
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
