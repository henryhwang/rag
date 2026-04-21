# SQLite Vector Store Guide

Comprehensive guide to understanding and using `SQLiteVectorStore` effectively.

---

## Overview

`SQLiteVectorStore` is a persistent vector storage solution that:
- Stores embeddings in a SQLite database (disk or memory)
- Works with Bun and Node.js (no native compilation needed via `@libsql/client`)
- Computes cosine similarity in TypeScript (not SQL)
- Validates embedding dimensions to prevent data corruption

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SQLite Database                          │
├─────────────────────────────────────────────────────────────┤
│  _schema table                    embeddings table          │
│  ┌──────────────────────────┐    ┌───────────────────────┐ │
│  │ key      │ value         │    │ id │ embedding | metadata│
│  ├──────────────────────────┤    ├─────────────────────────┤ │
│  │ version    1             │    ├─────────────────────────┤ │
│  │ dimension  1536          │    ├─────────────────────────┤ │
│  │ model     "auto-detected"│                                │
│  │ created_at ...           │                                │
│  │ updated_at ...           │                                │
│  └──────────────────────────┘    └───────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↑
                  Hybrid caching layer
        All records loaded into memory for fast search
```

**Key Design Decisions:**

1. **Two tables**: `_schema` (metadata) + user table (embeddings)
2. **JSON storage**: Embeddings stored as JSON arrays, not binary
3. **In-memory search**: All records cached in RAM for fast filtering/scoring
4. **Dimension validation**: Prevents mixing different embedding models

---

## Configuration

### Constructor Options

```typescript
import { SQLiteVectorStore } from '../src/storage/index.ts';

const store = new SQLiteVectorStore({
  // Database URL
  url: 'file:my-store.db',        // Disk persistence
  // url: 'file::memory:',         // In-memory (ephemeral) - default
  // url: 'file:./path/to/db.db',  // Custom path
  
  // Optional custom table name
  tableName: 'embeddings',        // Default
  
  // Optional logger
  logger: { 
    debug: console.log, 
    info: console.log,
    warn: console.warn, 
    error: console.error 
  },
});
```

### Database URL Formats

| URL Format | Description | Use Case |
|------------|-------------|----------|
| `file:my.db` | File-based, relative path | Production |
| `file:/abs/path.db` | Absolute path | Shared systems |
| `file::memory:` | In-memory only | Testing |
| `file:shared.db?mode=ro` | Read-only mode | Distribution |

---

## Usage Patterns

### Pattern 1: Basic Indexing

```typescript
import { RAG, SQLiteVectorStore, OpenAICompatibleEmbeddings } from '../src/index.ts';

// Initialize
const store = new SQLiteVectorStore({
  url: 'file:knowledge-base.db',
});

const rag = new RAG({
  embeddings: new OpenAICompatibleEmbeddings({
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
  }),
  vectorStore: store,
  chunking: { strategy: 'fixed', size: 500, overlap: 50 },
});

// Add documents
await rag.addDocuments(['doc1.md', 'doc2.md']);

// Query
const results = await rag.query('How do I authenticate?', { topK: 3 });
console.log(results.context);
```

### Pattern 2: Manual Vector Store Usage

```typescript
// Create store directly
const store = new SQLiteVectorStore({ url: 'file:vectors.db' });

// Generate embeddings
const embeddings = await embedder.embed(['chunk1 text', 'chunk2 text']);

// Add with metadata
await store.add(
  embeddings,
  [
    { content: 'chunk1 text', documentId: 'doc1', chunkIndex: 0 },
    { content: 'chunk2 text', documentId: 'doc1', chunkIndex: 1 },
  ],
  ['id-1', 'id-2']  // Optional explicit IDs
);

// Search
const results = await store.search(queryEmbedding, 5);

// Filter by metadata
const filtered = await store.search(queryEmbedding, 5, {
  documentId: 'doc1',
  type: 'manual'
});
```

### Pattern 3: Incremental Updates

```typescript
const store = new SQLiteVectorStore({ url: 'file:docs.db' });

// First batch
await store.add([emb1], [{ content: 'first doc' }]);

// Second batch (appends)
await store.add([emb2], [{ content: 'second doc' }]);

// Update existing (skip duplicates by default)
await store.add([emb3], [{ content: 'updated' }], ['id-1']);

// Replace duplicate if needed
await store.add([emb4], [{ content: 'force update' }], ['id-1'], {
  replaceDuplicates: true
});
```

**Note:** The `replaceDuplicates` option is optional (defaults to false, which skips duplicates).

### Pattern 4: Document Removal

```typescript
// Remove specific chunks
await store.delete(['chunk-id-1', 'chunk-id-2']);

// Via RAG (removes entire document + all chunks)
await rag.removeDocument('document-id');
```

---

## Lifecycle Management

### Initialization

```typescript
const store = new SQLiteVectorStore({ url: 'file:data.db' });

