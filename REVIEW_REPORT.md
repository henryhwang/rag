# Code Review Report: rag-typescript

**Date:** 2026-04-13
**Scope:** Full codebase audit — `src/core/`, `src/query/`, `src/chunking/`, `src/types/`, `src/embeddings/`, `src/llm/`, `src/storage/`, `src/parsers/`

---

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 4     |
| High     | 4     |
| Medium   | 14    |
| Low      | 9     |
| **Total** | **31** |

The most impactful issues are:

1. **`removeDocument` is broken** — it only deletes metadata, leaving orphaned chunks in the vector store that continue to appear in search results. The root cause is that chunk IDs are discarded during ingestion.
2. **`overlap` parameter is silently ignored** in both `recursiveChunk` and `markdownAwareChunk`, meaning the overlap contract is broken for two of three chunking strategies.
3. **`addDocument` has a state inconsistency bug** — document info is stored before embedding succeeds, leaving ghost entries on failure.

---

## Critical Issues

### C1. `removeDocument` leaves orphaned chunks in vector store

- **File:** `src/core/RAG.ts:105-111`
- **Impact:** Deleted documents still appear in search results — silent data contamination

```typescript
async removeDocument(id: string): Promise<void> {
  if (!this.documents.has(id)) {
    throw new RAGError(`Document not found: ${id}`);
  }
  this.documents.delete(id);          // only removes from local Map
  this.logger.debug('Removed document: %s', id);
  // chunks remain in vectorStore!
}
```

The comment on line 102-103 claims "InMemoryVectorStore doesn't support bulk delete by documentId natively", but `InMemoryVectorStore` **does** have a `delete(ids: string[])` method. The real blocker is C2 — the RAG class has no mapping from `documentId` to chunk IDs.

**Suggested fix:** Track `documentId -> chunkIds` in the RAG class. On removal, call `vectorStore.delete(chunkIds)`.

---

### C2. Chunk IDs discarded during `addDocument`

- **File:** `src/core/RAG.ts:82`
- **Impact:** Makes any chunk cleanup impossible; root cause of C1

```typescript
const texts = chunks.map((c) => c.content);
const embeddings = await this.config.embeddings.embed(texts);
const metadatas = chunks.map((c) => ({
  ...c.metadata,
  content: c.content,
  documentId: c.documentId,
  chunkIndex: c.index,
}));

await this.config.vectorStore.add(embeddings, metadatas);
//                                    ^^^^^^^^^  ^^^^^^^^^^
//                          no `ids` argument — chunk IDs lost
```

Each chunk already has a UUID from `makeChunk()`, but it's never passed to `vectorStore.add()`. The store generates new random IDs, so the RAG class can never map `documentId -> store record IDs`.

**Suggested fix:** Pass `chunks.map(c => c.id)` as the third argument: `await this.config.vectorStore.add(embeddings, metadatas, chunks.map(c => c.id))`. Also store the mapping in the RAG class for `removeDocument` use.

---

### C3. `recursiveChunk` ignores `overlap` in main paragraph logic

- **File:** `src/chunking/strategies.ts:48-102`
- **Impact:** `overlap=100` behaves identically to `overlap=0` for most inputs; broken contract

```typescript
function recursiveChunk(
  content: string, documentId: string, size: number, overlap: number,
): Chunk[] {
  // overlap is validated...
  if (overlap >= size) throw new ChunkingError('Overlap must be less than chunk size');

  const paragraphs = content.split(/\n{2,}/).filter(Boolean);
  // ...
  for (const para of paragraphs) {
    if (current && current.length + trimmed.length > size) {
      chunks.push(makeChunk(current.trim(), documentId, index++));
      current = '';    // <-- no overlap carried over from previous chunk
    }
    // ...
  }
}
```

The `overlap` parameter is passed through to `splitSentences` and `fixedSizeChunk` as fallbacks, but the primary paragraph-accumulation path has zero overlap.

**Suggested fix:** After flushing, set `current` to the trailing `overlap` characters of the flushed chunk (or last paragraph).

---

### C4. `markdownAwareChunk` ignores `overlap` entirely

- **File:** `src/chunking/strategies.ts:149-208`
- **Impact:** Same as C3 — overlap contract is broken

```typescript
function markdownAwareChunk(
  content: string, documentId: string, size: number, overlap: number,
): Chunk[] {
  // overlap is validated at line 157...
  if (overlap >= size) throw new ChunkingError('Overlap must be less than chunk size');

  // but overlap is NEVER referenced anywhere below
  const lines = content.split('\n');
  // ...
}
```

