// ============================================================
// Load Markdown Files to SQLite Vector Store Example
//
// This example demonstrates:
// 1. Recursively scanning a directory for all .md files
// 2. Parsing and chunking markdown documents
// 3. Storing embeddings in a persistent SQLite database file
// 4. Querying the indexed knowledge base
//
// Run with: bun examples/load-markdown-to-sqlite.ts
// ============================================================

import { RAG, SQLiteVectorStore, NoopLogger, OpenAICompatibleEmbeddings } from '../src/index.ts';
import { type DocumentInfo } from '../src/index.ts'
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// -- Configuration ---------------------------------------------------

const CONFIG = {
  // Directory containing markdown files to index (recursive)
  docsDirectory: './examples/sample-docs',

  // SQLite database file for persistent storage
  databaseFile: './rag-store.db',

  // Chunking settings
  chunkSize: 500,
  chunkOverlap: 50,

  // Embedding configuration - use REAL=true to enable actual API calls
  useRealEmbeddings: process.env.USE_REAL_EMBEDDINGS === 'true',

  // OpenAI-compatible embedding settings (only used if useRealEmbeddings=true)
  embeddingModel: process.env.OPENAI_MODEL || 'text-embedding-3-small',
  embeddingDimensions: parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || '1536'),
};

// -- Recursive Markdown File Loader ----------------------------------

/**
 * Recursively scan a directory for all .md files
 * Returns array of absolute paths
 */
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  async function scan(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  }

  await scan(dir);
  return results;
}

/**
 * Create sample documentation files for demonstration
 */
async function createSampleDocs(): Promise<void> {
  const dirs = [
    'examples/sample-docs',
    'examples/sample-docs/getting-started',
    'examples/sample-docs/api',
    'examples/sample-docs/api/authentication',
    'examples/sample-docs/troubleshooting',
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }

  const docs = {
    'examples/sample-docs/README.md': `# Documentation Home

Welcome to our comprehensive documentation library. This example demonstrates
how to load multiple markdown files recursively and store them in a SQLite
vector database for semantic search.

## Quick Links

- [Getting Started](./getting-started/) - Start here if you're new
- [API Reference](./api/) - Detailed API documentation  
- [Troubleshooting](./troubleshooting/) - Common issues and solutions
`,

    'examples/sample-docs/getting-started/introduction.md': `# Introduction

This guide will help you get started with our platform quickly.

## Prerequisites

Before beginning, ensure you have:
- Node.js 18+ or Bun installed
- A text editor or IDE
- Basic understanding of JavaScript/TypeScript

## Installation

Run the following command to install dependencies:

\`\`\`bash
npm install my-package
\`\`\`

Or with Bun:

\`\`\`bash
bun add my-package
\`\`\`
`,

    'examples/sample-docs/getting-started/setup.md': `# Setup Guide

Follow these steps to configure your environment.

## Step 1: Create Project

Initialize a new project in your desired directory.

## Step 2: Configure Environment Variables

Create a \`.env\` file with the following variables:

- \`API_KEY\` - Your application's API key
- \`DB_HOST\` - Database host address
- \`LOG_LEVEL\` - Debugging verbosity level

## Step 3: Run Migrations

Execute database migrations before first use:

\`\`\`bash
npx migrate up
\`\`\`

## Verification

Check that everything is working by running health check:

\`\`\`bash
curl http://localhost:3000/health
\`\`\`
`,

    'examples/sample-docs/api/reference.md': `# API Reference

Complete reference for all available endpoints.

## Base URL

All API requests should be made to:

\`\`\`
https://api.example.com/v1
\`\`\`

## Rate Limiting

- Free tier: 100 requests per minute
- Pro tier: 1000 requests per minute
- Enterprise: Custom limits

## Response Format

All responses are returned as JSON with the following structure:

\`\`\`json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "abc123",
    "timestamp": 1234567890
  }
}
\`\`\`
`,

    'examples/sample-docs/api/endpoints.md': `# Available Endpoints

## GET /users

Retrieve a list of users.

### Query Parameters

| Parameter | Type   | Description           |
|-----------|--------|-----------------------|
| page      | number | Page number (default: 1) |
| limit     | number | Items per page (max: 100) |
| sort      | string | Sort field            |

### Example

\`\`\`http
GET /users?page=1&limit=10 HTTP/1.1
Host: api.example.com
Authorization: Bearer TOKEN
\`\`\`
`,

    'examples/sample-docs/api/authentication/oauth.md': `# OAuth 2.0 Authentication

Configure OAuth 2.0 for secure third-party integrations.

## Supported Flows

- Authorization Code Flow (recommended for web apps)
- Client Credentials Flow (for server-to-server)
- Refresh Token Flow (for maintaining sessions)

## Setting Up OAuth

1. Register your application in the developer portal
2. Note your Client ID and Client Secret
3. Configure authorized redirect URIs
4. Implement the callback handler

## Security Best Practices

- Never expose client secrets in frontend code
- Always validate state parameter
- Use PKCE for public clients
- Rotate credentials periodically
`,

    'examples/sample-docs/api/authentication/api-keys.md': `# API Key Authentication

Simple authentication using API keys.

## Generating Keys

Navigate to Settings > API Keys > Generate New Key.

Choose appropriate permissions:
- \`read\` - Read-only access
- \`write\` - Read and modify
- \`admin\` - Full administrative access

## Using API Keys

Include your key in the Authorization header:

\`\`\`
Authorization: Bearer YOUR_API_KEY
\`\`\`

## Key Rotation

We recommend rotating API keys every 90 days for security.

To rotate:
1. Generate a new key
2. Update your applications
3. Revoke the old key once verified
`,

    'examples/sample-docs/troubleshooting/errors.md': `# Error Handling

Understanding and resolving common errors.

## HTTP Status Codes

| Code | Name                  | Resolution                    |
|------|-----------------------|-------------------------------|
| 400  | Bad Request           | Check request format          |
| 401  | Unauthorized          | Verify authentication         |
| 403  | Forbidden             | Check permissions             |
| 404  | Not Found             | Verify endpoint path          |
| 429  | Too Many Requests     | Wait and retry with backoff   |
| 500  | Internal Server Error | Contact support               |

## Timeout Issues

If requests timeout:
1. Check network connectivity
2. Increase timeout value in client config
3. Consider implementing retry logic with exponential backoff
`,

    'examples/sample-docs/troubleshooting/performance.md': `# Performance Optimization

Tips for optimizing application performance.

## Caching Strategies

Implement caching at multiple levels:
- Browser cache for static assets
- CDN for global distribution
- Application-level caching for frequent queries

## Connection Pooling

Configure connection pools to handle concurrent requests:

\`\`\`javascript
poolConfig: {
  minConnections: 5,
  maxConnections: 50,
  idleTimeoutMs: 30000
}
\`\`\`

## Monitoring

Use distributed tracing to identify bottlenecks:
- Track request latency percentiles
- Monitor error rates by endpoint
- Set up alerts for anomalies
`,
  };

  // Write all documentation files
  for (const [filePath, content] of Object.entries(docs)) {
    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`✓ Created: ${filePath}`);
  }
}

