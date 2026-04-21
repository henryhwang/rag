# Lifecycle Management Guide

How to properly initialize and close vector stores when using RAG.

---

## The Problem

Originally, the `VectorStore` interface didn't include lifecycle methods like `.init()` and `.close()`, but `SQLiteVectorStore` needs them for proper database connection management. This created a design gap where users had to access private properties:

```typescript
// ❌ Old bad pattern: Accessing private implementation details
const store = rag['config'].vectorStore as SQLiteVectorStore;
await store.init();
store.close();
```

**Solution:** We added optional `init?()` and `close?()` methods directly to the `VectorStore` interface.

---

## The Solution

### Optional Lifecycle Methods in VectorStore Interface

We added optional `init()` and `close()` methods directly to the `VectorStore` interface:

```typescript
export interface VectorStore {
  add(...): Promise<void>;
  search(...): Promise<SearchResult[]>;
  delete(...): Promise<void>;
  save(...): Promise<void>;
  load(...): Promise<void>;
  
  // Optional lifecycle methods (implemented by SQLiteVectorStore)
  init?(): Promise<void>;   // Optional: Initialize connections/load data
  close?(): void;           // Optional: Close connections/release resources
}
```

- Stores like `SQLiteVectorStore` implement these methods
- Stores like `InMemoryVectorStore` don't need them (no-op)
- RAG checks if they exist before calling

### RAG Delegates to Store

The `RAG` class now provides convenience methods:

```typescript
class RAG {
  async initialize(): Promise<void> {
    // Calls store.init() if available, no-op otherwise
  }
  
  close(): void {
    // Calls store.close() if available, no-op otherwise
  }
}
```

---

## Usage Pattern

### With RAG (Recommended)

```typescript
import { RAG, SQLiteVectorStore } from '../src/index.ts';

const rag = new RAG({
  embeddings: yourEmbedder,
  vectorStore: new SQLiteVectorStore({ url: 'file:data.db' }),
});

// Initialize before first query
await rag.initialize();

// Use normally...
await rag.addDocuments(files);
const results = await rag.query('What is OAuth?');

// Clean up when done
rag.close();
```

### Direct Store Usage

```typescript
import { SQLiteVectorStore } from '../src/storage/index.ts';

const store = new SQLiteVectorStore({ url: 'file:vectors.db' });

// Must call init() before searching
await store.init();

// Use directly...
const results = await store.search(queryEmbedding, 5);

// Clean up
store.close();
```

### In-Memory Stores (No Action Needed)

```typescript
import { InMemoryVectorStore } from '../src/storage/index.ts';

const rag = new RAG({
  embeddings: mockEmbeddings,
  vectorStore: new InMemoryVectorStore(),
});

// InMemoryVectorStore doesn't have init()/close() methods
// RAG checks if they exist before calling - safely skipped!
await rag.addDocuments(files);
const results = await rag.query('...');
```

**Note:** You *can* call `rag.initialize()` and `rag.close()` even with in-memory stores - RAG will just skip them since they don't exist.
```

---

## When to Call What

| Operation | When | Why |
|-----------|------|-----|
| `initialize()` | Before first query on fresh SQLite store | Loads records from DB into memory cache (needed for search) |
| `close()` | App shutdown or when done with instance | Releases SQLite file handles and clears memory cache |
| Both together | Query-only mode on existing DB | Fast loading without re-indexing documents |

**Note:** `addDocument()` works without calling `initialize()` first because it auto-initializes internally.

---

## Common Patterns

### Pattern 1: Full Workflow

```typescript
async function processDocuments(files: string[]) {
  const rag = new RAG({
    embeddings: openAIEmbeddings,
    vectorStore: new SQLiteVectorStore({ url: 'file:kb.db' }),
  });
  
  try {
    await rag.initialize();          // Load existing data
    await rag.addDocuments(files);   // Index new docs
    return rag;                      // Keep alive for queries
  } catch (error) {
    rag.close();                     // Always clean up on error
    throw error;
  }
}
```

### Pattern 2: Query-Only Mode

```typescript
async function searchKnowledgeBase(query: string) {
  const rag = new RAG({
    embeddings: openAIEmbeddings,
    vectorStore: new SQLiteVectorStore({ url: 'file:kb.db' }),
  });
  
  await rag.initialize();            // Load cached vectors from DB
  
  const result = await rag.query(query, { topK: 3 });
  
  rag.close();                       // Release connections
  return result;
}
```

### Pattern 3: Long-Running Service

```typescript
// Global singleton
let rag: RAG | null = null;

