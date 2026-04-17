# Chunking Strategy Decision Guide 📋

**For RAG Library App Developers**

This guide helps you choose the right chunking strategy when building applications with this RAG library.

---

## Quick Decision Tree (Production-Ready)

```typescript
function pickChunkingStrategy(document: string): ChunkOptions {
  if (document.split(/\s+/).length < 50) {
    return { strategy: 'fixed', size: 200, overlap: 20 }; // Tiny doc
  }
  if (/^#{1,6}\s+/.test(document)) {
    return { strategy: 'markdown', size: 500, overlap: 50 }; // Has headers
  }
  if (/[A-Z]+:\s+\d+(ST|ND|RD|TH)/.test(document)) {
    return { strategy: 'recursive', size: 600, overlap: 80 }; // Legal/formal
  }
  return { strategy: 'recursive', size: 500, overlap: 50 }; // Default ✓
}
```

---

## Strategy Breakdown

### 1️⃣ FIXED-SIZE 

```typescript
{ strategy: 'fixed', size: 250, overlap: 25 }
```

Splits text by exact character count with configurable overlap.

**When to use:**
- ✅ Simple plain text (emails, notes, chat logs)
- ✅ Very short documents (< 50 words)
- ✅ When you need predictable chunk sizes

**Avoid when:**
- ❌ Markdown docs with headers (`# Section`)
- ❌ Code blocks that must stay intact
- ❌ Legal contracts (cuts mid-sentence)

**Example output:**
```text
Chunk 1: "Hello world\nThis is..." (exactly 250 chars)
Chunk 2: "...t is a test" + 25-char overlap → "a test document"
```

---

### 2️⃣ RECURSIVE 

```typescript
{ strategy: 'recursive', size: 450, overlap: 50 }
```

Splits by semantic boundaries: paragraphs first, then sentences, then fixed-size fallback.

**When to use:**
- ✅ Blog posts, articles, essays (long prose)
- ✅ Legal contracts, agreements
- ✅ Technical documentation without code
- ✅ **DEFAULT choice** for unknown content

**How it works:**
```
1. Splits by paragraphs first (double-newlines)
2. Falls back to sentences (. ! ?)  
3. Ultimate fallback: fixed-size cut
```

**Example output:**
```text
Chunk 1: "Building software requires detail.\n\nMany developers rush..."
         (stopped at paragraph boundary, not arbitrary char count)
```

---

### 3️⃣ MARKDOWN-AWARE 

```typescript
{ strategy: 'markdown', size: 500, overlap: 50 }
```

Preserves Markdown structure: respects headers and never splits inside code blocks.

**When to use:**
- ✅ API documentation (`# Overview`, `## Installation`)
- ✅ GitHub README files
- ✅ Tech blogs with code snippets
- ✅ Any `.md` files

**Special behavior:**
- Preserves headers as chunk boundaries
- Never splits inside code blocks
- Prepends section title to chunks for context

**Example output:**
```text
Chunk 1: "# API Authentication Guide"
Chunk 2: "## Overview\nThis guide explains OAuth 2.0..."
Chunk 3: "## Step 1: Generate Tokens\n[CODE BLOCK...]\n   ..."
         (code block kept intact across multiple lines)
```

---

## Recommended Configurations by Use Case

| Document Type | Strategy | Size | Overlap | Why? |
|--------------|----------|------|---------|------|
| **Technical docs (.md)** | `markdown` | 500 | 50 | Preserves headers/code structure |
| **Legal contracts** | `recursive` | 600 | 80 | Longer context, sentence integrity |
| **Blog/Articles** | `recursive` | 400 | 60 | Paragraph-aware splitting |
| **Emails/Chat logs** | `fixed` | 200 | 20 | Uniform message chunks |
| **Mixed/unknown** | `recursive` | 500 | 50 | Safe default |
| **Code repositories** | `markdown` | 600 | 75 | Keep functions/classes together |

---

## Practical Integration Patterns

### Pattern A: Per-File Detection (Extension-Based)

```typescript
async function addDocumentsWithSmartChunking(files: File[]) {
  const results = [];
  
  for (const file of files) {
    const extension = file.name.split('.').pop();
    const options = getChunkingStrategy(extension);
    
    const result = await rag.addDocuments([file], {
      chunking: options,
    });
    results.push(result);
  }
}

function getChunkingStrategy(ext: string): ChunkOptions {
  switch (ext) {
    case 'md':
    case 'markdown':
      return { strategy: 'markdown', size: 500, overlap: 50 };
    case 'pdf': // Assume legal/contracts
      return { strategy: 'recursive', size: 600, overlap: 80 };
    case 'txt':
      return { strategy: 'fixed', size: 300, overlap: 30 };
    default:
      return { strategy: 'recursive', size: 500, overlap: 50 };
  }
}
```

---

