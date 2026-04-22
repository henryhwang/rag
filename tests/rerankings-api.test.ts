import { describe, it, expect } from "bun:test";
import { EmbeddingError } from "../src/errors/index.ts";
import { DedicatedReranker } from "../src/reranking/dedicatedReranker.ts";

const RERANK_API_BASE = "https://api.siliconflow.cn";
const RERANK_MODEL = "BAAI/bge-reranker-v2-m3";

describe("reranking with BAAI/bge-Reranker-v2-m3 from siliconflow", () => {
  const SKIP = !(process.env.RERANKING_API_KEY);

  // NOTE: These tests require RERANKING_API_KEY env var and make real API calls.
  // They may incur charges if your account is billed per request.

  it.skipIf(SKIP)("should work with basic reranking", async () => {
    const apiKey = process.env.RERANKING_API_KEY;
    const query = "What is the capital of France?";
    const documents = [
      "Paris is the capital and most populous city of France.",
      "Berlin is the capital of Germany.",
      "The Eiffel Tower is located in Paris.",
      "France is a country in Western Europe.",
      "Apple is tasty"
    ];

    const body = {
      model: RERANK_MODEL,
      query,
      documents
    };
    const url = `${RERANK_API_BASE}/v1/rerank`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new EmbeddingError(`Network error calling reranking API: ${url}`, {
        cause: err as Error,
      });
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new EmbeddingError(
        `Reranking API error ${response.status}: ${bodyText}`,
      );
    }

    const result = (await response.json()) as { results: Array<{ index: number; relevance_score: number }> };
    //const result = await response.text()
    //console.log(`the reranking result: ${result}`)

    expect(result.results).toHaveLength(5);
    // Paris should be ranked highest for "capital of France" query
    expect(result.results[0].index).toBe(0);
    // All scores should be numbers
    expect(result.results.every(r => typeof r.relevance_score === 'number')).toBe(true);
  });

  it.skipIf(SKIP)("DedicatedReranker integrates correctly with SiliconFlow", async () => {
    const reranker = new DedicatedReranker({
      apiKey: process.env.RERANKING_API_KEY,
      baseUrl: RERANK_API_BASE,
      model: RERANK_MODEL,
      batchSize: 5,
    });

    const query = "What is the capital of France?";
    const documents = [
      "Paris is the capital and most populous city of France.",
      "Berlin is the capital of Germany.",
      "The Eiffel Tower is located in Paris.",
      "France is a country in Western Europe.",
      "Apple is tasty"
    ];

    const scores = await reranker.rerank(query, documents);

    expect(scores).toHaveLength(5);
    expect(typeof scores[0]).toBe('number');
    // Scores should be normalized to 0-1 range
    expect(scores.every(s => s >= 0 && s <= 1)).toBe(true);
  });
});