// Lazy init: called automatically on first add/search/delete
await store.add(...);  // Triggers initialization

// Or explicit init (useful for query-only mode)
await store.init();
console.log(store.size);  // Load count from DB
```

### Shutdown

```typescript
// Option 1: Via RAG (RECOMMENDED)
rag.close();  // Closes vector store connections

// Option 2: Direct access (for standalone stores)
store.close();

// In long-running apps, close on shutdown
process.on('SIGTERM', () => {
  rag.close();
  process.exit(0);
});
```

### Checking Status

```typescript
// Get record count
console.log(`Stored: ${store.size} chunks`);

// Access schema metadata
const meta = store.metadata;
if (meta) {
  console.log(`Dimensions: ${meta.embeddingDimension}`);
  console.log(`Model: ${meta.embeddingModel}`);
  console.log(`Created: ${meta.createdAt}`);
}
```

---

## Schema & Metadata

The `_schema` table tracks:

```javascript
{
  version: 1,                      // Schema version
  embeddingDimension: 1536,        // Locked after first insert
  embeddingModel: "auto-detected", // Model identifier
  createdAt: "2024-01-01T...",     // Initial creation time
  updatedAt: "2024-01-02T..."      // Last modification
}
```

**Note:** The SQLite database stores keys in **snake_case** (`embedding_dimension`, `created_at`), while accessing via `.metadata` returns JavaScript objects with **camelCase** (`embeddingDimension`, `createdAt`).

**Important:** Once you insert embeddings with a certain dimension, the schema locks that dimension. Subsequent inserts must match!

---

## Error Handling

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Embedding dimension mismatch: got X, expected Y` | Different embedding model than used during initial indexing | Recreate DB or use same model |
| `Corrupt store: invalid JSON` | Manual file editing | Rebuild from source documents |
| `Cannot determine dimension from empty store` | Trying to load empty JSON backup | Add documents first |

### Best Practices

```typescript
try {
  const store = new SQLiteVectorStore({ url: 'file:data.db' });
  await store.add(embeddings, metadatas);
} catch (error) {
  if (error.message.includes('Embedding dimension mismatch')) {
    console.log('⚠️ Using wrong embedding model. Need to recreate DB.');
  } else if (error.message.includes('Corrupt store')) {
    console.log('⚠️ Database file corrupted. Rebuild recommended.');
  }
  throw error;
}
```

---

## Performance Considerations

### Trade-offs

| Aspect | Behavior | Impact |
|--------|----------|--------|
| Storage | JSON strings in SQLite | Higher disk usage vs binary |
| Search | Full in-memory scan | O(n) complexity |
| Init | Loads ALL records on startup | Slower cold start for large DBs |
| Insert | Transaction-wrapped | Atomic writes, safe crashes |

### When to Use

✅ **Good for:**
- Up to ~10,000 chunks (small/medium projects)
- Development and testing
- Embedded applications
- Single-user deployments
- Prototypes and demos

❌ **Not ideal for:**
- Millions of embeddings (consider PostgreSQL + pgvector)
- High-concurrency production (multiple writers)
- Real-time analytics over embeddings

### Optimization Tips

```typescript
// Batch inserts (faster than one-by-one)
const allEmbeddings = texts.map(t => embed(t)).flat();
const allMetadatas = texts.map((t, i) => ({ content: t, source: 'batch' }));
await store.add(allEmbeddings, allMetadatas);

// Reuse connection for long-running apps
const store = new SQLiteVectorStore({ url: 'file:app.db' });
// Keep alive throughout app lifetime, don't recreate

// Clean up periodically
await store.delete(staleChunkIds);  // Garbage collect old data
```

---

## File-Based Backup (`save()` / `load()`)

For portability or migration, use JSON export:

```typescript
// Export to JSON file
await store.save('backup.json');

// Import from JSON file
const store2 = new SQLiteVectorStore({ url: 'file::memory:' });
await store2.load('backup.json');

// Now use store2 in memory
const results = await store2.search(queryEmb, 10);
```

Note: This loads into memory cache AND syncs back to the SQLite DB if already initialized.

---

## Comparison: SQLite vs In-Memory

| Feature | InMemoryVectorStore | SQLiteVectorStore |
|---------|---------------------|-------------------|
| Persistence | ❌ Lost on restart | ✅ Disk-backed |
| Startup Speed | ⚡ Instant | 🐢 Loads from disk |
| Multi-process | ❌ Process-bound | ✅ File is shareable |
| Size Limit | Memory bound | Disk space (~GBs OK) |
| Use Case | Testing, prototyping | Production, persistence |

---

## Migration Guide

### From In-Memory to SQLite