**Suggested fix:** When flushing a chunk, prepend overlap-sized trailing content from the previous chunk.

---

## High Issues

### H1. `addDocument` stores doc info before embedding succeeds — inconsistent state on failure

- **File:** `src/core/RAG.ts:62`
- **Impact:** Ghost document entries that appear in `listDocuments()` but are unqueryable

```typescript
this.documents.set(docInfo.id, docInfo);   // line 62 — premature commit

const chunks = chunkText(parsed.content, docInfo.id, this.chunkOptions);
const embeddings = await this.config.embeddings.embed(texts);    // can throw
await this.config.vectorStore.add(embeddings, metadatas);        // can throw
```

If `embed()` or `vectorStore.add()` throws, the `DocumentInfo` is already stored but no chunks exist. The caller has no way to clean up since they don't know `docInfo.id`.

**Suggested fix:** Move `documents.set()` after successful `vectorStore.add()`, or wrap in try/catch that calls `documents.delete()` on failure.

---

### H2. `updateConfig` can desync from `queryEngine`

- **File:** `src/core/RAG.ts:147-156`
- **Impact:** `this.config.embeddings` and `queryEngine.embeddings` can point to different instances

```typescript
updateConfig(partial: Partial<RAGConfig>): void {
  Object.assign(this.config, partial);  // can overwrite embeddings/vectorStore with undefined
  // queryEngine still holds references to OLD instances
}
```

Three sub-issues:
- (a) `Partial<RAGConfig>` allows `undefined` values, which can overwrite required fields
- (b) Logger updates don't propagate to the query engine
- (c) Mutating a `readonly` config violates the TypeScript contract

**Suggested fix:** Only update defined values (`if (partial.embeddings !== undefined)`); propagate embedding/vectorStore/logger changes to queryEngine.

---

### H3. `'semantic'` strategy name is misleading — it's markdown-aware, not semantic

- **File:** `src/chunking/strategies.ts:19-20`
- **Impact:** Users expecting embedding/topic-based splitting get markdown heading-based splitting

```typescript
case 'semantic':
  return markdownAwareChunk(content, documentId, options.size, options.overlap);
```

**Suggested fix:** Rename to `'markdown'`. Either remove `'semantic'` or implement actual semantic chunking (embedding-based topic detection).

---

### H4. `FileInput` type includes `Buffer` but passing `Buffer` throws at runtime

- **File:** `src/types/index.ts:63`
- **Impact:** Type-level contract doesn't match runtime behavior

```typescript
export type FileInput = string | Buffer | { path: string; content?: Buffer };
```

But `BaseDocumentParser.resolveInput()` throws `ParseError` when given a raw `Buffer`.

**Suggested fix:** Remove `Buffer` from the `FileInput` union type, or add proper Buffer handling in `resolveInput()`.

---

## Medium Issues

### M1. `addDocuments` — no error handling, partial state on failure

- **File:** `src/core/RAG.ts:90-98`
- If the 3rd of 5 files fails, first 2 are partially added. Caller gets an exception with no info about what succeeded.
- **Fix:** Return partial results or wrap with per-file error handling.

### M2. No duplicate document detection

- **File:** `src/core/RAG.ts:45-85`
- Adding the same file path twice creates two entries and double-embeds all chunks, causing duplicate search results and wasted embedding costs.
- **Fix:** Check `this.documents` for existing paths; offer skip or upsert behavior.

### M3. System prompt concatenated into user message instead of separate role

- **File:** `src/query/engine.ts:79-87`
- `systemPrompt + userPrompt` is sent as a single `user` message. Models treat `system` role differently — the "Answer based ONLY on context" guardrail is less reliable as a user message.
- **Fix:** Add structured message support to `LLMProvider` interface, or add a `systemPrompt` parameter to `generate()`.

### M4. No validation of embedding result from `embed()`

- **File:** `src/query/engine.ts:41`
- `const [embedding] = await this.embeddings.embed([question])` — if the provider returns `[]`, `embedding` is `undefined` and `vectorStore.search(undefined, ...)` will crash.
- **Fix:** Validate that `embedding` is a non-empty number array before searching.

### M5. `dimensions` not sent to embedding API

- **File:** `src/embeddings/openai-compatible.ts:50-53`
- The `dimensions` config property is accepted in the constructor but never included in the API request body. For `text-embedding-3-small/large`, the API returns its default size (1536), which may mismatch `this.dimensions`.
- **Fix:** Include `dimensions` in the request body when it differs from the default.

