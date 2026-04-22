// ============================================================
// Chunking Strategy Decision Guide — App Developer's Reference
// ============================================================
// PURPOSE:
//   Help developers choose the right chunking strategy for their use case.
//   This file includes live examples you can run to compare strategies.
//
// RUN WITH: `bun examples/chunking-strategy-guide.ts`
// ============================================================

import { chunkText } from '../src/chunking/index.ts';
import type { ChunkOptions } from '../src/types/index.ts';

const SAMPLE_DOCUMENTS = {
  technical_doc: '# API Authentication Guide\n' +
    '\n## Overview\n' +
    'This guide explains how to implement secure authentication in REST APIs using OAuth 2.0 and JWT tokens.\n' +
    '\n## Prerequisites\n' +
    '- Node.js 18+ installed\n' +
    '- Basic understanding of HTTP protocols\n' +
    '- A database for storing refresh tokens\n' +
    '\n## Step 1: Generate Access Tokens\n' +
    '\nThe token expires after 1 hour for security. Always validate expiration on every request.\n' +
    '\n## Step 2: Implement Middleware\n' +
    '\nAdd this middleware to protect your routes. The authentication function verifies tokens.\n' +
    '\n## Best Practices\n' +
    '\n1. Never store secrets in client-side code\n' +
    '2. Use HTTPS for all API communications\n' +
    '3. Rotate JWT secrets quarterly\n' +
    '4. Implement rate limiting to prevent brute force attacks\n' +
    '\n## Error Handling\n' +
    '\nWhen authentication fails, return appropriate HTTP status codes:\n' +
    '- 401: Unauthorized (no token or expired)\n' +
    '- 403: Forbidden (valid token, insufficient permissions)\n' +
    '- 500: Internal Server Error (authentication service down)',

  article_blog: 'Building Great Software Requires Attention To Detail\n' +
    '\nMany developers rush through the coding phase without considering edge cases. This leads to brittle applications that break under unexpected conditions.\n' +
    '\nTesting is essential but often neglected. Write tests before you write code when possible. This practice, known as Test-Driven Development (TDD), forces you to think about requirements upfront.\n' +
    '\nAnother common mistake is ignoring documentation. Future maintainers—sometimes even yourself six months later—will thank you for clear inline comments and README files.\n' +
    '\nPerformance optimization should happen iteratively. Do not prematurely optimize, but do profile regularly. Most applications spend 90% of their time in just 10% of the code—find those hot paths first.\n' +
    '\nSecurity cannot be an afterthought. Input validation, output encoding, and proper authentication are not optional features. They are fundamental requirements for production software.\n' +
    '\nFinally, embrace refactoring. Code will degrade over time unless you actively maintain it. Small, continuous improvements beat massive rewrites every time.',

  legal_contract: 'SERVICE AGREEMENT\n' +
    '\nThis Service Agreement ("Agreement") is entered into between TechCorp Inc. ("Provider") and ClientXYZ LLC ("Client").\n' +
    '\nSECTION 1: SCOPE OF SERVICES\n' +
    'Provider agrees to deliver cloud infrastructure management services including server provisioning, monitoring, backup management, and security auditing. Services shall be performed Monday through Friday, 9 AM to 6 PM EST.\n' +
    '\nSECTION 2: PAYMENT TERMS\n' +
    'Client shall pay Provider monthly fees of $15,000 USD payable within thirty (30) days of invoice receipt. Late payments incur interest at 1.5% per month. All payments made via wire transfer to account number provided in Exhibit A.\n' +
    '\nSECTION 3: CONFIDENTIALITY\n' +
    'Both parties agree to maintain confidentiality of proprietary information shared during contract term. Confidential information excludes publicly available data or information independently developed without reference to disclosed materials. This obligation survives termination for five (5) years.\n' +
    '\nSECTION 4: TERM AND TERMINATION\n' +
    'Initial term is twelve (12) months commencing on January 1st, 2025. Either party may terminate with sixty (60) days written notice. Immediate termination permitted upon material breach if uncured within fifteen (15) business days.\n' +
    '\nSECTION 5: LIMITATION OF LIABILITY\n' +
    'Provider liability capped at total fees paid by Client in preceding twelve months. No consequential damages including lost profits, data loss, or business interruption.\n' +
    '\nSECTION 6: GOVERNING LAW\n' +
    'This Agreement governed by laws of State of Delaware. Any disputes resolved exclusively in courts located in Wilmington County, Delaware.',

  short_notes: '- TODO: Fix login bug\n' +
    '- Meeting at 3pm tomorrow\n' +
    '- Review PR #142\n' +
    '- Deploy to staging',
};

// -- Decision Matrix ---------------------------------------------

/**
 * Choose chunking strategy based on document characteristics
 */
interface StrategyDecision {
  strategy: ChunkOptions['strategy'];
  recommendedSize: number;
  recommendedOverlap: number;
  reasoning: string[];
}

