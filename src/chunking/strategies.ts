// ============================================================
// Chunking strategies — Phase 1: fixed-size character chunking
// ============================================================

import { Chunk, ChunkOptions, Metadata } from '../types/index.ts';
import { ChunkingError } from '../errors/index.ts';
import { v4 as uuidv4 } from 'uuid';

export function chunkText(
  content: string,
  documentId: string,
  options: ChunkOptions,
): Chunk[] {
  if (options.strategy !== 'fixed') {
    throw new ChunkingError(
      `Strategy "${options.strategy}" is not yet implemented. Only "fixed" is available in Phase 1.`,
    );
  }

  return fixedSizeChunk(content, documentId, options.size, options.overlap);
}

function fixedSizeChunk(
  content: string,
  documentId: string,
  size: number,
  overlap: number,
): Chunk[] {
  if (size <= 0) throw new ChunkingError('Chunk size must be > 0');
  if (overlap < 0) throw new ChunkingError('Overlap must be >= 0');
  if (overlap >= size) throw new ChunkingError('Overlap must be less than chunk size');

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < content.length) {
    const end = Math.min(start + size, content.length);
    const chunkContent = content.slice(start, end);

    chunks.push({
      id: uuidv4(),
      content: chunkContent,
      documentId,
      metadata: {},
      index: index++,
    });

    if (end >= content.length) break;
    start += size - overlap;
  }

  return chunks;
}
