# Metadata Guide 🔧

**For RAG Library App Developers**

This guide explains the `Metadata` interface and how to use it effectively in your RAG application.

---

## What is `Metadata`?

```typescript
export interface Metadata {
  [key: string]: string | number | boolean | null;
}
```

A flexible key-value store attached to **every chunk** of text stored in your vector database. It holds structured information about where the chunk came from and any custom attributes you want to track.

---

## Where Metadata Lives

Metadata exists at three levels in your RAG pipeline:

### 1️⃣ Document Level (`DocumentInfo.metadata`)

When you upload a file, parsers automatically add basic info:

```typescript
// Parsed from file "docs/oauth-guide.md"
{
  fileName: "oauth-guide.md",     // From MarkdownParser
  fileType: "text/markdown",       // From parser
  sourceUrl: "https://...",        // Custom (you can add!)
  author: "Jane Doe",              // Custom
  department: "Engineering"         // Custom
}
```

### 2️⃣ Chunk Level (`Chunk.metadata`)

When document is split into chunks, each gets its own metadata:

```typescript
const chunks = chunkText(content, docId, options);
// Each chunk starts with empty metadata: {}
chunks[0].metadata  // {} ← Can be customized!
```

### 3️⃣ Storage Level (`VectorStore` metadata)

When storing chunks, metadata is enriched with system fields:

```typescript
const metadatas = chunks.map((c) => ({
  ...c.metadata,           // Your custom fields
  content: c.content,      // System: stores actual text
  documentId: c.documentId,// System: links back to parent doc
  chunkIndex: c.index,     // System: chunk position
}));
```

---

## Real-World Use Cases

### ✅ **Filtering Search Results**

The most powerful use case! Narrow down results by metadata:

```typescript
// Only search docs from the Engineering team
const result = await rag.query("OAuth implementation", {
  filter: { department: "Engineering" },
});

// Only search 2024 documentation
const result = await rag.query("API changes", {
  filter: { year: 2024 },
});

// Multiple filters (AND logic)
const result = await rag.query("Authentication errors", {
  filter: { 
    department: "Security", 
    status: "published",
    version: "2.0"
  },
});
```

**Behind the scenes:**
```typescript
// In storage/in-memory.ts
function matchesFilter(metadata: Metadata, filter: Filter): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false;
  }
  return true;
}
```

---

### ✅ **Result Attribution & Provenance**

Track where answers came from:

```typescript
const result = await rag.query("How do I reset password?");

console.log(result.context[0]);
// {
//   id: "chunk-xyz",
//   content: "To reset your password, go to Settings → Security...",
//   score: 0.87,
//   metadata: {
//     fileName: "user-guide.md",      // Source file
//     fileType: "text/markdown",      
//     documentId: "doc-abc",          // Parent document
//     chunkIndex: 5,                  // Which chunk
//     section: "Account Management",  // Custom header tracking
//     lastUpdated: "2024-03-15"       // Custom freshness indicator
//   }
// }

// Show users attribution
display(`${result.context[0].content} [Source: ${result.context[0].metadata.fileName}]`);
```

---

### ✅ **Document Versioning**

Handle multiple versions of the same document:

```typescript
// Upload new version with metadata tag
await rag.addDocument(
  { path: "api-docs-v2.md", content: buffer },
  { 
    chunking: { strategy: 'markdown', size: 500 },
    extraMetadata: { version: "2.0", effectiveDate: "2024-06-01" }
  }
);

// Query only latest version
const result = await rag.query("Endpoint list", {
  filter: { version: "2.0" },
});
```

---

### ✅ **Multi-Tenant Isolation**

Keep different customers' data separate in same vector store:

```typescript
// Add tenant ID to metadata on upload
await rag.addDocument(file, {
  extraMetadata: { tenantId: "customer-123" },
});

// Queries automatically scoped to current tenant
const result = await rag.query(userQuery, {
  filter: { tenantId: currentUserId.tenantId },
});
```

---

### ✅ **Content Freshness Filtering**

Prioritize recent documentation:

```typescript
// Store upload date as number (timestamp)
await rag.addDocument(file, {
  extraMetadata: { uploadedAt: Date.now() },
});

// Only show docs from last 90 days
const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
// Note: Current implementation supports exact match only
// For range queries, filter client-side after retrieval

const allResults = await rag.query("installation guide");
const freshResults = allResults.context.filter(
  r => r.metadata.uploadedAt && r.metadata.uploadedAt > ninetyDaysAgo
);
```

---

## Adding Custom Metadata

### Method 1: Parser Extensions (Recommended)

