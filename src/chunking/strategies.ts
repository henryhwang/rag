// ============================================================
// Chunking strategies — fixed, recursive, markdown-aware
// ============================================================

import { Chunk, ChunkOptions, Metadata } from '../types/index.ts';
import { ChunkingError } from '../errors/index.ts';
import { v4 as uuidv4 } from 'uuid';

export function chunkText(
  content: string,
  documentId: string,
  options: ChunkOptions,
): Chunk[] {
  switch (options.strategy) {
    case 'fixed':
      return fixedSizeChunk(content, documentId, options.size, options.overlap);
    case 'recursive':
      return recursiveChunk(content, documentId, options.size, options.overlap);
    case 'markdown':
      return markdownAwareChunk(content, documentId, options.size, options.overlap);
    default:
      throw new ChunkingError(`Unknown chunking strategy: "${options.strategy}"`);
  }
}

// ============================================================
// Fixed-size character chunking (Phase 1)
// ============================================================

function fixedSizeChunk(
  content: string,
  documentId: string,
  size: number,
  overlap: number,
): Chunk[] {
  if (size <= 0) throw new ChunkingError('Chunk size must be > 0');
  if (overlap < 0) throw new ChunkingError('Overlap must be >= 0');
  if (overlap >= size) throw new ChunkingError('Overlap must be less than chunk size');

  return makeChunks(content, documentId, size, overlap, (c, s, e) => c.slice(s, e));
}

// ============================================================
// Recursive chunking — split by semantic boundaries
// Tries paragraphs → sentences → fixed-size as fallback
// ============================================================

function recursiveChunk(
  content: string,
  documentId: string,
  size: number,
  overlap: number,
): Chunk[] {
  if (size <= 0) throw new ChunkingError('Chunk size must be > 0');
  if (overlap < 0) throw new ChunkingError('Overlap must be >= 0');
  if (overlap >= size) throw new ChunkingError('Overlap must be less than chunk size');

  // Split into paragraphs first (double-newline boundaries)
  const paragraphs = content.split(/\n{2,}/).filter(Boolean);
  const chunks: Chunk[] = [];
  let index = 0;
  let current = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // If adding this paragraph exceeds the limit, flush current
    if (current && current.length + trimmed.length > size) {
      const flushed = current.trim();
      chunks.push(makeChunk(flushed, documentId, index++));

      // If the paragraph itself is too large, split it by sentences
      if (trimmed.length > size) {
        // Prepend overlap context from the flushed chunk to the first sentence
        const overlapText = overlap > 0 && flushed.length > overlap
          ? flushed.slice(-overlap) + '\n\n'
          : '';
        const sentenceChunks = splitSentences(trimmed, documentId, size, overlap, index);
        if (overlapText && sentenceChunks.length > 0) {
          sentenceChunks[0].content = overlapText + sentenceChunks[0].content;
        }
        chunks.push(...sentenceChunks);
        index = chunks.length;
        current = '';
      } else {
        // Carry trailing overlap into the next chunk
        current = overlap > 0 && flushed.length > overlap
          ? flushed.slice(-overlap) + '\n\n' + trimmed
          : trimmed;

        // If overlap push exceeds size, fall back to just the new paragraph
        if (current.length > size) {
          current = trimmed;
        }
      }
    } else if (!current && trimmed.length > size) {
      // First paragraph alone exceeds size — split by sentences
      chunks.push(...splitSentences(trimmed, documentId, size, overlap, index));
      index = chunks.length;
    } else {
      current = current ? `${current}\n\n${trimmed}` : trimmed;
    }
  }

  if (current) {
    // Final flush — if it still exceeds the limit, fall back to fixed-size
    if (current.length > size) {
      const fallback = fixedSizeChunk(current.trim(), documentId, size, overlap);
      chunks.push(...fallback.map((c, i) => ({ ...c, index: index + i })));
    } else {
      chunks.push(makeChunk(current.trim(), documentId, index++));
    }
  }

  return chunks;
}