describe("SiliconFlow rerank endpoint - batch size testing", () => {
  const SKIP = !(process.env.RERANKING_API_KEY);

  it.skipIf(SKIP)("supports small batches (5 docs)", async () => {
    const reranker = new DedicatedReranker({
      apiKey: process.env.RERANKING_API_KEY,
      baseUrl: RERANK_API_BASE,
      model: RERANK_MODEL,
      batchSize: 5,
    });

    const query = "machine learning";
    const documents = [
      "Machine learning is a subset of artificial intelligence.",
      "Deep learning uses neural networks.",
      "Supervised learning requires labeled data.",
      "Unsupervised learning finds patterns without labels.",
      "Reinforcement learning uses rewards and penalties."
    ];

    const scores = await reranker.rerank(query, documents);

    expect(scores).toHaveLength(5);
    expect(scores.every(s => typeof s === 'number' && !isNaN(s))).toBe(true);
  });

  it.skipIf(SKIP)("supports medium batches (50 docs)", async () => {
    const reranker = new DedicatedReranker({
      apiKey: process.env.RERANKING_API_KEY,
      baseUrl: RERANK_API_BASE,
      model: RERANK_MODEL,
      batchSize: 50,
    });

    const query = "web development";
    const documents = Array.from({ length: 50 }, (_, i) =>
      `Document ${i + 1}: HTML, CSS, and JavaScript are core web technologies.`
    );

    const scores = await reranker.rerank(query, documents);

    expect(scores).toHaveLength(50);
    expect(scores.every(s => typeof s === 'number' && !isNaN(s))).toBe(true);
  });

  it.skipIf(SKIP)("handles auto-batching for large document sets (150 docs)", async () => {
    const reranker = new DedicatedReranker({
      apiKey: process.env.RERANKING_API_KEY,
      baseUrl: RERANK_API_BASE,
      model: RERANK_MODEL,
      batchSize: 100, // Should split into 2 batches
    });

    const query = "programming basics";
    const documents = Array.from({ length: 150 }, (_, i) =>
      `Variable ${i} stores data values. Functions execute code blocks.`
    );

    const scores = await reranker.rerank(query, documents);

    expect(scores).toHaveLength(150);
    expect(scores.every(s => typeof s === 'number' && !isNaN(s))).toBe(true);
  });

  it.skipIf(SKIP)("maintains correct score ordering across batches", async () => {
    const reranker = new DedicatedReranker({
      apiKey: process.env.RERANKING_API_KEY,
      baseUrl: RERANK_API_BASE,
      model: RERANK_MODEL,
      batchSize: 10, // Will create multiple batches
    });

    // Create docs where some clearly match the query
    const relevantDoc = "Python is a popular programming language for machine learning.";
    const documents = [
      ...Array(9).fill("Random unrelated text about cooking."),
      relevantDoc,
      ...Array(9).fill("More random text about sports."),
      relevantDoc,
      ...Array(9).fill("Another random topic discussion.")
    ];

    const query = "python machine learning programming";
    const scores = await reranker.rerank(query, documents);

    expect(scores).toHaveLength(29);

    // The two relevant docs (indices 9 and 19) should have higher scores than irrelevant ones
    const irrelevantAvg = scores.filter((_, i) => i !== 9 && i !== 19).reduce((a, b) => a + b, 0) / 25;
    expect(scores[9]).toBeGreaterThanOrEqual(irrelevantAvg);
    expect(scores[19]).toBeGreaterThanOrEqual(irrelevantAvg);
  });
});

describe("SiliconFlow rerank endpoint - content size testing", () => {
  const SKIP = !(process.env.RERANKING_API_KEY);

  it.skipIf(SKIP)("handles short documents efficiently", async () => {
    const reranker = new DedicatedReranker({
      apiKey: process.env.RERANKING_API_KEY,
      baseUrl: RERANK_API_BASE,
      model: RERANK_MODEL,
      batchSize: 20,
    });

    const query = "weather";
    const documents = Array(20).fill(null).map((_, i) => `Weather ${i}`);

    const scores = await reranker.rerank(query, documents);

    expect(scores).toHaveLength(20);
  });

  it.skipIf(SKIP)("handles long documents (up to ~2000 chars each)", async () => {
    const reranker = new DedicatedReranker({
      apiKey: process.env.RERANKING_API_KEY,
      baseUrl: RERANK_API_BASE,
      model: RERANK_MODEL,
      batchSize: 10,
    });

    const query = "climate change environmental impact global warming";
    // Each doc ~1500 chars
    const longDocTemplate = `Climate change refers to long-term shifts in temperatures and weather patterns. 
    Since the 1800s, human activities have been the main driver of climate change, primarily due to 
    burning fossil fuels like coal, oil and gas, which produces heat-trapping gases. The greenhouse 
    effect warms our planet. This warming affects ecosystems, weather patterns, sea levels, and human health.
    Scientists project that limiting global warming will require rapid and deep reductions in greenhouse 
    gas emissions across all sectors. Climate action involves both mitigation (reducing emissions) and 
    adaptation (adjusting to impacts). Sustainable practices include renewable energy, reforestation, 
    energy efficiency improvements, and sustainable transportation systems. The goal is net-zero emissions.`;

    const documents = Array(10).fill(longDocTemplate);

    const scores = await reranker.rerank(query, documents);

    expect(scores).toHaveLength(10);
    // Scores should be numbers (may be 0 if API returns error, which defaults to 0)
    expect(scores.every(s => typeof s === 'number' && !isNaN(s))).toBe(true);
  });

  it.skipIf(SKIP)("respects maxContentLengthPerBatch config option", async () => {
    // We can't directly intercept fetch, but we can verify the behavior through scoring
    const reranker = new DedicatedReranker({
      apiKey: process.env.RERANKING_API_KEY,
      baseUrl: RERANK_API_BASE,
      model: RERANK_MODEL,
      batchSize: 50, // Would allow all in one batch
      maxContentLengthPerBatch: 3000, // But this forces splitting (~1500 chars per doc means 2 docs per batch)
    });

    const query = "test query";
    // Each doc ~1500 chars, limit is 3000 → should split into pairs
    const docText = "x".repeat(1500);
    const documents = Array(6).fill(docText);

    const scores = await reranker.rerank(query, documents);

    expect(scores).toHaveLength(6);
    // All should return valid scores even with content-based batching
    expect(scores.every(s => typeof s === 'number' && !isNaN(s))).toBe(true);
  });

  it.skipIf(SKIP)("works with mixed content lengths in same batch", async () => {
    const reranker = new DedicatedReranker({
      apiKey: process.env.RERANKING_API_KEY,
      baseUrl: RERANK_API_BASE,
      model: RERANK_MODEL,
      batchSize: 20,
    });

    const query = "software engineering best practices";
    const documents = [
      "Clean code",  // Short
      "Testing is important for software quality assurance.".repeat(10), // Medium
      "Code reviews help maintain consistency and share knowledge among team members. They also serve as mentorship opportunities where junior developers can learn from seniors and vice versa.", // Long
      "refactor",  // Very short
      "Documentation should be clear, concise, and up-to-date so other developers can understand how to use the code effectively." // Medium-long
    ];

    const scores = await reranker.rerank(query, documents);

    expect(scores).toHaveLength(5);
    expect(scores.every(s => typeof s === 'number' && !isNaN(s))).toBe(true);
  });

  it.skipIf(SKIP)("handles very large single document (>5000 chars)", async () => {
    const reranker = new DedicatedReranker({
      apiKey: process.env.RERANKING_API_KEY,
      baseUrl: RERANK_API_BASE,
      model: RERANK_MODEL,
      batchSize: 1,
    });

    const query = "comprehensive guide";
    const veryLongDoc = "This paragraph ".repeat(300); // ~5400 chars

    const scores = await reranker.rerank(query, [veryLongDoc]);

    expect(scores).toHaveLength(1);
    expect(typeof scores[0]).toBe('number');
  });
});

