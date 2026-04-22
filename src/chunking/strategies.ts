import { v4 as uuidv4 } from 'uuid';
import type { Chunk, ChunkOptions, Metadata } from '../types/index.ts';
import { ChunkingError } from '../errors/index.ts';

const DEFAULT_OVERLAP_RATIO = 0.15;

// ====================== Main Entry Point ======================
export function chunkText(
  content: string,
  documentId: string,
  options: ChunkOptions,
): Chunk[] {
  if (!content?.trim()) return [];

  const size = options.size;
  const overlap = options.overlap ?? Math.floor(size * DEFAULT_OVERLAP_RATIO);

  if (size <= 0) throw new ChunkingError('Chunk size must be > 0');
  if (overlap < 0) throw new ChunkingError('Overlap must be >= 0');
  if (overlap >= size) throw new ChunkingError('Overlap must be less than chunk size');

  if (overlap >= size * 0.4) {
    console.warn(`[Chunking] Large overlap (${overlap}/${size}) may cause redundancy. Consider reducing it.`);
  }

  switch (options.strategy) {
    case 'fixed':
      return fixedSizeChunk(content, documentId, size, overlap);
    case 'recursive':
      return recursiveChunk(content, documentId, size, overlap);
    case 'markdown':
      return markdownAwareChunk(content, documentId, size, overlap);
    default:
      throw new ChunkingError(`Unknown chunking strategy: "${options.strategy}"`);
  }
}

// ====================== FIXED ======================
function fixedSizeChunk(
  content: string,
  documentId: string,
  size: number,
  overlap: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < content.length) {
    const end = Math.min(start + size, content.length);
    const chunkContent = content.slice(start, end).trim();

    if (chunkContent) {
      chunks.push(makeChunk(chunkContent, documentId, index++, 'fixed'));
    }

    if (end >= content.length) break;
    start += size - overlap;
  }
  return chunks;
}

// ====================== RECURSIVE ======================
const RECURSIVE_SEPARATORS = ['\n\n', '\n', '. ', '? ', '! ', ' ', ''];

function recursiveChunk(
  content: string,
  documentId: string,
  size: number,
  overlap: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  splitRecursively(content.trim(), documentId, size, overlap, RECURSIVE_SEPARATORS, 0, chunks);
  return chunks;
}

/** Get word-safe overlap suffix to avoid cutting words mid-stream */
function getOverlapSuffix(text: string, maxChars: number): string {
  if (maxChars <= 0 || maxChars >= text.length) return '';
  const raw = text.slice(-maxChars);
  const lastSpace = raw.lastIndexOf(' ');
  if (lastSpace === -1) return raw;
  return raw.slice(lastSpace + 1);
}

function splitRecursively(
  text: string,
  documentId: string,
  size: number,
  overlap: number,
  separators: readonly string[],
  startIndex: number,
  chunks: Chunk[],
  overlapPrefix: string = '',
): number {
  if (!text && !overlapPrefix) return startIndex;

  // Apply overlap prefix to the text
  let workingText = overlapPrefix ? `${overlapPrefix}${text}` : text;

  // Base case: text fits in one chunk
  if (workingText.length <= size) {
    chunks.push(makeChunk(workingText, documentId, startIndex, 'paragraph'));
    return startIndex + 1;
  }

  // No more separators: force fixed-size split
  if (separators.length === 0) {
    const fixedChunks = fixedSizeChunk(workingText, documentId, size, overlap);
    fixedChunks.forEach((c, i) => {
      chunks.push({ ...c, index: startIndex + i });
    });
    return startIndex + fixedChunks.length;
  }

  const sep = separators[0];
  const parts = sep ? workingText.split(sep) : [workingText];

  let current = '';
  let idx = startIndex;

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const candidate = current ? `${current}${sep}${trimmed}` : trimmed;

    if (candidate.length <= size) {
      current = candidate;
      continue;
    }

    // Candidate exceeds size - push current if exists
    if (current) {
      chunks.push(makeChunk(current, documentId, idx++, 'paragraph'));
    }

    // Handle oversized part
    if (trimmed.length > size) {
      // Add overlap from current chunk as prefix for next iteration
      const overlapToPass = getOverlapSuffix(current, overlap);
      idx = splitRecursively(trimmed, documentId, size, overlap, separators.slice(1), idx, chunks, overlapToPass);
    } else {
      current = trimmed;
    }
  }

  // Handle remaining text
  if (current) {
    if (current.length > size) {
      const overlapToPass = getOverlapSuffix(current.slice(0, -overlap), overlap);
      idx = splitRecursively(current, documentId, size, overlap, separators.slice(1), idx, chunks, overlapToPass);
    } else {
      chunks.push(makeChunk(current, documentId, idx, 'paragraph'));
      idx++;
    }
  }

  return idx;
}