// -- Query-Only Mode ---------------------------------------------------

async function runQueryOnlyMode() {
  console.log(`Initializing SQLite vector store (${CONFIG.databaseFile})...`);

  // Choose embedding provider (same logic as main)
  let embeddings: any;
  if (CONFIG.useRealEmbeddings) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'USE_REAL_EMBEDDINGS=true but OPENAI_API_KEY is not set.'
      );
    }
    embeddings = new OpenAICompatibleEmbeddings({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: CONFIG.embeddingModel,
    });
    console.log(`   → Model: ${CONFIG.embeddingModel}`);
  } else {
    console.log('   → Using MockEmbeddings');
    embeddings = {
      dimensions: 16, async embed(texts: string[]) {
        return texts.map((t) => {
          const v = new Array(16).fill(0);
          for (let i = 0; i < t.length && i < 160; i++) {
            v[i % 16] += t.charCodeAt(i) * Math.sin(i + t.length);
          }
          return v.map((x) => x / Math.max(t.length, 1));
        });
      }
    };
  }

  const rag = new RAG({
    embeddings,
    vectorStore: new SQLiteVectorStore({
      url: `file:${CONFIG.databaseFile}`,
    }),
    chunking: { strategy: 'fixed', size: CONFIG.chunkSize, overlap: CONFIG.chunkOverlap },
    logger: new NoopLogger(),
  });

  // Initialize and load from DB

  console.log(`✅ Loaded ${rag['config'].vectorStore.size} chunks\n`);
  console.log('Schema:', rag['config'].vectorStore.metadata);

  // Run test queries
  console.log('\n=== Testing Semantic Search ===\n');

  const testQueries = [
    'How do I authenticate with OAuth?',
    'What causes timeout issues?',
    'How to set up the project?',
    'What are the rate limits?',
    'API key rotation best practices',
  ];

  for (const query of testQueries) {
    console.log(`Q: ${query}`);
    const result = await rag.query(query, { topK: 2 });

    if (result.context.length === 0) {
      console.log('   → No results found\n');
    } else {
      console.log(`   → Found ${result.context.length} matching chunk(s):\n`);
      for (const ctx of result.context) {
        const snippet = ctx.content.replace(/\n/g, ' ').slice(0, 120);
        const chunkIdx = ctx.metadata?.chunkIndex ?? '?';
        const docIdShort = ctx.metadata?.documentId ? String(ctx.metadata.documentId).slice(0, 8) : 'unknown';
        console.log(`     [${scoreToStar(ctx.score)} Score: ${ctx.score.toFixed(3)}]`);
        console.log(`     Doc: ${docIdShort}..., Chunk: #${chunkIdx}`);
        console.log(`     "${snippet}..."`);
      }
    }
    console.log('─'.repeat(60));
  }

  console.log('\n✅ Query testing complete!\n');
}