Modify or extend existing parsers:

```typescript
import { MarkdownParser } from './parsers/markdown';

class CustomMarkdownParser extends MarkdownParser {
  async parse(file: FileInput): Promise<ParsedDocument> {
    const parsed = await super.parse(file);
    
    // Add custom metadata
    parsed.metadata.customField = this.extractFromContent(parsed.content);
    parsed.metadata.readingTime = this.estimateReadingTime(parsed.content);
    
    return parsed;
  }
  
  private extractFromContent(content: string): string {
    // Extract tags like @tag from content
    const tags = content.match(/@([a-z]+)/g)?.map(t => t.slice(1));
    return tags ? tags.join(', ') : '';
  }
  
  private estimateReadingTime(content: string): number {
    const words = content.split(/\s+/).length;
    return Math.ceil(words / 200); // ~200 words per minute
  }
}

// Use it
rag.updateConfig({ parser: new CustomMarkdownParser() });
```

---

### Method 2: Post-Processing After Addition

Add metadata after initial processing:

```typescript
async function addDocumentWithTags(filePath: string, tags: string[]) {
  // Step 1: Add normally
  const docInfo = await rag.addDocument(filePath);
  
  // Step 2: Retrieve chunks for this document
  // (Note: This requires access to internal storage)
  // Currently limited - better to use Method 1 or 3
  
  // TODO: Implement bulk metadata update in next release
}
```

---

### Method 3: Custom Wrapper Class

Create your own wrapper that adds metadata:

```typescript
class TaggedRAG extends RAG {
  private docMetadata: Map<string, Metadata> = new Map();
  
  async addDocumentWithTaggedMetadata(
    file: string | { path: string; content?: Buffer },
    tags: string[]
  ): Promise<DocumentInfo> {
    const docInfo = await super.addDocument(file);
    
    // Store tags separately
    this.docMetadata.set(docInfo.id, {
      tags: tags.join(','),
      addedBy: getCurrentUser(),
      reviewedAt: new Date().toISOString(),
    });
    
    return docInfo;
  }
  
  async queryWithTagFilter(query: string, requiredTag: string) {
    // Note: Metadata filtering needs to happen at storage level
    // Future enhancement: Merge docMetadata into vector store metadata
  }
}
```

---

## Current Limitations

### ❌ **No Range Queries**

Filters support exact match only:

```typescript
// ✅ Works
filter: { status: "published" }

// ❌ Doesn't work directly
filter: { score: "> 3.5" }  // Treated as string comparison

// Workaround: Filter client-side
const all = await rag.query("best practices");
const goodResults = all.context.filter(
  r => (r.metadata.score as number) >= 3.5
);
```

---

### ❌ **No Partial String Matching**

```typescript
// ✅ Exact match works
filter: { department: "Engineering" }

// ❌ Substring doesn't work
filter: { department: "Eng" }  // Won't match "Engineering"

// ❌ No LIKE / contains
filter: { tags: "%security%" }  // Treated as literal string
```

---

### ❌ **Metadata Not Automatically Copied to Chunks**

Currently, document-level metadata must be manually propagated:

```typescript
// In your custom parser or post-processing
const chunks = chunkText(content, docId, options);

// Manually spread metadata to each chunk
chunks.forEach((chunk, i) => {
  chunk.metadata = {
    ...parsed.metadata,        // Copy doc-level metadata
    chunkIndex: i,
    totalChunks: chunks.length,
  };
});
```

**Future Enhancement Request**: Auto-propagate document metadata to all chunks during `addDocument()`.

---

## Best Practices

### ✅ Do's

1. **Use consistent naming conventions**
   ```typescript
   metadata: {
     department: "Engineering",   // Good: lowercase
     Department: "Product",       // Bad: mixed casing
   }
   ```

2. **Keep values simple (primitive types)**
   ```typescript
   metadata: {
     count: 5,           // ✅ number
     enabled: true,      // ✅ boolean
     name: "test",       // ✅ string
     tags: ["a","b"],    // ⚠️ Arrays work but can't be filtered
     nested: {x:1},      // ⚠️ Objects work but can't be filtered
   }
   ```

3. **Store IDs for foreign keys**
   ```typescript
   metadata: {
     projectId: "proj-123",    // ✅ Easy to filter
     projectDetails: {...},    // ❌ Too complex
   }
   ```

---

### ❌ Don'ts

1. **Don't store sensitive data**
   ```typescript
   // ❌ BAD: API keys in metadata
   metadata: { apiKey: "sk-secret..." }
   
   // ✅ GOOD: Reference external secure storage
   metadata: { secretRefId: "vault-key-123" }
   ```

