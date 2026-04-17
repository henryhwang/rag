# Schema Metadata Feature 📊

**Version 2.0+ Enhancement**

Vector stores now embed schema metadata, enabling decoupled creation/consumption patterns and better error handling for embedding dimension mismatches.

---

## What Changed?

### Before (Legacy Format)

```json
[
  {
    "id": "uuid-1",
    "embedding": [0.1, 0.2, ...1536 values],
    "metadata": {...}
  }
]
```

❌ No indication of which embedding model was used  
❌ Dimension inferred from first record  
❌ Hard to detect configuration drift  

---

### After (Schema Metadata Format)

```json
{
  "_meta": {
    "version": 1,
    "embeddingDimension": 1536,
    "embeddingModel": "text-embedding-3-small",
    "encodingFormat": "float32",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-16T14:20:00Z"
  },
  "records": [
    {
      "id": "uuid-1",
      "embedding": [...],
      "metadata": {...}
    }
  ]
}
```

✅ Explicit schema at file level  
✅ Model name preserved for debugging  
✅ Validation happens before queries fail  
✅ Survives across application restarts  

---

## Key Benefits

### 1️⃣ **Decoupled Creation & Consumption**

Different teams can work independently:

```typescript
// Team A: Knowledge Base Builder
const store = new InMemoryVectorStore();
await addDocuments(store);
store.save('knowledge-base.json'); // Includes schema

// Team B: Query Service (different repo!)
const loadedStore = new InMemoryVectorStore();
await loadedStore.load('knowledge-base.json');

// Auto-discover required config from schema
const requiredDim = loadedStore.metadata?.embeddingDimension;
const embeddings = createProviderForDimension(requiredDim);

const rag = new RAG({ embeddings, vectorStore: loadedStore });
// Works without coordination between teams!
```

---

### 2️⃣ **Fail Fast on Configuration Mismatch**

Validate before accepting traffic:

```typescript
const rag = new RAG({
  embeddings: new OpenAIEmbeddings('text-embedding-3-small'),
  vectorStore: new LocalVectorStore(),
});

await rag.loadAndValidate('vectors.json');

// If models don't match, throws immediately with helpful message:
/*
RAGError: Embedding configuration mismatch!

  Stored vectors:     1536D (text-embedding-3-small)
  Current provider:   768D (nomic-embed-text)
  Difference:         768D

This will cause search to fail! To fix:
  1. Reconfigure your EmbeddingProvider to match stored vectors, OR
  2. Delete all documents and re-index with current configuration
*/
```

---

### 3️⃣ **Better Debugging & Observability**

Inspect knowledge base metadata:

```typescript
const info = rag.getKnowledgeBaseInfo();
console.log(info);
// Output:
// {
//   recordCount: 1234,
//   documentCount: 42,
//   embeddingDimension: 1536,
//   embeddingModel: 'text-embedding-3-small',
//   chunkStrategy: 'markdown',
//   chunkSize: 500,
//   createdAt: Date(...),
//   updatedAt: Date(...)
// }
```

Access schema directly from vector store:

```typescript
const meta = rag.config.vectorStore.metadata;
console.log(`Vectors created with ${meta.embeddingModel} (${meta.embeddingDimension}D)`);
```

---

## API Reference

### `VectorStoreSchemaMetadata` Interface

```typescript
interface VectorStoreSchemaMetadata {
  version: number;                    // Schema format version
  embeddingDimension: number;         // Locked dimension count
  embeddingModel?: string;            // Original model name (if known)
  encodingFormat?: string;            // 'float32', 'binary', etc.
  createdAt: Date;                    // When store was initialized
  updatedAt: Date;                    // Last modification time
}
```

### New `VectorStore` Methods

```typescript
interface VectorStore {
  readonly metadata: VectorStoreSchemaMetadata | null;  // Schema accessor
  
  save(path: string): Promise<void>;  // Persists with _meta wrapper
  load(path: string): Promise<void>;  // Validates schema on load
}
```