// -- Main ------------------------------------------------------------

interface DemoMode {
  recreate: boolean;
  append: boolean;
  queryOnly: boolean;     // Test queries only on existing store
}

/** Parse CLI args */
function parseArgs(): DemoMode {
  const args = process.argv.slice(2);
  return {
    recreate: args.includes('--recreate'),
    append: args.includes('--append'),
    queryOnly: args.includes('--query-only') || args.includes('-q'),
  };
}

async function main() {
  const options = parseArgs();

  console.log('=== Markdown to SQLite Vector Store Demo ===\n');

  // Handle --query-only mode
  if (options.queryOnly) {
    console.log('🔍 Query-only mode (using existing database)\n');

    try {
      await fs.access(CONFIG.databaseFile);
    } catch {
      console.error(
        `❌ Error: Database ${CONFIG.databaseFile} does not exist.\n` +
        'Run without --query-only to index documents first.'
      );
      process.exit(1);
    }

    // Skip directly to querying - use separate function
    await runQueryOnlyMode();
    process.exit(0);
  }

  // Optional: Recreate database from scratch
  if (options.recreate) {
    try {
      await fs.unlink(CONFIG.databaseFile);
      console.log(`Removed existing database: ${CONFIG.databaseFile}`);
    } catch { }
  }

  // Check if database already exists
  let existingStore = false;
  try {
    await fs.access(CONFIG.databaseFile);
    existingStore = true;
  } catch { }

  if (existingStore && !options.append) {
    console.log(`⚠️  Database ${CONFIG.databaseFile} already exists.`);
    console.log('   Use --recreate to start fresh, --append to add more docs,\n   or --query-only (-q) to test queries on existing data.\n');
  }

  // Step 1: Create sample docs if they don't exist
  try {
    await fs.access(CONFIG.docsDirectory);
  } catch {
    console.log('Creating sample documentation files...\n');
    await createSampleDocs();
    console.log();
  }

  // Step 2: Find all .md files recursively
  console.log('Scanning for .md files...');
  const mdFiles = await findMarkdownFiles(CONFIG.docsDirectory);
  console.log(`Found ${mdFiles.length} markdown files:\n`);
  for (const f of mdFiles) {
    console.log(`  📄 ${f}`);
  }
  console.log();

  // Step 3: Initialize RAG with SQLite vector store
  console.log(`Initializing SQLite vector store (${CONFIG.databaseFile})...`);

  // Choose embedding provider
  let embeddings: any;
  if (CONFIG.useRealEmbeddings) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'USE_REAL_EMBEDDINGS=true but OPENAI_API_KEY is not set.\n' +
        'Set your API key in .env file or as an environment variable.'
      );
    }
    embeddings = new OpenAICompatibleEmbeddings({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: CONFIG.embeddingModel,
    });
    console.log(`   → Model: ${CONFIG.embeddingModel}`);
    console.log(`   → Dimensions: ${CONFIG.embeddingDimensions}`);
    console.log(`   → Base URL: ${process.env.OPENAI_BASE_URL}`);
  } else {
    // Fallback to mock embeddings for testing
    console.log('   → Using MockEmbeddings (no API calls)');
    console.log('   → Set USE_REAL_EMBEDDINGS=true to use real embeddings');
    embeddings = {
      dimensions: 16, async embed(texts: string[]) {
        return texts.map((t) => {
          const v = new Array(16).fill(0);
          for (let i = 0; i < t.length && i < 160; i++) {
            v[i % 16] += t.charCodeAt(i) * Math.sin(i + t.length);
          }
          return v.map((x) => x / Math.max(t.length, 1));
        });
      }
    };
  }

  const rag = new RAG({
    embeddings,
    vectorStore: new SQLiteVectorStore({
      url: `file:${CONFIG.databaseFile}`,
    }),
    chunking: {
      strategy: 'fixed',
      size: CONFIG.chunkSize,
      overlap: CONFIG.chunkOverlap,
    },
    logger: {
      debug: () => { },
      info: console.log,
      warn: console.warn,
      error: console.error,
    },
  });

  // Step 4: Load all documents (skip if testing existing store)
  //let docs: ReturnType<typeof rag.addDocuments> | undefined;
  let docs: DocumentInfo[] | undefined

  if (!existingStore || options.append) {
    console.log('Loading documents into vector store...\n');

    const startTime = Date.now();
    docs = await rag.addDocuments(mdFiles);
    const duration = Date.now() - startTime;

    console.log(`✅ Indexed ${docs.length} documents in ${duration}ms`);
    console.log(`📊 Vector store size: ${rag['config'].vectorStore.size} chunks`);
  } else {
    // Initialize the store without adding new docs
    console.log(`Using existing store with ${rag['config'].vectorStore.size} chunks\n`);
  }


  // Show document summary
  if (docs) {
    console.log('\n📋 Documents indexed:');
    for (const doc of docs) {
      const estimatedChunks = Math.ceil(doc.content.length / CONFIG.chunkSize);
      console.log(`  • ${doc.fileName}`);
      console.log(`    ID: ${doc.id.slice(0, 8)}..., Est. chunks: ~${estimatedChunks}`);
    }
  }

  // Step 5: Demonstrate queries
  console.log('\n\n=== Testing Semantic Search ===\n');

  const testQueries = [
    'How do I authenticate with OAuth?',
    'What causes timeout issues?',
    'How to set up the project?',
    'What are the rate limits?',
    'API key rotation best practices',
  ];

  for (const query of testQueries) {
    console.log(`Q: ${query}`);
    const result = await rag.query(query, { topK: 2 });

    if (result.context.length === 0) {
      console.log('   → No results found\n');
    } else {
      console.log(`   → Found ${result.context.length} matching chunk(s):\n`);
      for (const ctx of result.context) {
        const snippet = ctx.content.replace(/\n/g, ' ').slice(0, 120);
        // Show chunk index within its document
        const chunkIdx = ctx.metadata?.chunkIndex ?? '?';
        const docIdShort = ctx.metadata?.documentId ? String(ctx.metadata.documentId).slice(0, 8) : 'unknown';
        console.log(`     [${scoreToStar(ctx.score)} Score: ${ctx.score.toFixed(3)}]`);
        console.log(`     Doc: ${docIdShort}..., Chunk: #${chunkIdx}`);
        console.log(`     "${snippet}..."`);
      }
    }
    console.log('─'.repeat(60));
  }

  // Step 6: Demonstrate RAG lifecycle management
  console.log('\n=== Proper Lifecycle Management ===\n');
  
  console.log('✅ Using RAG.initialize() and RAG.close():\n');
  
  // Clean up first instance properly
  await rag.close();
  console.log('Closed first RAG instance (releases DB connections)');
  
  // Create fresh instance for query-only mode
  const ragQuery = new RAG({
    embeddings: embeddings,
    vectorStore: new SQLiteVectorStore({ url: `file:${CONFIG.databaseFile}` }),
    chunking: { strategy: 'fixed', size: CONFIG.chunkSize, overlap: CONFIG.chunkOverlap },
    logger: new NoopLogger(),
  });
  
  // Initialize before querying (loads data from DB into memory)
  await ragQuery.initialize();
  console.log(`Initialized second RAG instance (${ragQuery['config'].vectorStore.size} chunks loaded)`);
  
  // Test query
  const testResult = await ragQuery.query('OAuth setup', { topK: 1 });
  console.log(`✅ Query on initialized store: ${testResult.context.length} result(s)`);
  
  // Close when done
  ragQuery.close();
  console.log('\n✓ All resources cleaned up!\n');

  console.log('✅ Demo complete! Database saved to:', CONFIG.databaseFile);
  console.log('   The vector store persists across runs.');
}

// Helper: Convert score to visual stars
function scoreToStar(score: number): string {
  const pct = Math.min(Math.max(score + 0.5, 0), 1);
  const stars = Math.round(pct * 5);
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

main().catch(console.error);
