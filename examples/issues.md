# Improvement Plan for rag-typescript

## Batch 1: Security & Data Integrity (Critical)

### 1.1 SQL Injection — sanitize table name in SQLite store
**File:** `src/storage/sqlite.ts`

`tableName` is interpolated into 7 SQL statements (lines 79, 210, 231, 276, 412, 435, 460) without validation. A malicious name like `x; DROP TABLE users;--` would execute arbitrary SQL.

**Fix:** Validate `tableName` against a strict allowlist regex in the constructor:
```ts
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(this.tableName)) {
  throw new VectorStoreError(`Invalid table name: ${this.tableName}`);
}
```

### 1.2 Bare catch blocks silently swallow errors
**File:** `src/parsers/index.ts` (lines 36, 44)

`catch {}` swallows ALL errors including real import failures, not just "package not installed."

**Fix:** Check for specific error codes that indicate a missing module:
```ts
try {
  const { DocxParser } = require('./docx.ts');
  docxParser = new DocxParser();
  parsers.push(docxParser!);
} catch (err: any) {
  if (err?.code !== 'MODULE_NOT_FOUND') throw err;
  // mammoth not installed — skip silently
}
```

### 1.3 No transactions for SQLite multi-row operations
**File:** `src/storage/sqlite.ts`

`add()`, `delete()`, and `load()` execute multiple SQL statements without transaction wrapping. This causes:
- Performance degradation (each statement is a separate transaction)
- Partial-failure data inconsistency

**Fix:** Wrap multi-row operations in `BEGIN`/`COMMIT`:
- `add()`: wrap the loop of INSERT/UPDATE statements
- `delete()`: wrap the loop of DELETE statements
- `load()`: wrap the DELETE + INSERT statements when syncing to DB

Use `client.execute('BEGIN')` / `client.execute('COMMIT')` with try/catch for `ROLLBACK`.

---

## Batch 2: Type Safety & Error Consistency (High)

### 2.1 Remove unused RAGConfig options
**Files:** `src/types/index.ts`, `src/core/RAG.ts`

`RAGConfig.timeout` (line 248), `maxConcurrency` (line 252), and `fallbackOnMissingFeature` (line 254) are declared but never wired in. `timeout` is already configurable per-provider. The other two have no concrete use case.

**Fix:** Remove `timeout`, `maxConcurrency`, and `fallbackOnMissingFeature` from `RAGConfig`. If needed later, add them with actual wiring.

### 2.2 Add `size` to VectorStore interface — eliminate `as any`
**Files:** `src/types/index.ts`, `src/core/RAG.ts` (lines 302, 316)

RAG.ts uses `(this.config.vectorStore as any).size` in 2 places because `VectorStore` interface doesn't expose `size`.

**Fix:** Add optional `readonly size?: number` to the `VectorStore` interface. Both implementations already have `size` getters.

### 2.3 Replace `console.warn()` with Logger
**Files:** `src/storage/in-memory.ts` (line 254), `src/storage/sqlite.ts` (line 390)

Both use `console.warn()` for legacy format warnings, bypassing the Logger interface.

**Fix:** Both store classes need a `logger` property (passed via config or defaulted to `NoopLogger`), then replace `console.warn(...)` with `this.logger.warn(...)`.

### 2.4 Use `QueryError` in LLMQueryRewriter
**File:** `src/query/rewrite/llm-rewriter.ts` (lines 24, 30)

Throws generic `Error` instead of the project's `QueryError` type.

**Fix:** Import and use `QueryError`:
```ts
throw new QueryError('numQueries must be at least 1');
throw new QueryError('Query cannot be empty');
```

### 2.5 Reranker: fail fast on missing API key
**File:** `src/reranking/openai-compatible.ts`

Unlike `OpenAICompatibleEmbeddings` which throws on empty API key (line 47-51), the reranker silently sends unauthenticated requests.

**Fix:** Add a check in `rerank()`:
```ts
if (!this.apiKey) {
  throw new RerankError('API key is required for reranking');
}
```

---

## Batch 3: Code Deduplication (Medium)

### 3.1 Extract shared utilities: `matchesFilter` + `cosineSimilarity`
**Files:** `src/storage/in-memory.ts` (lines 281-306), `src/storage/sqlite.ts` (lines 469-494)

Identical functions duplicated in both files.

**Fix:** Create `src/storage/utils.ts` with both functions, import from there.

### 3.2 Extract shared `load()` logic
**Files:** `src/storage/in-memory.ts` (lines 186-273), `src/storage/sqlite.ts` (lines 309-440)

~80% duplicated JSON parsing and validation logic.

**Fix:** Create a shared `parseStoreFile(filePath: string)` function in `src/storage/utils.ts` that returns `{ meta, records }`. Both stores call it, then apply their own post-load steps.

### 3.3 Deduplicate type definitions
**Files:** `src/types/index.ts`, `src/search/bm25.ts`, `src/utils/retry.ts`

- `HybridSearchConfig` in `types/index.ts` has `bm25K1`/`bm25B` fields; `search/hybrid.ts` likely has its own version
- `RetryConfig` in `types/index.ts` (4 optional fields) differs from the one in `utils/retry.ts`

**Fix:** Keep the richer canonical versions in `types/index.ts`, import from there everywhere, remove duplicates.

---

## Batch 4: Defaults & Performance (Medium)

### 4.1 Fix default embedding dimension mismatch
**File:** `src/embeddings/openai-compatible.ts` (line 20)

`DEFAULT_DIMENSIONS = 1024` but `DEFAULT_MODEL = 'text-embedding-3-small'` returns 1536D vectors. Users who don't specify dimensions get a mismatch.

**Fix:** Change `DEFAULT_DIMENSIONS` to `1536` to match the default model.

### 4.2 Reranker: batch documents into single LLM call
**File:** `src/reranking/openai-compatible.ts`

Current: 1 LLM call per document (50 results = 50 API calls). The `batchSize` config exists but still makes individual calls per document within a batch (just in parallel).

**Fix:** Modify `callLLM` to accept multiple documents and return multiple scores in a single prompt, or at minimum document that `batchSize` controls concurrency, not request count.

---

## Batch 5: Low-Priority Polish (Low)

### 5.1 Replace `require()` with dynamic `import()`
**File:** `src/parsers/index.ts` (lines 32, 40)

`require('./docx.ts')` is CJS syntax; the project uses ESM. This breaks on Node.js (works only on Bun).

**Fix:** Convert to async `import()`:
```ts
const { DocxParser } = await import('./docx.ts');
```
This requires `getAvailableParsers()` to become async.

### 5.2 Move mammoth/pdf-parse to optionalDependencies
**File:** `package.json`

Currently regular dependencies; they're only needed for DOCX/PDF parsing. Users who only parse .txt/.md shouldn't need them.

**Fix:** Move `mammoth` and `pdf-parse` to `optionalDependencies`.

### 5.3 Tighten `LLMMessage` type in `generateMessages`
**File:** `src/types/index.ts` (line 225)

`generateMessages?` accepts `LLMMessage[]` but the interface signature could accept a stricter type than the current `{ role: string; content: string }`.

**Fix:** Already typed correctly — no change needed after review.

---

## Deferred

- **CI/CD pipeline**: Important but orthogonal to code quality. Separate workstream.
- **CHANGELOG.md / CONTRIBUTING.md**: Documentation, not code. Separate workstream.
- **TypeDoc API docs**: Nice-to-have, separate tooling setup.
- **Sequential document ingestion with RateLimiter**: The `addDocuments()` method in RAG.ts could use `RateLimiter` for parallel ingestion, but this is a feature enhancement, not a fix.
