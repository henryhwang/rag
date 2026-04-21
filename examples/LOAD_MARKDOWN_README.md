# Load Markdown Files to SQLite Vector Store

This example demonstrates how to recursively scan a directory for markdown files, parse and chunk them, store embeddings in a persistent SQLite database, and perform semantic search queries.

## Features Demonstrated

- ✅ Recursive directory scanning for `.md` files
- ✅ Markdown parsing with metadata preservation
- ✅ Text chunking with configurable size and overlap
- ✅ Persistent SQLite vector store (survives across runs)
- ✅ Semantic similarity search
- ✅ Schema metadata tracking (embedding dimension, model info)

## Quick Start

```bash
# Run the demo (creates sample docs if needed, uses mock embeddings)
bun examples/load-markdown-to-sqlite.ts

# Use REAL embeddings from OpenAI API (requires .env file)
USE_REAL_EMBEDDINGS=true bun examples/load-markdown-to-sqlite.ts

# Recreate database from scratch
bun examples/load-markdown-to-sqlite.ts --recreate

# Add more documents to existing database
bun examples/load-markdown-to-sqlite.ts --append

# Query-only mode: test queries on existing database (skip indexing)
bun examples/load-markdown-to-sqlite.ts --query-only
# or shorter:
bun examples/load-markdown-to-sqlite.ts -q
```

### CLI Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--recreate` | - | Remove existing DB and rebuild from scratch |
| `--append` | - | Add new documents to existing DB |
| `--query-only` | `-q` | Skip indexing, only run query tests on existing DB |

## What Happens

1. **Sample Docs Creation** - If `examples/sample-docs/` doesn't exist, the script creates realistic sample documentation files organized in subdirectories.

2. **File Discovery** - Recursively scans for all `.md` files in the target directory.

3. **Document Processing**:
   - Parses each markdown file
   - Splits content into chunks (default: 500 chars, 50 char overlap)
   - Generates embeddings for each chunk
   - Stores in SQLite database

4. **Query Demo** - Runs sample semantic searches showing:
   - Similarity scores (normalized to 0-1 range)
   - Document ID and chunk index
   - Content snippets

5. **Persistence Verification** - Creates a fresh RAG instance and confirms data persists from the SQLite file.

## Output Example

```
=== Markdown to SQLite Vector Store Demo ===

Scanning for .md files...
Found 9 markdown files:

  📄 examples/sample-docs/api/reference.md
  📄 examples/sample-docs/getting-started/introduction.md
  ...

✅ Indexed 9 documents in 96ms
📊 Vector store size: 14 chunks

=== Testing Semantic Search ===

Q: How do I authenticate with OAuth?
   → Found 2 matching chunk(s):

     [★★★★☆ Score: 0.299]
     Doc: 24779284..., Chunk: #1
     ".  To rotate: 1. Generate a new key 2. Update your applications..."
```

## Configuration

Edit the `CONFIG` object at the top of the script:

```typescript
const CONFIG = {
  // Directory to scan for .md files
  docsDirectory: './examples/sample-docs',
  
  // SQLite database path (relative or absolute)
  databaseFile: './rag-store.db',
  
  // Chunking settings
  chunkSize: 500,    // Characters per chunk
  chunkOverlap: 50,  // Overlap between chunks
};
```

## Using Real Embeddings

The example supports **real embedding APIs** out of the box!

### Step 1: Set up environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
USE_REAL_EMBEDDINGS=true
OPENAI_API_KEY=sk-your-actual-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
```

### Step 2: Run with real embeddings

```bash
USE_REAL_EMBEDDINGS=true bun examples/load-markdown-to-sqlite.ts --recreate
```

### Supported Providers

The `OpenAICompatibleEmbeddings` class works with any OpenAI-compatible API:

| Provider | Base URL | Model |
|----------|----------|-------|
| OpenAI | `https://api.openai.com/v1` | `text-embedding-3-small` |
| Azure OpenAI | `https://{your-resource}.openai.azure.com/openai/deployments/{deployment}` | varies |
| Ollama (local) | `http://localhost:11434/v1` | `nomic-embed-text` |
| vLLM | `http://localhost:8000/v1` | varies |
| HuggingFace Inference | `https://api-inference.huggingface.co` | varies |

### Model Dimension Reference

Ensure you set the correct dimensions for your model:

- `text-embedding-3-small`: **1536** dimensions
- `text-embedding-3-large`: **3072** dimensions  
- `text-embedding-ada-002`: **1536** dimensions
- `nomic-embed-text` (Ollama): **768** dimensions
- `all-MiniLM-L6-v2` (HuggingFace): **384** dimensions

### Important Notes

⚠️ **Don't mix models:** Once you create a database with one embedding model, don't add documents with a different model. The vector store enforces consistent dimensions.

⚠️ **Recreate when switching models:** If changing embedding providers/models, use `--recreate` flag to start fresh.

⚠️ **API costs:** Real embeddings incur API costs. Monitor usage at https://platform.openai.com/usage.

## Database File Location

By default, the vector store is saved to `./rag-store.db` in the project root. The file contains:

- All chunk embeddings (as JSON arrays)
- Metadata (document ID, chunk index, content, etc.)
- Schema information (embedding dimension, model name, timestamps)

Add `*.db` to your `.gitignore` as shown in the example's companion changes.

## Sample Documentation Structure

```
examples/sample-docs/
├── README.md
├── getting-started/
│   ├── introduction.md
│   └── setup.md
├── api/
│   ├── reference.md
│   ├── endpoints.md
│   └── authentication/
│       ├── oauth.md
│       └── api-keys.md
└── troubleshooting/
    ├── errors.md
    └── performance.md
```

## Common Use Cases

- **Documentation Search** - Build a searchable knowledge base from markdown docs
- **Content Management** - Index blog posts, tutorials, or guides
- **Code Documentation** - Store and query technical specifications
- **Training Data** - Prepare documentation for RAG-based chatbots

## Troubleshooting

**"Database already exists" warning:**
Run with `--recreate` flag to start fresh, or `--append` to add more documents.

**Dimension mismatch error:**
Ensures you use the same embedding model/configuration when adding new documents. Don't mix different models in the same database.

**No results found:**
Try different query phrasing or increase `topK` parameter. The mock embeddings are simplistic; real embeddings will provide better semantic matching.

## Next Steps

After indexing your documents, integrate with the full RAG pipeline:

```typescript
// Query with answer generation
const result = await rag.queryAndAnswer(
  "How do I set up OAuth authentication?",
  { 
    llm: new OpenAICompatibleLLM({ /* config */ }),
    topK: 3 
  }
);

console.log(result.answer);
console.log("Sources:", result.context);
```
