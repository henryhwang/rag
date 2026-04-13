// ============================================================
// Core utilities
// ============================================================

import { DocumentInfo } from '../types/index.ts';
import { v4 as uuidv4 } from 'uuid';

/** Generate a unique document ID. */
export function generateDocId(): string {
  return uuidv4();
}

/** Build a DocumentInfo object from parsed content. */
export function createDocumentInfo(
  fileName: string,
  content: string,
  metadata: Record<string, unknown> = {},
): DocumentInfo {
  return {
    id: generateDocId(),
    fileName,
    content,
    metadata,
    createdAt: new Date(),
  };
}
