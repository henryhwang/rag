// ============================================================
// Smart RAG Integration Demo with Auto-Rewrite Detection
// ============================================================
// PURPOSE:
//   Full end-to-end example showing how to integrate automatic
//   query rewrite detection into a real RAG application.
//
// WHAT THIS DEMO SHOWS:
//   - Setting up RAG with mock embedding provider (no API key)
//   - Loading sample documents into knowledge base
//   - Processing multiple user queries with auto-decided rewrite
//   - Console output explaining why each query gets rewritten
//     or searched directly
//
// HOW TO RUN:
//   bun examples/smart-rag-usage.ts
//
// WHAT YOU'LL SEE:
//   ✅ Queries like "How to implement OAuth" get REWRITTEN
//      → Expands to find docs using different terminology
//   ❌ Queries like "What is OAuth?" use DIRECT search
//      → Simple lookups don't benefit from expansion
//
// CUSTOMIZE FOR YOUR APP:
//   1. Replace MockEmbeddings with OpenAICompatibleEmbeddings
//   2. Point vectorStore to real data (LocalVectorStore, etc.)
//   3. Copy shouldRewriteQuery() into your production utils/
//   4. Delete this demo file after testing
// ============================================================

import { RAG, InMemoryVectorStore, NoopLogger } from '../src/index.ts';
import { OpenAICompatibleLLM } from '../src/llm/openai-compatible.ts';
import type { QueryOptions } from '../src/types/index.ts';

// -- The Strategy (from previous file) -------------------------

export function shouldRewriteQuery(query: string): boolean {
  const q = query.trim();
  const qLower = q.toLowerCase();
  const wordCount = q.split(/\s+/).length;

  // SKIP cases
  if (q.length < 15 || wordCount <= 3) return false;
  if (/^what[']?\s+(is|does|are)?\s+\w+(\s+\w+)?$/.test(qLower)) return false;
  if (/^(do|does|is|are|can|will)\s+.+\??$/i.test(q)) return false;
  if (q.toUpperCase().includes(' OR ')) return false;

  // REWRITE cases
  if (/\bhow\s+(to|do i|can i)\b/i.test(qLower)) return true;
  if (
    /\b(?:best\s+(way|practice)|guide|tutorial|compare|versus|alternative)\b/i.test(
      qLower,
    )
  )
    return true;
  if (
    wordCount >= 4 &&
    /\b(?:error|issue|problem|trouble|not\s+working|broken|bug|timeout)\b/i.test(qLower)
  )
    return true;
  if (q.length > 100 || wordCount > 12) return true;

  return false;
}

// -- Smart Query Wrapper ----------------------------------------

interface SmartQueryConfig {
  llm?: OpenAICompatibleLLM;
  alwaysRewrite?: boolean;   // Override for debugging/testing
  neverRewrite?: boolean;    // Force skip for cost control
}

async function smartQuery(
  rag: RAG,
  userQuery: string,
  config: SmartQueryConfig,
): Promise<{ result: any; decision: string }> {
  console.log(`\n📝 User asks: "${userQuery}"`);

  // Decide rewrite behavior
  let rewrite = shouldRewriteQuery(userQuery);
  
  if (config.neverRewrite) {
    rewrite = false;
    console.log("⚡ Cost mode: rewriting disabled globally");
  } else if (config.alwaysRewrite) {
    rewrite = true;
    console.log("🔍 Debug mode: forcing rewrite");
  } else if (rewrite) {
    console.log("✅ Rewrite enabled - query is complex/troubleshooting");
  } else {
    console.log("❌ Rewrite skipped - simple lookup expected");
  }

  // Build query options
  const options: QueryOptions = {
    topK: 5,
    scoreThreshold: 0.7,
    rewriteQuery: rewrite,
  };

  // Execute query
  const result = await rag.query(userQuery, options);
  
  return {
    result,
    decision: rewrite ? 'REWRITTEN' : 'DIRECT',
  };
}

// -- Demo Main --------------------------------------------------

async function main() {
  // Initialize RAG with mock embedding provider (no API key needed)
  const rag = new RAG({
    embeddings: {
      dimensions: 4,
      encodingFormat: 'float',
      async embed(texts: string[]) {
        return texts.map((t) => {
          const v = [0, 0, 0, 0];
          for (const c of t) v[c.charCodeAt(0) % 4] += c.charCodeAt(0);
          return v.map((x) => x / Math.max(t.length, 1));
        });
      },
    },
    vectorStore: new InMemoryVectorStore(),
    chunking: { strategy: 'fixed', size: 200, overlap: 20 },
    logger: new NoopLogger(),
  });

  // Add sample documentation
  console.log("=== Loading Knowledge Base ===\n");
  await rag.addDocuments([
    {
      path: 'errors.md',
      content: Buffer.from(
        `# Error Handling Guide

## HTTP Errors
500 Internal Server Error indicates server-side failure. Check logs and database connections.
401 Unauthorized means missing or invalid authentication token.
403 Forbidden indicates insufficient permissions.

## Database Issues
Connection timeouts often occur due to network problems or overloaded DB servers.
Increase connection pool size if seeing "too many connections" errors.`
      ),
    },
    {
      path: 'oauth-guide.md',
      content: Buffer.from(
        `# OAuth 2.0 Implementation Guide

## Setting Up Authorization Code Flow
1. Register your application with the OAuth provider
2. Configure redirect URIs in your app settings
3. Implement the authorization endpoint callback handler
4. Store access tokens securely using encrypted storage

## Best Practices
- Always validate OAuth state parameter to prevent CSRF attacks
- Use HTTPS for all OAuth flows
- Rotate client secrets periodically
- Implement token refresh logic for long-lived sessions`
      ),
    },
    {
      path: 'react-tips.md',
      content: Buffer.from(
        `# React Performance Tips

## Component Optimization
Use React.memo() for pure components that receive expensive props.
Implement virtual lists for large datasets using libraries like react-window.
Avoid inline object/function creation in JSX elements to prevent unnecessary re-renders.

## State Management
Lift state up only when necessary between sibling components.
Consider Redux or Zustand for complex global state needs.
Use localStorage for persisting simple user preferences.`
      ),
    },
  ]);

  // Test queries with auto-decided rewrite strategy
  console.log("\n\n=== Testing Smart Query Strategy ===\n");

  const queries = [
    "What is OAuth?",                         // Skip - simple definition
    "How to implement OAuth flow in React",   // Rewrite - tutorial question
    "500 error keeps happening",              // Rewrite - troubleshooting
    "Why does my API fail with timeout?",     // Rewrite - error + length
    "Is OAuth free?",                         // Skip - yes/no question
    "Best practice for secure token storage implementation guidelines enterprise apps", // Rewrite - long multi-concept
  ];

  for (const q of queries) {
    const { result, decision } = await smartQuery(rag, q, {});
    console.log(`→ Found ${result.context.length} chunks (${decision})`);
    if (result.context.length > 0) {
      console.log(`  Best match: "${result.context[0].content.slice(0, 60)}..."`);
    }
    console.log('─'.repeat(80));
  }

  console.log('\n✓ Demo complete!');
}

main().catch(console.error);
