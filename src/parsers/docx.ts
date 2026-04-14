// ============================================================
// DOCX (.docx) parser — uses mammoth to extract text content
// Loaded lazily so the core library stays lightweight.
// ============================================================

import { FileInput, ParsedDocument } from '../types/index.ts';
import { ParseError } from '../errors/index.ts';
import { BaseDocumentParser } from './base.ts';
import * as path from 'node:path';

export class DocxParser extends BaseDocumentParser {
  readonly supportedExtensions = ['docx'];

  async parse(file: FileInput): Promise<ParsedDocument> {
    const { filePath, buffer } = await this.resolveInput(file);

    let mammoth: typeof import('mammoth');
    try {
      mammoth = await import('mammoth');
    } catch {
      throw new ParseError(
        'mammoth is required for .docx parsing. Install it with: bun add mammoth',
      );
    }

    try {
      const result = await mammoth.extractRawText({ buffer });
      return {
        content: result.value,
        metadata: {
          fileName: path.basename(filePath),
          fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      };
    } catch (err) {
      throw new ParseError(`Failed to parse DOCX: ${filePath}`, {
        cause: err as Error,
      });
    }
  }
}
