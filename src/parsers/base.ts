// ============================================================
// Abstract base class for document parsers
// ============================================================

import type { DocumentParser, FileInput, ParsedDocument } from '../types/index.ts';
import { ParseError } from '../errors/index.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export abstract class BaseDocumentParser implements DocumentParser {
  abstract readonly supportedExtensions: string[];

  /** Resolve a FileInput to a {filePath, buffer} tuple. */
  protected async resolveInput(file: FileInput): Promise<{ filePath: string; buffer: Buffer }> {
    let filePath: string;
    let buffer: Buffer | undefined;

    if (typeof file === 'string') {
      filePath = file;
    } else if (Buffer.isBuffer(file)) {
      throw new ParseError('Buffer input requires a path override. Use { path, content } instead.');
    } else {
      filePath = file.path;
      buffer = file.content;
    }

    if (!buffer) {
      try {
        buffer = await fs.readFile(filePath);
      } catch (err) {
        throw new ParseError(`Failed to read file: ${filePath}`, { cause: err as Error });
      }
    }

    return { filePath, buffer };
  }

  /** Extract the file extension (without dot) from a path. */
  protected extensionFrom(filePath: string): string {
    return path.extname(filePath).replace('.', '').toLowerCase();
  }

  /** Check if this parser supports the given file extension. */
  supports(filePath: string): boolean {
    const ext = this.extensionFrom(filePath);
    return this.supportedExtensions.includes(ext);
  }

  abstract parse(file: FileInput): Promise<ParsedDocument>;
}