### Pattern B: Content-Based Auto-Detection

```typescript
// Scan first 500 chars to detect type
async function uploadWithAutoStrategy(filePath: string) {
  const preview = fs.readFileSync(filePath, 'utf8').slice(0, 500);
  const recommendation = getChunkingRecommendation('auto', preview);
  
  await rag.addDocuments([{ path: filePath }], {
    chunking: {
      strategy: recommendation.strategy,
      size: recommendation.recommendedSize,
      overlap: recommendation.recommendedOverlap,
    },
  });
}

export function getChunkingRecommendation(content: string): {
  strategy: 'fixed' | 'recursive' | 'markdown';
  recommendedSize: number;
  recommendedOverlap: number;
} {
  const lines = content.split('\n');
  const hasMarkdownHeaders = /^#{1,6}\s+/.test(content);
  const wordCount = content.split(/\s+/).length;
  const avgLineLength = content.length / Math.max(lines.length, 1);

  // Very short content → no need for complex chunking
  if (wordCount < 50) {
    return { strategy: 'fixed', recommendedSize: 200, recommendedOverlap: 20 };
  }

  // Markdown docs with headers
  if (hasMarkdownHeaders) {
    return { strategy: 'markdown', recommendedSize: 500, recommendedOverlap: 50 };
  }

  // Long-form prose
  if (avgLineLength > 30 && lines.some((l) => l.length > 100)) {
    return { strategy: 'recursive', recommendedSize: 400, recommendedOverlap: 60 };
  }

  // Default fallback
  return { strategy: 'recursive', recommendedSize: 500, recommendedOverlap: 50 };
}
```

---

### Pattern C: User-Configurable via UI

```typescript
interface UploadForm {
  files: FileList;
  chunkingStrategy: 'fast' | 'accurate' | 'preserved';
}

const STRATEGY_MAP = {
  fast: { 
    strategy: 'fixed' as const, 
    size: 200, 
    overlap: 20 
  },     // Quick indexing
  
  accurate: { 
    strategy: 'recursive' as const, 
    size: 500, 
    overlap: 50 
  }, // Balanced
  
  preserved: { 
    strategy: 'markdown' as const, 
    size: 600, 
    overlap: 75 
  }, // Structure-first
};

// In React component
const handleSubmit = async () => {
  await rag.addDocuments(files, {
    chunking: STRATEGY_MAP[formData.chunkingStrategy],
  });
};
```

---

## Impact on Search Quality

| Strategy | Pros | Cons | Best For |
|----------|------|------|----------|
| **Fixed** | Fast, predictable | Can break coherence | Small/simple docs |
| **Recursive** | Good sentence integrity | May split mid-section | Prose/legal/general |
| **Markdown** | Perfect structure preservation | Slightly slower | Tech docs/GitHub MD |

### Key Considerations

**Chunk Size:**
- Too small (< 200): Loses context, hard for LLM to answer questions
- Too large (> 800): Embeddings become noisy, retrieval precision drops
- Sweet spot: 400-600 characters for most use cases

**Overlap:**
- Too little (< 20%): Context lost at boundaries
- Too much (> 30%): Wasted tokens, higher costs
- Sweet spot: 10-20% of chunk size

---

## Testing Your Choice

Run the comparison demo:

```bash
bun examples/chunking-strategy-guide.ts
```

This shows all three strategies side-by-side with real documents:
- How many chunks are generated
- Average chunk size achieved
- Coverage statistics
- Example chunk previews

---

## Rule of Thumb Summary

> **If retrieval accuracy matters more than speed** → use `recursive` or `markdown`  
> **If processing millions of small docs** → use `fixed` for performance  
> **When in doubt** → `{ strategy: 'recursive', size: 500, overlap: 50 }`

---

## Common Pitfalls

### ❌ Don't do this:
```typescript
// Hard-coded everywhere - ignores content type
chunking: { strategy: 'fixed', size: 200, overlap: 20 }
```

### ✅ Do this instead:
```typescript
// Detect based on content
chunking: {
  strategy: file.endsWith('.md') ? 'markdown' : 'recursive',
  size: 500,
  overlap: 50,
}
```

---

## Performance Tips

1. **Batch similar types together**: Chunk all `.md` files with one strategy, all `.pdf` with another
2. **Cache strategy decisions**: Store chosen strategy in metadata to avoid re-detection
3. **Profile your data**: Run `chunking-strategy-guide.ts` on a sample of your actual documents first
4. **Start conservative**: If unsure, `recursive` with 500/50 works well for 90% of cases

---

## See Also

- [`examples/chunking-strategy-guide.ts`](./chunking-strategy-guide.ts) - Runnable comparison demo
- [`src/chunking/strategies.ts`](../src/chunking/strategies.ts) - Implementation details
- [`src/types/index.ts`](../src/types/index.ts) - `ChunkOptions` interface definition