### New `RAG` Helper Methods

```typescript
class RAG {
  /** Check if current config matches stored vectors */
  async validateConfiguration(): Promise<{
    isValid: boolean;
    warning?: string;
    error?: string;
  }>

  /** Load + validate in one step */
  async loadAndValidate(storePath: string): Promise<void>

  /** Get summary statistics */
  getKnowledgeBaseInfo(): {
    recordCount: number;
    documentCount: number;
    embeddingDimension: number;
    embeddingModel?: string;
    chunkStrategy: string;
    createdAt?: Date;
    updatedAt?: Date;
  }
}
```

---

## Migration Guide

### Loading Legacy Stores

Your code automatically handles both old and new formats:

```typescript
const store = new InMemoryVectorStore();

// Old format (array only) - still works!
await store.load('legacy-store.json');
// ⚠️ Warning: "Loaded legacy format store (v0). Call save() to upgrade."

// Automatically converts to new format on next save
await store.save('upgraded-store.json');
// ✅ Now contains _meta object with schema
```

**Recommendation:** Upgrade all legacy stores at your earliest convenience by loading and re-saving them.

---

### Backward Compatibility

| Operation | Compatible? | Notes |
|-----------|-------------|-------|
| Load legacy (array) format | ✅ Yes | Warns user to upgrade |
| Save to legacy format | ❌ No | Always saves with `_meta` wrapper |
| Cross-version load | ✅ Yes | v1 loads into any future version |
| Mixed dimensions in one store | ❌ No | Still rejected (as intended) |

---

## Real-World Usage Patterns

### Pattern 1: CI/CD Pipeline Artifact

```yaml
# .github/workflows/build-kb.yml
name: Build Knowledge Base
on:
  push:
    paths: ['docs/**']
jobs:
  build:
    steps:
      - run: bun scripts/index-docs.ts --output kb.json
      - uses: actions/upload-artifact@v4
        with:
          name: knowledge-base
          path: kb.json

# Result: Every deployment has versioned KB artifact with embedded schema
```

```typescript
// Runtime app consumes artifact
const store = new LocalVectorStore();
await store.load(process.env.KB_PATH);

// Auto-verify provider matches artifact
const expectedDim = store.metadata!.embeddingDimension;
if (currentProvider.dimensions !== expectedDim) {
  throw new Error(`Config drift! Expected ${expectedDim}D`);
}
```

---

### Pattern 2: Multi-Tenant SaaS

```typescript
// Central builder service
async function buildTenantKB(tenantId: string, docs: Document[]) {
  const store = new SQLiteVectorStore({ url: `file:tenant-${tenantId}.db` });
  const rag = new RAG({ embeddings: enterpriseModel, vectorStore: store });
  
  for (const doc of docs) await rag.addDocument(doc);
  
  // Schema embedded in DB via _schema table
  // Tenant doesn't need to know about it
}

// Stateless query workers
app.post('/search', async (req, res) => {
  const tenantStore = new SQLiteVectorStore({ 
    url: `file:tenant-${req.headers.tenant}.db` 
  });
  await tenantStore.init();
  
  // Worker validates its own config against tenant KB
  const tenantRag = new RAG({ 
    embeddings: getProviderForTenant(req.headers.tenant), 
    vectorStore: tenantStore 
  });
  
  await tenantRag.validateConfiguration(); // Fail fast if misconfigured
  
  const result = await tenantRag.query(req.body.query);
  res.json(result);
});
```

---

### Pattern 3: Model Migration Without Downtime

```typescript
// Phase 1: Build new KB alongside old
const oldKBPath = '/data/kb-v1.json';  // 1536D from text-embedding-3-small
const newKBPath = '/data/kb-v2.json';  // 768D from nomic-embed-text

// Index new KB with cheaper model
const newRAG = createRAG(new NomicEmbeddings());
for (const doc of sourceDocs) {
  await newRAG.addDocument(doc);
}
await newRAG.config.vectorStore.save(newKBPath);

// Both stores now exist with their own schemas
// Old traffic → oldKBPath
// New traffic → newKBPath (blue-green deploy)

// Phase 2: Switch env var when ready
process.env.KNOWLEDGE_BASE = newKBPath;
// Application transparently discovers 768D requirement and adapts
```