// ====================== MARKDOWN ======================
function markdownAwareChunk(
  content: string,
  documentId: string,
  size: number,
  overlap: number,
): Chunk[] {
  const lines = content.split('\n');
  const chunks: Chunk[] = [];
  let current = '';
  let index = 0;
  let inCodeBlock = false;
  const headingStack: string[] = [];

  for (const line of lines) {
    const isCodeFence = /^\s*```|^\s*~~~/.test(line);
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (isCodeFence) inCodeBlock = !inCodeBlock;

    if (headingMatch && !inCodeBlock) {
      if (current.trim()) {
        chunks.push(makeChunk(current.trim(), documentId, index++, 'paragraph', [...headingStack]));
      }
      current = '';

      const level = headingMatch[1].length;
      headingStack.length = level - 1;
      headingStack.push(line.trim());
      current = line;
      continue;
    }

    if (inCodeBlock) {
      current += (current ? '\n' : '') + line;
      continue;
    }

    const appended = current ? `${current}\n${line}` : line;

    // Handle extremely long lines by forced splitting  
    if (line.length > size && !inCodeBlock && !headingMatch) {
      if (current.trim()) {
        chunks.push(makeChunk(current.trim(), documentId, index++, 'paragraph', [...headingStack]));
      }
      // Use fixed-size splitting for the long line with proper indexing
      const fixedChunks = fixedSizeChunk(line, documentId, size, Math.floor(size * 0.1));
      fixedChunks.forEach((c, i) => {
        chunks.push({
          ...c,
          index: index + i,
          metadata: { ...c.metadata, heading: headingStack[headingStack.length - 1] },
        });
      });
      index += fixedChunks.length;
      current = '';
      continue;
    }

    if (appended.length > size && current.trim()) {
      chunks.push(makeChunk(current.trim(), documentId, index++, 'paragraph', [...headingStack]));

      const overlapText = overlap > 0 ? getOverlapSuffix(current, overlap) : '';
      const headingPrefix = headingStack.length ? headingStack[headingStack.length - 1] + '\n' : '';
      current = headingPrefix + (overlapText ? overlapText + '\n' : '') + line;
    } else {
      current = appended;
    }
  }

  if (current.trim()) {
    chunks.push(makeChunk(current.trim(), documentId, index++, 'paragraph', [...headingStack]));
  }

  return chunks;
}

// ====================== makeChunk ======================
function makeChunk(
  content: string,
  documentId: string,
  index: number,
  chunkType: 'paragraph' | 'heading' | 'code' | 'sentence' | 'fixed',
  headings: string[] = []
): Chunk {
  const metadata: Metadata = {
    chunkType,
    isCodeBlock: content.includes('```') || content.includes('~~~'),
  };

  if (headings.length > 0) {
    metadata.headings = [...headings];
    metadata.heading = headings[headings.length - 1];
  }

  return {
    id: uuidv4(),
    content: content.trim(),
    documentId,
    index,
    metadata,
  };
}
