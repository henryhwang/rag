// ============================================================
// Batching utilities for splitting documents into batches
// respecting both count limits and content size limits
// ============================================================

/**
 * Generator that yields batch index ranges [start, end) based on
 * document count and total content size constraints.
 * 
 * @param totalDocs - Total number of documents to split
 * @param docSizes - Array of sizes (chars/tokens) for each document
 * @param batchSize - Maximum number of documents per batch
 * @param maxContentLengthPerBatch - Optional maximum total content size per batch
 * @yields Array of [start, end) indices for each batch
 * 
 * @example
 * ```typescript
 * const docSizes = [100, 200, 150, 300];
 * for (const [start, end] of getBatchIndices(4, docSizes, 10, 400)) {
 *   // [0, 2] -> docs[0] + docs[1] = 300 chars
 *   // [2, 3] -> docs[2] = 150 chars
 *   // [3, 4] -> docs[3] = 300 chars
 * }
 * ```
 */
export function* getBatchIndices(
  totalDocs: number,
  docSizes: number[],
  batchSize: number,
  maxContentLengthPerBatch?: number
): Generator<number[]> {
  if (totalDocs <= 0 || docSizes.length !== totalDocs) {
    return;
  }

  const limit = maxContentLengthPerBatch ?? Infinity;

  for (let start = 0; start < totalDocs; ) {
    let end = start;
    let currentSize = 0;

    while (end < totalDocs && 
           (end - start) < batchSize && 
           currentSize + docSizes[end] <= limit) {
      currentSize += docSizes[end];
      end++;
    }

    // Safety: ensure we always make progress even if single doc exceeds limit
    if (end === start) {
      end = start + 1;
    }

    yield [start, end];
    start = end;
  }
}

/**
 * Calculate approximate token count from text length.
 * Uses rough estimate: 1 token ≈ 4 characters for English text.
 * 
 * @deprecated Use proper tokenization library (tiktoken) for accurate counts.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