2. **Don't duplicate content**
   ```typescript
   // ❌ BAD: Full content in metadata
   metadata: { fullContent: "...entire document..." }
   
   // ✅ GOOD: Just references
   metadata: { summary: "Brief 1-line overview" }
   ```

3. **Don't use inconsistent formats**
   ```typescript
   // ❌ BAD: Mixed date formats
   metadata: { 
     createdAt: "2024-01-01",    // string
     updatedAt: 1704067200000    // timestamp number
   }
   
   // ✅ GOOD: Consistent format
   metadata: {
     createdAt: 1704067200000,
     updatedAt: 1704153600000,
   }
   ```

---

## Example: Production Setup

Here's a complete example showing metadata workflow:

```typescript
// 1. Define your metadata schema (document it!)
interface MyAppMetadata {
  fileName: string;         // Auto-filled by parser
  fileType: string;         // Auto-filled by parser
  
  // System-added during storage
  content: string;          // Actual chunk text
  documentId: string;       // Parent document ID
  chunkIndex: number;       // Position in doc
  
  // Custom app-specific fields
  department: string;       // For filtering
  version: string;          // For versioning
  reviewedAt: number;       // Timestamp for freshness
  tags: string;             // Comma-separated tags
}

// 2. Create custom parser to add metadata
class CompanyDocParser extends MarkdownParser {
  async parse(file: FileInput): Promise<ParsedDocument> {
    const parsed = await super.parse(file);
    
    // Extract metadata from file path or content
    const filePath = typeof file === 'string' ? file : file.path;
    const department = this.extractDepartmentFromPath(filePath);
    
    parsed.metadata = {
      ...parsed.metadata,
      department,
      version: "1.0",
      reviewedAt: Date.now(),
      tags: this.extractTags(parsed.content),
    };
    
    return parsed;
  }
  
  private extractDepartmentFromPath(path: string): string {
    if (path.includes('/engineering/')) return 'Engineering';
    if (path.includes('/product/')) return 'Product';
    if (path.includes('/legal/')) return 'Legal';
    return 'General';
  }
  
  private extractTags(content: string): string {
    const matches = content.match(/@([a-z]+)/gi);
    return matches?.map(m => m.slice(1)).join(',') || '';
  }
}

// 3. Initialize RAG with custom parser
const rag = new RAG({
  embeddings: new OpenAICompatibleEmbeddings(...),
  vectorStore: new LocalVectorStore(),
  // Replace default parser or handle in post-processing
});

// 4. Upload with metadata-rich parsing
await rag.addDocument('engineering/auth-flow.md');

// 5. Query with filters
const results = await rag.query("OAuth setup", {
  filter: {
    department: "Engineering",
    version: "1.0",
  },
});

// 6. Display with attribution
results.context.forEach(chunk => {
  console.log(`[${chunk.metadata.fileName}:${chunk.metadata.chunkIndex}]`);
  console.log(chunk.content);
  console.log(`Tags: ${chunk.metadata.tags}`);
});
```

---

## Debugging Tips

### Inspect Stored Metadata

```typescript
// List all documents with their metadata
const docs = rag.listDocuments();
docs.forEach(doc => {
  console.log(`${doc.fileName}:`, JSON.stringify(doc.metadata, null, 2));
});

// Check what's actually stored in vector store
// (Requires accessing internal storage - not exposed in public API yet)
```

### Test Filters

```typescript
// Does filter work?
const testResult = await rag.query("test", {
  filter: { department: "Engineering" },
  topK: 10,
});

if (testResult.context.length === 0) {
  console.warn("No results with this filter!");
  console.log("Check metadata values:", availableDepartments);
}
```

---

## Summary Table

| Feature | Status | Notes |
|---------|--------|-------|
| Attach metadata to documents | ✅ Supported | Via parsers or custom wrappers |
| Filter by metadata | ✅ Supported | Exact match only |
| Range queries | ❌ Not supported | Filter client-side instead |
| Partial string matching | ❌ Not supported | Use tags/categories instead |
| Auto-propagate doc→chunk metadata | ⚠️ Manual | Must copy in custom code |
| Nested objects/arrays | ✅ Stored | But can't filter them |
| Update metadata after upload | ❌ Not yet | Requires re-indexing |

---

## See Also

- [`src/types/index.ts`](../src/types/index.ts) - Interface definitions
- [`src/storage/in-memory.ts`](../src/storage/in-memory.ts) - Filter implementation
- [`src/parsers/markdown.ts`](../src/parsers/markdown.ts) - Example parser with metadata