async function startServer() {
  rag = new RAG({
    embeddings: openAIEmbeddings,
    vectorStore: new SQLiteVectorStore({ url: 'file:kb.db' }),
  });
  await rag.initialize();
  console.log('Knowledge base loaded');
}

process.on('SIGTERM', () => {
  rag?.close();                      // Graceful shutdown
  process.exit(0);
});

app.get('/search', async (req, res) => {
  const results = await rag.query(req.query.q, { topK: 5 });
  res.json(results);
});
```

---

## Store-Specific Behavior

| Store Type | Has `init()`? | Has `close()`? | Lifecycle needed? |
|------------|---------------|----------------|--------------------|
| `SQLiteVectorStore` (disk) | ✅ Yes | ✅ Yes | ✅ Required |
| `SQLiteVectorStore` (memory) | ✅ Yes | ✅ Yes | ⚠️ Good practice |
| `InMemoryVectorStore` | ❌ No | ❌ No | ❌ Not needed |

**Note:** `RAG.initialize()` and `RAG.close()` check if these methods exist before calling.
If the store doesn't implement them (like `InMemoryVectorStore`), the calls are safely skipped.

---

## Troubleshooting

### "Database locked" errors

**Cause:** Another process holds the DB connection open.

**Fix:** Ensure you call `rag.close()` or `store.close()`:

```typescript
try {
  await rag.initialize();
  // ... work ...
} finally {
  rag.close();  // Always close in finally block
}
```

### Memory grows over time

**Cause:** Records stay in memory cache across multiple sessions.

**Fix:** Call `close()` which clears the internal cache:

```typescript
// Between different operations
rag.close();

// Fresh instance for next operation
rag = new RAG({...});
await rag.initialize();
```

### Queries fail after restart

**Cause:** Never called `initialize()` so DB was never loaded.

**Fix:** Always initialize before querying:

```typescript
await rag.initialize();  // ← Don't skip this!
const results = await rag.query('...');
```

---

## Migration from Old Code

### Before (Private Property Access)

```typescript
const rag = new RAG({...});
await rag['config'].vectorStore.init();  // Hacky
rag['config'].vectorStore.close();       // Hacky
```

### After (Public API)

```typescript
const rag = new RAG({...});
await rag.initialize();  // Proper
rag.close();             // Proper
```

---

## Best Practices Checklist

- [ ] Call `initialize()` on fresh RAG + SQLite instances before **querying** (not needed for addDocument)
- [ ] Call `close()` when shutting down or done with the instance
- [ ] Use `try/finally` to guarantee cleanup in error-prone code
- [ ] For long-running apps, keep one RAG instance alive and close on shutdown
- [ ] For short-lived scripts, create+use+close each time  
- [ ] Don't worry about lifecycle for `InMemoryVectorStore`
- [ ] Safe to call `initialize()` even if already initialized (idempotent)

---

## Summary

✅ **Use `rag.initialize()` and `rag.close()` instead of accessing private properties**

This provides:
- Clean public API
- Store-agnostic code (works with any VectorStore)
- No casting or type assertions needed
- Future-proof if we add more store types

---

For examples, see:
- `examples/load-markdown-to-sqlite.ts` — Full demo with lifecycle management
- `examples/basic.ts` — Minimal example (no lifecycle needed for in-memory)