function splitSentences(
  text: string,
  documentId: string,
  size: number,
  overlap: number,
  startIndex: number,
): Chunk[] {
  // Split on sentence boundaries (. ! ? followed by space)
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks: Chunk[] = [];
  let current = '';
  let idx = startIndex;

  for (const sent of sentences) {
    if (current && (current.length + sent.length) > size) {
      // Flush current — but check if it itself exceeds the limit
      if (current.length > size) {
        const fallback = fixedSizeChunk(current.trim(), documentId, size, overlap);
        chunks.push(...fallback.map((c, i) => ({ ...c, index: idx + i })));
        idx = chunks.length;
      } else {
        chunks.push(makeChunk(current.trim(), documentId, idx++));
      }
      current = '';
    }
    current = current ? `${current} ${sent}` : sent;
  }

  if (current) {
    // If the remaining chunk is still too large, fall back to fixed-size
    if (current.length > size) {
      const fallback = fixedSizeChunk(current, documentId, size, overlap);
      chunks.push(...fallback.map((c, i) => ({ ...c, index: idx + i })));
    } else {
      chunks.push(makeChunk(current.trim(), documentId, idx));
    }
  }

  return chunks;
}

// ============================================================
// Markdown-aware chunking — preserve headers and code blocks
// ============================================================

function markdownAwareChunk(
  content: string,
  documentId: string,
  size: number,
  overlap: number,
): Chunk[] {
  if (size <= 0) throw new ChunkingError('Chunk size must be > 0');
  if (overlap < 0) throw new ChunkingError('Overlap must be >= 0');
  if (overlap >= size) throw new ChunkingError('Overlap must be less than chunk size');

  const lines = content.split('\n');
  const chunks: Chunk[] = [];
  let current = '';
  let index = 0;
  let inCodeBlock = false;
  let currentHeading = '';

  for (const line of lines) {
    const isCodeFence = line.trim().startsWith('```');
    const isHeading = /^#{1,6}\s+/.test(line);

    // Track code block state — never split inside code blocks
    if (isCodeFence) {
      inCodeBlock = !inCodeBlock;
    }

    // If we hit a heading, always flush current chunk before starting new
    if (isHeading && !inCodeBlock) {
      if (current) {
        chunks.push(makeChunk(current.trim(), documentId, index++));
        current = '';
      }
      currentHeading = line;
      current = line;
      continue;
    }

    // Inside code block — always append, never split
    if (inCodeBlock) {
      current = current ? `${current}\n${line}` : line;
      continue;
    }

    // Check if adding this line exceeds the limit
    const appended = current ? `${current}\n${line}` : line;
    if (appended.length > size && current) {
      const flushed = current.trim();
      chunks.push(makeChunk(flushed, documentId, index++));
      // Carry trailing overlap into the next chunk, prepend heading for context
      const overlapTail = overlap > 0 && flushed.length > overlap
        ? '\n' + flushed.slice(-overlap)
        : '';
      current = currentHeading
        ? `${currentHeading}${overlapTail}\n${line}`
        : overlapTail + '\n' + line;
    } else {
      current = appended;
    }
  }

  if (current) {
    chunks.push(makeChunk(current.trim(), documentId, index++));
  }

  return chunks;
}

// ============================================================
// Shared helpers
// ============================================================

function makeChunk(content: string, documentId: string, index: number): Chunk {
  return { id: uuidv4(), content, documentId, metadata: {}, index };
}

function makeChunks(
  content: string,
  documentId: string,
  size: number,
  overlap: number,
  slicer: (c: string, s: number, e: number) => string,
): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < content.length) {
    const end = Math.min(start + size, content.length);
    const chunkContent = slicer(content, start, end);

    chunks.push(makeChunk(chunkContent, documentId, index++));

    if (end >= content.length) break;
    start += size - overlap;
  }

  return chunks;
}