### M6. No batching for embedding API; no response length validation

- **File:** `src/embeddings/openai-compatible.ts:33-69`
- All texts are sent in a single request (OpenAI limits: ~2048 items, token limits). If the API drops items, `json.data.length !== texts.length` and embeddings get silently misassigned to wrong chunks.
- **Fix:** Add batching (e.g., 100-item batches); validate `json.data.length === texts.length`.

### M7. LLM `generate()` throws on empty string response

- **File:** `src/llm/openai-compatible.ts:70-73`
- `if (!content)` is true for both `null`/`undefined` and `""`. A valid empty-string response is incorrectly treated as an error.
- **Fix:** Change to `if (content == null)`.

### M8. LLM `stream()` silently swallows all SSE errors

- **File:** `src/llm/openai-compatible.ts:140-146`
- The catch block swallows everything, including API error events (rate limits, server errors) with no logging.
- **Fix:** Log errors at minimum; consider yielding error indicators or throwing for non-recoverable errors.

### M9. Parser `require()` is ESM-incompatible

- **File:** `src/parsers/index.ts:29-44`
- Uses `require()` for lazy loading while the rest of the codebase uses ESM imports. May not work in ESM-first environments. Additionally, catch blocks swallow all errors (including syntax errors) with no logging.
- **Fix:** Use dynamic `import()` instead; log catch errors.

### M10. `PdfParser` assumes `pdf-parse` v2 API

- **File:** `src/parsers/pdf.ts:26-27`
- The widely-used `pdf-parse` npm package (v1.x) exports a default function, not a `PDFParse` class. Version mismatch causes confusing crashes.
- **Fix:** Handle both v1 and v2 APIs, or pin and document the required version in `package.json`.

### M11. `InMemoryVectorStore.load()` — no validation

- **File:** `src/storage/in-memory.ts:77-80`
- Blind `JSON.parse` + `as StoredRecord[]` assertion. Malformed data or dimension mismatches with stored vectors crash at query time, far from the root cause.
- **Fix:** Validate loaded data structure (array of objects with `id`, `embedding`, `metadata`); check embedding dimensions.

### M12. `Metadata` allows `undefined` — breaks JSON serialization and filtering

- **File:** `src/types/index.ts:26`
- `JSON.stringify` silently drops `undefined` values, so `save()`/`load()` loses data. The `Filter` type doesn't include `undefined`/`null`, so metadata with those values can never match any filter.
- **Fix:** Remove `undefined` from the `Metadata` value type: `[key: string]: string | number | boolean | null`.

### M13. Indirect prompt injection via unsanitized context

- **File:** `src/query/engine.ts:75-77`
- Document content is interpolated directly into the LLM prompt without sanitization. A malicious document containing `"Ignore all previous instructions..."` could influence LLM behavior. Combined with M3 (system prompt in user message), the LLM has less structural distinction between instructions and data.
- **Fix:** Add context delimiters (e.g., XML-tag wrapping `<context>...</context>`); consider sanitizing or escaping user-provided content.

### M14. `queryAndAnswer` discards context on no-results early return

- **File:** `src/query/engine.ts:67-73`
- Returns `context: []` even though `result.context` may contain low-score results the caller could inspect for diagnostics.
- **Fix:** Return `result.context` (the filtered results) instead of `[]`.

---

## Low Issues

### L1. `scoreThreshold` default of 0 passes anti-correlated results
- **File:** `src/types/index.ts:97`
- Cosine similarity can be negative; threshold 0 passes anti-correlated results.
- **Fix:** Consider defaulting to a small positive value (e.g., 0.3 or 0.5).

### L2. Large overlap produces excessive chunks with no warning
- **File:** `src/chunking/strategies.ts:218-240`
- When `overlap ≈ size`, step approaches 1, producing ~`content.length` chunks. No upper bound or warning.
- **Fix:** Add a guard or warning when `overlap > size * 0.8`.

### L3. Empty content produces zero chunks silently
- **File:** `src/chunking/strategies.ts` (all strategies)
- Empty/whitespace-only input returns `[]` with no warning. Document appears in `listDocuments()` but is unqueryable.
- **Fix:** Log a warning or throw when parsed content is empty.

### L4. `SearchResult.documentId` typed optional but always present
- **File:** `src/types/index.ts:105`
- Forces consumers to handle `undefined` that shouldn't occur in practice.
- **Fix:** Make it `string` or properly handle the missing case in `InMemoryVectorStore.search()`.