```typescript
// Before
const rag = new RAG({
  embeddings: ...,
  vectorStore: new InMemoryVectorStore(),
});

// After
const rag = new RAG({
  embeddings: ...,
  vectorStore: new SQLiteVectorStore({ 
    url: 'file:persisted-store.db' 
  }),
});

// That's it! Same API, added persistence.
```

### Migrating Existing Data

```typescript
// 1. Load old in-memory store (from application state)
const oldStore = getExistingInMemoryStore();

// 2. Create new SQLite store
const newStore = new SQLiteVectorStore({ url: 'file:migrated.db' });

// 3. Extract records from old store (requires access to internal state)
// or re-index from original documents

// 4. Better: re-run indexing pipeline
await rag.addDocuments(originalFiles);  // Automatically uses new store
```

---

## Troubleshooting

### "Database locked" errors

```bash
# Close any processes using the DB
ps aux | grep node
kill <pid>

# Check file permissions
chmod 644 my-store.db
```

### Growing file size

SQLite doesn't always shrink after deletes. The database may retain allocated pages.

**Solution:** Recreate the store periodically to compact:

```typescript
// Backup data, recreate store
const store = new SQLiteVectorStore({ url: 'file:data.db' });
await store.load('backup.json');  // Restore from backup
await store.save('data-compact.db');  // Write to new location
// Now use the compacted database
```

Or simply delete and rebuild from source documents.

### Corrupted after crash

If the DB file is corrupted:
1. Restore from last known-good backup
2. Or re-index from original documents (preferred)

---

## Advanced Usage

### Custom Table Name

Use separate tables for different data types:

```typescript
const docsStore = new SQLiteVectorStore({
  url: 'file:mixed.db',
  tableName: 'documentation_chunks',
});

const codeStore = new SQLiteVectorStore({
  url: 'file:mixed.db',
  tableName: 'code_snippets',
});
```

### Multiple Databases

Split by category or tenant:

```typescript
const tenantA = new SQLiteVectorStore({ url: 'file:tenant-a.db' });
const tenantB = new SQLiteVectorStore({ url: 'file:tenant-b.db' });
```

---

## Lifecycle Management with RAG

### The Pattern

When using `SQLiteVectorStore` with `RAG`, manage lifecycle through the RAG instance:

```typescript
import { RAG, SQLiteVectorStore } from '../src/index.ts';

// Create RAG with SQLite store
const rag = new RAG({
  embeddings: yourEmbedder,
  vectorStore: new SQLiteVectorStore({ url: 'file:data.db' }),
});

// Initialize before first query (loads data from DB)
await rag.initialize();

// Use normally...
await rag.addDocuments(files);
const results = await rag.query('...');

// Close when done (releases DB connections)
rag.close();
```

### Why This Works

- `RAG.initialize()` calls `vectorStore.init()` if available
- `RAG.close()` calls `vectorStore.close()` if available
- InMemory stores don't need this (methods are no-op)
- No casting or private property access needed!

### Direct Store Usage

If you use `SQLiteVectorStore` directly (without RAG):

```typescript
const store = new SQLiteVectorStore({ url: 'file:vectors.db' });

// Must call init() before querying
await store.init();

// Use store...
const results = await store.search(queryEmb, 5);

// Clean up
store.close();
```

## Summary Checklist

- [ ] Choose persistence: `file:*` vs `file::memory:`
- [ ] Lock in embedding model/dimension before first insert
- [ ] Call `close()` on application shutdown
- [ ] Handle dimension mismatch errors gracefully
- [ ] Batch operations for performance
- [ ] Monitor database file growth
- [ ] Backup critical stores regularly

---

## API Reference

### SQLiteVectorStore

```typescript
class SQLiteVectorStore implements VectorStore {
  constructor(config?: SQLiteVectorStoreConfig);
  
  async init(): Promise<void>;              // Initialize/load from DB
  async add(embeddings: number[][], metadatas: Metadata[], ids?: string[], options?: { replaceDuplicates?: boolean }): Promise<void>;
  async search(query: number[], limit: number, filter?: Filter): Promise<SearchResult[]>;
  async delete(ids: string[]): Promise<void>;
  async save(filePath: string): Promise<void>;   // Export to JSON
  async load(filePath: string): Promise<void>;   // Import from JSON
  close(): void;                           // Shutdown connections
  
  get size(): number;                      // Record count
  get metadata(): VectorStoreSchemaMetadata | null;  // Schema info
}
```

### RAG (Lifecycle Management)

```typescript
class RAG {
  async initialize(): Promise<void>;       // Calls store.init() if available
  async addDocument(file): Promise<DocumentInfo>;
  async query(question, options): Promise<QueryResult>;
  close(): void;                           // Calls store.close() if available
}
```

---

For examples, see:
- `examples/load-markdown-to-sqlite.ts` — Full end-to-end demo with lifecycle management
- `examples/basic.ts` — Minimal setup example