export function getChunkingRecommendation(
  content: string,
): StrategyDecision {
  const lines = content.split('\n');
  const hasMarkdownHeaders = /^#{1,6}\s+/.test(content);
  const avgLineLength = content.length / Math.max(lines.length, 1);
  const wordCount = content.split(/\s+/).length;

  // Very short content → no need for complex chunking
  if (wordCount < 50) {
    return {
      strategy: 'fixed',
      recommendedSize: 200,
      recommendedOverlap: 20,
      reasoning: [
        'Content too short (< 50 words)',
        'Fixed-size works fine for small documents',
        'Consider keeping as single chunk instead',
      ],
    };
  }

  // Markdown docs with headers
  if (hasMarkdownHeaders) {
    return {
      strategy: 'markdown',
      recommendedSize: 500,
      recommendedOverlap: 50,
      reasoning: [
        'Contains Markdown headers (#, ##, etc.)',
        'Markdown strategy preserves section boundaries',
        'Better retrieval for structured technical docs',
      ],
    };
  }

  // Technical/long-form prose with paragraphs
  if (avgLineLength > 30 && lines.some((l) => l.length > 100)) {
    return {
      strategy: 'recursive',
      recommendedSize: 400,
      recommendedOverlap: 60,
      reasoning: [
        'Long sentences/paragraphs detected',
        'Recursive splits by semantic boundaries (sentences)',
        'Better than fixed-size which might cut mid-sentence',
      ],
    };
  }

  // Legal/formal docs with sections
  if (/[A-Z]{5,}:\s+\d{1,2}(ST|ND|RD|TH)?\s*[:.]|\b(SECTION|ARTICLE|CLAUSE)\b/i.test(content)) {
    return {
      strategy: 'recursive',
      recommendedSize: 600,
      recommendedOverlap: 80,
      reasoning: [
        'Appears to be legal/formal document (sections/clauses)',
        'Recursive preserves sentence integrity',
        'Larger chunks needed for context-heavy queries',
        'Higher overlap helps with cross-references',
      ],
    };
  }

  // Default fallback
  return {
    strategy: 'recursive',
    recommendedSize: 500,
    recommendedOverlap: 50,
    reasoning: [
      'Default to recursive for general-purpose content',
      'Good balance between granularity and coherence',
      'Works well across most document types',
    ],
  };
}

// -- Demo Runner -------------------------------------------------

async function main() {
  console.log('=== CHUNKING STRATEGY DECISION GUIDE ===\n');

  const configs = [
    { name: 'Technical Doc (API guide w/markdown)', key: 'technical_doc' as const },
    { name: 'Blog Article (prose)', key: 'article_blog' as const },
    { name: 'Legal Contract (formal)', key: 'legal_contract' as const },
    { name: 'Short Notes (tiny doc)', key: 'short_notes' as const },
  ];

  for (const config of configs) {
    console.log(`\n📄 ${config.name}`);
    console.log('─'.repeat(70));

    const content = SAMPLE_DOCUMENTS[config.key];
    const decision = getChunkingRecommendation(content);

    console.log(`Recommended Strategy: ${decision.strategy.toUpperCase()}`);
    console.log(`Chunk Size: ${decision.recommendedSize} | Overlap: ${decision.recommendedOverlap}`);
    console.log('\nReasoning:');
    decision.reasoning.forEach((r) => console.log(`  • ${r}`));

    // Show actual chunks
    const options: ChunkOptions = {
      strategy: decision.strategy,
      size: decision.recommendedSize,
      overlap: decision.recommendedOverlap,
    };

    const chunks = chunkText(content, 'demo-doc-id', options);

    console.log(`\nGenerated ${chunks.length} chunks:`);
    chunks.slice(0, 3).forEach((chunk, i) => {
      const preview = chunk.content.substring(0, 80).replace(/\n/g, '\\n');
      console.log(`  ${i + 1}. (${chunk.content.length} chars) "${preview}..."`);
    });
    if (chunks.length > 3) {
      console.log(`  ... and ${chunks.length - 3} more chunks`);
    }

    console.log('\n💡 Quick Stats:');
    console.log(`   • Original length: ${content.length} chars`);
    console.log(`   • Avg chunk size: ${Math.round(chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length)} chars`);
    console.log(`   • Coverage: ${(content.length / chunks.reduce((sum, c) => sum + c.content.length, 0) * 100).toFixed(1)}% (lower = more overlap)`);
  }

  // -- Strategy Comparison Table ----------------------------------

  console.log('\n\n========================================');
  console.log('STRATEGY COMPARISON AT A GLANCE');
  console.log('========================================\n');

  console.log(`┌──────────────┬──────────────┬─────────────┬─────────────────────────────┐
│ Strategy     │ When to Use  │ Size Range  │ Avoid When                  │
├──────────────┼──────────────┼─────────────┼─────────────────────────────┤
│ FIXED        │ Simple text  │ 200-400     │ Markdown/code/legal docs    │
│ RECURSIVE    │ Prose/Legal  │ 400-600     │ Need exact header matching  │
│ MARKDOWN     │ Tech docs    │ 400-500     │ Plain text (no overhead)    │
└──────────────┴──────────────┴─────────────┴─────────────────────────────┘\n`);

  console.log('✅ Best defaults for unknown content:');
  console.log('   { strategy: "recursive", size: 500, overlap: 50 }\n');
}

main().catch(console.error);
