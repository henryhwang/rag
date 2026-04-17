// ============================================================
// Query Rewrite Decision Logic with Test Suite
// ============================================================
// PURPOSE:
//   This file contains the core heuristics for automatically deciding 
//   if a user query should be rewritten before searching.
//
// USE CASES:
//   - Validate that your rewrite-detection logic is working correctly
//   - Add/edit decision rules for when to expand queries
//   - Run as: `bun examples/query-rewriter-strategy.ts`
//   - Goal: Maximize true positives (catch complex queries)
//     while minimizing false positives (wasting $0.001 per query)
//
// HOW TO USE IN PRODUCTION:
//   1. Copy just the `shouldRewriteQuery()` function into your app
//   2. Call it in your search handler like:
//      ```
//      const result = await rag.query(userQuery, {
//        rewriteQuery: shouldRewriteQuery(userQuery),
//        topK: 5,
//      });
//      ```
//   3. Delete this test file when deploying
// ============================================================

interface RewriteDecision {
  shouldRewrite: boolean;
  reason?: string;
}

/**
 * Decide if a query benefits from rewriting
 */
export function shouldRewriteQuery(query: string): RewriteDecision {
  const q = query.trim();
  const qLower = q.toLowerCase();
  const words = q.split(/\s+/).length;
  const wordCount = words;

  // -- SKIP: Don't rewrite for these cases ----------------------

  // Empty or very short (no value in expanding)
  if (q.length < 15 || wordCount <= 3) {
    return { shouldRewrite: false, reason: 'Too short' };
  }

  // Simple definition/lookup questions
  if (/^what[']?\s+(is|does|are)?\s+\w+(\s+\w+)?$/.test(qLower)) {
    return { shouldRewrite: false, reason: 'Simple lookup' };
  }

  // Binary yes/no questions (single answer expected)
  if (/^(do|does|is|are|can|will)\s+.+\??$/i.test(q)) {
    return { shouldRewrite: false, reason: 'Yes/No question' };
  }

  // Already multi-query (user expanded themselves)
  if (q.toUpperCase().includes(' OR ') || q.split(/[.,!?]+/).length > 6) {
    return { shouldRewrite: false, reason: 'Already expanded' };
  }

  // -- REWRITE: These benefit from expansion --------------------

  // "How to" / tutorial questions
  if (/\bhow\s+(to|do i|can i|do you)\b/i.test(qLower)) {
    return { shouldRewrite: true, reason: 'Tutorial/how-to' };
  }

  // Best practices, guides, comparisons
  if (
    /\b(?:best\s+(way|practice|approach)|guide|tutorial|compare|versus|vs\.?|alternative)\b/i.test(
      qLower,
    )
  ) {
    return { shouldRewrite: true, reason: 'Exploratory search' };
  }

  // Troubleshooting keywords + enough context
  if (
    wordCount >= 4 &&
    /\b(?:error|issue|problem|trouble|not\s+working|broken|fail(ed)?|bug)\b/i.test(qLower)
  ) {
    return { shouldRewrite: true, reason: 'Troubleshooting' };
  }

  // Long complex queries (multiple concepts likely)
  if (q.length > 100 || wordCount > 12) {
    return { shouldRewrite: true, reason: 'Complex multi-concept query' };
  }

  // Questions with multiple verbs/actions
  const verbs = [
    'install',
    'configure',
    'setup',
    'debug',
    'fix',
    'implement',
    'integrate',
    'deploy',
  ];
  const verbMatches = [...qLower.matchAll(new RegExp(verbs.join('|'), 'g'))];
  if (verbMatches.length >= 2) {
    return { shouldRewrite: true, reason: 'Multi-action query' };
  }

  // Default: conservative skip (BM25 + vector handles simple stuff well)
  return { shouldRewrite: false, reason: 'Standard retrieval suffices' };
}

// ============================================================
// Test examples
// ============================================================

const testQueries = [
  // Simple lookups - NO REWRITE needed
  { query: "What's PI?", expect: false },
  { query: "What is RAG?", expect: false },
  { query: "Define vector embedding", expect: false },
  { query: "Is RAG free?", expect: false },

  // Technical how-tos - REWRITE helpful
  { query: "How to configure nginx SSL certificate", expect: true },
  { query: "How do I connect to postgresql database in nodejs", expect: true },
  { query: "Best way to implement OAuth2 authentication flow", expect: true },
  
  // Troubleshooting - REWRITE helpful
  { query: "Getting 500 error when submitting API requests", expect: true },
  { query: "Database connection timeout not working anymore issue", expect: true },
  { query: "React component renders but state is broken bug fix", expect: true },

  // Complex long queries - REWRITE helpful  
  {
    query: "Best practices for OAuth2 implementation in React apps with TypeScript support for enterprise SSO",
    expect: true,
  },

  // Mixed/some number references - still evaluate normally
  { query: "Error code 500 keeps appearing in logs intermittently", expect: true },
  { query: "API version 2.0 breaking changes documentation", expect: false },
];

async function main() {
  console.log("=== Query Rewrite Decisions ===\n");

  let correct = 0;
  let total = testQueries.length;

  for (const tc of testQueries) {
    const decision = shouldRewriteQuery(tc.query);
    const passed = decision.shouldRewrite === tc.expect;
    if (passed) correct++;

    const icon = decision.shouldRewrite ? "✅ REWRITE" : "❌ SKIP";
    const status = passed ? "✓" : "✗ FAIL";
    
    console.log(`${status} ${icon}`);
    console.log(`  "${tc.query}"`);
    console.log(`  Reason: ${decision.reason}\n`);
  }

  console.log(`\n=== Results: ${correct}/${total} correct (${Math.round((correct / total) * 100)}%) ===`);
}

main().catch(console.error);