### L5. No validation of embedding dimensions at ingest time
- **File:** `src/storage/in-memory.ts:19-37`
- Vectors of wrong dimension are accepted on `add()` but crash at `search()` time.
- **Fix:** Validate dimensions on `add()`, ideally against `EmbeddingProvider.dimensions`.

### L6. `cosineSimilarity` can produce NaN/Infinity
- **File:** `src/storage/in-memory.ts:95-113`
- Near-denormal floats can produce `Infinity` or `NaN` in the final division.
- **Fix:** Add `if (!isFinite(result)) return 0;` after the calculation.

### L7. No duplicate ID check in `InMemoryVectorStore.add()`
- **File:** `src/storage/in-memory.ts:30-37`
- Duplicate IDs create multiple records; `delete()` removes all of them.
- **Fix:** Check for existing IDs and warn or update in-place.

### L8. Markdown chunking: code fence detection too broad
- **File:** `src/chunking/strategies.ts:167`
- `line.trim().startsWith('```')` matches both opening and closing fences but doesn't track delimiter type. Nested code examples (e.g., a markdown code sample inside a code block) flip `inCodeBlock` incorrectly.
- **Fix:** Track the opening delimiter (`` ``` `` vs `~~~`) and only close on a matching delimiter.

### L9. Markdown chunking: heading context duplication can exceed `size`
- **File:** `src/chunking/strategies.ts:197`
- `current = currentHeading + line` after a flush can already exceed `size` if `line` is long.
- **Fix:** Check and truncate, or skip heading prepend when `line.length + heading.length > size`.

---

## Recommended Fix Priority

### Phase 1 — Data Integrity (C1 + C2 + H1)
These three issues are interconnected and should be fixed together:

1. **C2:** Pass chunk IDs to `vectorStore.add()` — `src/core/RAG.ts:82`
2. **C1:** Track `documentId -> chunkIds` mapping; call `vectorStore.delete()` in `removeDocument` — `src/core/RAG.ts:62-111`
3. **H1:** Move `documents.set()` after successful embedding — `src/core/RAG.ts:62`

### Phase 2 — Chunking Correctness (C3 + C4)
4. **C3:** Implement overlap in `recursiveChunk` — `src/chunking/strategies.ts:48-102`
5. **C4:** Implement overlap in `markdownAwareChunk` — `src/chunking/strategies.ts:149-208`

### Phase 3 — API Contract Fixes
6. **H3:** Rename `'semantic'` to `'markdown'` — `src/chunking/strategies.ts:19-20`, `src/types/index.ts:72`
7. **H4:** Fix `FileInput` type — `src/types/index.ts:63`
8. **M12:** Remove `undefined` from `Metadata` type — `src/types/index.ts:26`

### Phase 4 — Embedding & LLM Provider Fixes
9. **M5:** Send `dimensions` to embedding API — `src/embeddings/openai-compatible.ts:50-53`
10. **M6:** Add batching and response validation — `src/embeddings/openai-compatible.ts:33-69`
11. **M7:** Fix empty string handling in `generate()` — `src/llm/openai-compatible.ts:70-73`
12. **M8:** Improve SSE error handling in `stream()` — `src/llm/openai-compatible.ts:140-146`

### Phase 5 — Query Engine Improvements
13. **M3:** Support structured messages in LLM provider — `src/types/index.ts:126-132`, `src/llm/openai-compatible.ts`, `src/query/engine.ts:79-87`
14. **M4:** Validate embedding result — `src/query/engine.ts:41`
15. **M13:** Add context delimiters for prompt injection mitigation — `src/query/engine.ts:75-77`
16. **M14:** Return context on no-results — `src/query/engine.ts:67-73`

### Phase 6 — Remaining Medium Items
17. **H2:** Fix `updateConfig` desync — `src/core/RAG.ts:147-156`
18. **M1:** Improve `addDocuments` error handling — `src/core/RAG.ts:90-98`
19. **M2:** Add duplicate document detection — `src/core/RAG.ts:45-85`
20. **M9:** Replace `require()` with `import()` — `src/parsers/index.ts:29-44`
21. **M10:** Handle pdf-parse version compatibility — `src/parsers/pdf.ts:26-27`
22. **M11:** Add validation to `load()` — `src/storage/in-memory.ts:77-80`

### Phase 7 — Low-Priority Polish
23. **L1-L9:** Address as time permits
