// ============================================================
// Plain text (.txt) parser — reads raw bytes as UTF-8
// ============================================================

import { FileInput, ParsedDocument } from '../types/index.ts';
import { ParseError } from '../errors/index.ts';
import { BaseDocumentParser } from './base.ts';
import * as path from 'node:path';

export class TextParser extends BaseDocumentParser {
  readonly supportedExtensions = ['txt'];

  async parse(file: FileInput): Promise<ParsedDocument> {
    const { filePath, buffer } = await this.resolveInput(file);

    let content: string;
    try {
      content = buffer.toString('utf-8');
    } catch (err) {
      throw new ParseError(`Failed to decode text: ${filePath}`, { cause: err as Error });
    }

    return {
      content,
      metadata: {
        fileName: path.basename(filePath),
        fileType: 'text/plain',
      },
    };
  }
}