---

## Troubleshooting

### "Cannot determine dimension from empty store"

```typescript
const store = new InMemoryVectorStore();
await store.load('empty-store.json');  // ❌ Throws error

// Fix: Add at least one record first
const rag = new RAG({ ... });
await rag.addDocument('seed.txt');
await rag.config.vectorStore.save('store.json');
```

---

### "Loaded legacy format store" warning

```bash
Warning: Loaded legacy format store (v0). Call save() to upgrade schema.
```

This is informational. Your store works fine, but re-save to get schema benefits:

```typescript
await store.load('old.json');  // Warning shown
await store.save('new.json');  // Upgraded
// Future loads use new format, no warnings
```

---

### "Embedding configuration mismatch" error

```
RAGError: Embedding configuration mismatch!
  Stored vectors:     1536D (text-embedding-3-small)
  Current provider:   768D
```

**Solution 1:** Match the original model
```typescript
// Use same model that created the store
const rag = new RAG({
  embeddings: new OpenAIEmbeddings('text-embedding-3-small'),
  vectorStore,
});
```

**Solution 2:** Re-index with new model
```typescript
// Clear and rebuild with new provider
await vectorStore.delete(Array.from(allIds));
const rag = new RAG({
  embeddings: new OllamaEmbeddings(),
  vectorStore,
});
for (const doc of originalDocs) {
  await rag.addDocument(doc);
}
```

---

## Best Practices

### ✅ Do's

1. **Call `validateConfiguration()` after loading persisted stores**
   ```typescript
   await store.load('kb.json');
   const val = await rag.validateConfiguration();
   if (!val.isValid) throw new Error(val.error);
   ```

2. **Use `loadAndValidate()` for cleaner code**
   ```typescript
   await rag.loadAndValidate('kb.json');  // Handles both
   ```

3. **Check metadata in monitoring dashboards**
   ```typescript
   metrics.gauge('kb.dimension', rag.getKnowledgeBaseInfo().embeddingDimension);
   ```

4. **Upgrade legacy stores during maintenance windows**
   ```typescript
   const store = new InMemoryVectorStore();
   await store.load('legacy.json');
   await store.save('upgraded.json');  // One-time conversion
   ```

---

### ❌ Don'ts

1. **Don't ignore validation errors**
   ```typescript
   // BAD: Assuming it will just work
   await rag.config.vectorStore.load('kb.json');
   await rag.query("search");  // ❌ Fails later with cryptic error
   
   // GOOD: Validate upfront
   await rag.loadAndValidate('kb.json');
   await rag.query("search");  // ✅ Guaranteed to work or fail fast
   ```

2. **Don't manually edit JSON stores**
   ```bash
   # BAD: Editing vectors.json by hand breaks schema integrity
   vim vectors.json
   
   # Use programmatic APIs instead
   await store.delete(unwantedIds);
   await store.save('vectors.json');
   ```

3. **Don't mix providers without re-indexing**
   ```typescript
   // BAD: Changing mid-lifecycle
   rag.config.embeddings = new OllamaEmbeddings();  // Wrong model!
   
   // GOOD: Create fresh RAG instance
   const newRAG = new RAG({
     embeddings: new OllamaEmbeddings(),
     vectorStore: new LocalVectorStore(),  // Fresh store
   });
   ```

---

## See Also

- [`examples/schema-metadata-demo.ts`](./schema-metadata-demo.ts) - Interactive demo
- [`METADATA_GUIDE.md`](./METADATA_GUIDE.md) - General metadata usage
- [`CHUNKING_STRATEGY_GUIDE.md`](./CHUNKING_STRATEGY_GUIDE.md) - Chunking strategies