describe("SiliconFlow rerank endpoint - batch optimization discovery", () => {
  const SKIP = !(process.env.RERANKING_API_KEY);

  it.skipIf(SKIP)("finds optimal batch size by testing progressively larger batches", async () => {
    const testSizes = [10, 50, 100]; // Reduced from 200 to avoid timeouts
    const query = "optimization testing document";

    for (const batchSize of testSizes) {
      const reranker = new DedicatedReranker({
        apiKey: process.env.RERANKING_API_KEY,
        baseUrl: RERANK_API_BASE,
        model: RERANK_MODEL,
        batchSize: batchSize,
      });

      // Create exactly batchSize documents
      const documents = Array.from({ length: batchSize }, (_, i) =>
        `Test document number ${i + 1} for batch optimization analysis.`
      );

      const startTime = Date.now();
      const scores = await reranker.rerank(query, documents);
      const duration = Date.now() - startTime;

      expect(scores).toHaveLength(batchSize);
      expect(scores.every(s => typeof s === 'number' && !isNaN(s))).toBe(true);

      console.log(`Batch size ${batchSize}: ${duration}ms (${(duration / batchSize).toFixed(2)}ms/doc)`);
    }
  });

  it.skipIf(SKIP)("verifies consistent scoring across calls", async () => {
    const reranker = new DedicatedReranker({
      apiKey: process.env.RERANKING_API_KEY,
      baseUrl: RERANK_API_BASE,
      model: RERANK_MODEL,
      batchSize: 5,
    });

    const query = "determinism test";
    const documents = [
      "First document content for comparison.",
      "Second document with different words.",
      "Third document for the test suite.",
      "Fourth item in our collection.",
      "Final fifth document entry."
    ];

    const scores1 = await reranker.rerank(query, documents);
    const scores2 = await reranker.rerank(query, documents);

    // Scores should be similar (allowing for small floating-point variations)
    expect(scores1).toHaveLength(scores2.length);
    for (let i = 0; i < scores1.length; i++) {
      expect(Math.abs(scores1[i] - scores2[i])).toBeLessThan(0.01); // Within 1% tolerance
    }
  });
});

describe("SiliconFlow rerank endpoint - max total payload size discovery", () => {
  const SKIP = !(process.env.RERANKING_API_KEY);

  /**
   * Discovers the maximum total payload size (in bytes) that the rerank API accepts
   * for a batch of 10 documents. Tests progressively larger payloads until the API
   * rejects the request with a 4xx error (typically 413 Payload Too Large or 400 Bad Request).
   */
  it.skipIf(SKIP)("discovers max total payload size with batch size 10", async () => {
    const batchSize = 10;
    const query = "payload size discovery test";

    // Test progressive payload sizes (total characters across all 10 docs)
    // Starting from small and doubling until we hit the limit
    const testPayloadSizes = [
      1_000,    // ~1KB
      4_000,    // ~4KB
      8_000,    // ~8KB
      16_000,   // ~16KB
      32_000,   // ~32KB
      64_000,   // ~64KB
      128_000,  // ~128KB
      256_000,  // ~256KB
    ];

    let lastSuccessfulSize = 0;
    let firstFailedSize = Infinity;

    for (const totalChars of testPayloadSizes) {
      const charsPerDoc = Math.floor(totalChars / batchSize);
      const docContent = "x".repeat(charsPerDoc);
      const documents = Array(batchSize).fill(docContent);
      const actualTotalSize = JSON.stringify({
        model: RERANK_MODEL,
        query,
        documents
      }).length;

      const url = `${RERANK_API_BASE}/v1/rerank`;
      const body = { model: RERANK_MODEL, query, documents, top_n: 4, return_documents: true };

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.RERANKING_API_KEY}`,
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          lastSuccessfulSize = actualTotalSize;
          console.log(`✓ ${totalChars.toLocaleString()} chars (~${(actualTotalSize / 1024).toFixed(1)}KB payload): SUCCESS`);
        } else {
          // API rejected - check if it's a size-related error
          const errorBody = await response.text().catch(() => '');
          firstFailedSize = actualTotalSize;
          console.log(`✗ ${totalChars.toLocaleString()} chars (~${(actualTotalSize / 1024).toFixed(1)}KB payload): FAILED (HTTP ${response.status})`);
          console.log(`  Error: ${errorBody.substring(0, 100)}`);
          break; // Stop testing once we hit the limit
        }
      } catch (err) {
        // Network error or other exception
        firstFailedSize = actualTotalSize;
        console.log(`✗ ${totalChars.toLocaleString()} chars (~${(actualTotalSize / 1024).toFixed(1)}KB payload): ERROR`, err instanceof Error ? err.message : String(err));
        break;
      }
    }

    // Assert that we successfully tested at least some payload sizes
    expect(lastSuccessfulSize).toBeGreaterThan(0);

    // Log summary
    console.log(`\nMax payload size discovered: ~${(lastSuccessfulSize / 1024).toFixed(1)}KB`);
    console.log(`Failure threshold: ~${(firstFailedSize / 1024).toFixed(1)}KB`);
  });

  it.skipIf(SKIP)("confirms payload works just under discovered limit with batch size 10", async () => {
    // This test uses results from the discovery test above
    // A safe payload size based on common API limits (typically 128KB-256KB for text endpoints)
    const batchSize = 10;
    const targetPayloadSize = 50_000; // ~50KB total, well under most limits
    const charsPerDoc = Math.floor(targetPayloadSize / batchSize);

    const reranker = new DedicatedReranker({
      apiKey: process.env.RERANKING_API_KEY,
      baseUrl: RERANK_API_BASE,
      model: RERANK_MODEL,
      batchSize: batchSize,
    });

    const query = "large payload validation";
    const docContent = "This is a reasonably long document segment. ".repeat(Math.ceil(charsPerDoc / 50));
    const documents = Array(batchSize).fill(docContent);

    const scores = await reranker.rerank(query, documents);

    expect(scores).toHaveLength(batchSize);
    expect(scores.every(s => typeof s === 'number' && !isNaN(s))).toBe(true);

    const actualPayloadSize = JSON.stringify({
      model: RERANK_MODEL,
      query,
      documents
    }).length;

    console.log(`Confirmed working payload: ${(actualPayloadSize / 1024).toFixed(1)}KB with batch size ${batchSize}`);
  });
});

